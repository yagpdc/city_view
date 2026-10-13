/// <reference lib="webworker" />
import {
  applyRecipe,
  buildFeatures,
  columnsAfter,
  detectColumns,
  detectHeaderRow,
  detectJunkRows,
  geoJsonToRows,
  RESERVED_COLUMNS,
  geometryAnchor,
  type Geometry,
  guessLocation,
  guessLocationFromSample,
  guessStyleColumns,
  joinStats,
  profileColumn,
  readCoordinates,
  suggestAppendMap,
  suggestJoinKeys,
  summarize,
  uniqueHeaders,
  type ImportMapping,
  type RecipeContext,
  type RecipeStep,
  type Row,
} from "@cityview/importer";
import Papa from "papaparse";
import { parquetMetadataAsync, parquetReadObjects, type AsyncBuffer } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import readXlsxFile from "read-excel-file/web-worker";
import { MAX_BROWSER_ROWS, fileFormat, type Delimiter, type Encoding, type OpenOptions, type WorkerRequest, type WorkerResponse } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

const PREVIEW_ROWS = 50;
const DETECT_ROWS = 2000;

/** Linhas como vieram do arquivo (a receita nunca as altera). */
let rows: Row[] = [];
let lastMapping: ImportMapping | null = null;
/** Passos do builder; aplicados na amostra (tela) e em tudo (importação). */
let recipe: RecipeStep[] = [];
/** Linha do arquivo onde está o cabeçalho (0 = primeira); para relatar erros no número que a pessoa vê. */
let headerRow = 0;
let openedBase: Omit<import("./protocol").OpenedFile, "headers" | "preview" | "columns" | "location" | "style"> | null = null;

/** Outras planilhas (juntar / acrescentar), só na memória: id → nome e linhas. */
const sources = new Map<string, { name: string; rows: Row[] }>();
const context = (): RecipeContext => ({ tables: Object.fromEntries([...sources].map(([id, s]) => [id, s.rows])) });

/** Linhas com a receita aplicada (todas, inclusive as acrescentadas). */
const applied = () => applyRecipe(rows, recipe, context());

/**
 * Contexto da amostra: tabelas só acrescentadas entram com poucas linhas (a tela não precisa de todas);
 * as usadas para juntar entram inteiras (o par pode estar em qualquer linha).
 */
function sampleContext(): RecipeContext {
  const joined = new Set(recipe.flatMap((s) => (s.op === "join" ? [s.source] : [])));
  return { tables: Object.fromEntries([...sources].map(([id, s]) => [id, joined.has(id) ? s.rows : s.rows.slice(0, 200)])) };
}

/** Total de linhas: as do arquivo mais as acrescentadas (antes dos filtros). */
const totalRows = (base: number) => base + recipe.reduce((n, s) => n + (s.op === "append" ? (sources.get(s.source)?.rows.length ?? 0) : 0), 0);

/** O que a tela mostra: colunas, prévia, tipos e palpites — sempre depois da receita (na amostra). */
function view() {
  const sample = applyRecipe(rows.slice(0, DETECT_ROWS), recipe, sampleContext());
  const headers = columnsAfter(rows[0] ? Object.keys(rows[0]) : [], recipe);
  const columns = detectColumns(headers, sample);
  const location = guessLocation(columns) ?? guessLocationFromSample(columns, sample);
  const style = guessStyleColumns(columns, location ? [location.lat, location.lon, location.latlon ?? ""] : []);
  return { headers, preview: sample.slice(0, PREVIEW_ROWS), columns, location, style, rowCount: totalRows(openedBase?.rowCount ?? rows.length) };
}

/** Lê outra planilha com o mesmo leitor do arquivo principal, sem mexer no estado dele. */
async function readTable(file: File, options: OpenOptions = {}): Promise<Row[]> {
  const saved = { rows, headerRow, parquetLayout };
  try {
    const format = fileFormat(file.name) ?? "csv";
    if (format === "excel") await openExcel(file, options.sheet);
    else if (format === "parquet") await openParquet(file);
    else if (format === "geojson") await openGeoJson(file);
    else await open(file, options.delimiter, options.encoding ?? (await detectEncoding(file)));
    if (rows.length === 0) throw new Error(`Não encontramos linhas de dados em "${file.name}".`);
    return rows;
  } finally {
    rows = saved.rows;
    headerRow = saved.headerRow;
    parquetLayout = saved.parquetLayout;
  }
}

const post = (msg: WorkerResponse) => self.postMessage(msg);

/**
 * UTF-16 pela marca no começo (Excel "Texto Unicode"), UTF-8 válido, ou Windows-1252 (planilhas brasileiras
 * exportadas pelo Excel).
 */
async function detectEncoding(file: File): Promise<Encoding> {
  const head = await file.slice(0, 1 << 20).arrayBuffer();
  const bom = new Uint8Array(head.slice(0, 2));
  if (bom[0] === 0xff && bom[1] === 0xfe) return "utf-16le";
  if (bom[0] === 0xfe && bom[1] === 0xff) return "utf-16be";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true });
    return "utf-8";
  } catch {
    return "windows-1252";
  }
}

/** Linha do cabeçalho num CSV: lê o começo do arquivo e procura (títulos e linhas em branco acima). */
async function csvHeaderRow(file: File, delimiter: Delimiter | undefined, encoding: Encoding): Promise<number> {
  const text = new TextDecoder(encoding).decode(await file.slice(0, 256 << 10).arrayBuffer());
  const lines = Papa.parse<string[]>(text, { preview: 40, delimiter: delimiter ?? "", skipEmptyLines: false }).data;
  return detectHeaderRow(lines);
}

async function open(file: File, delimiter: Delimiter | undefined, encoding: Encoding, previewRows?: number): Promise<Delimiter> {
  rows = [];
  let detected: Delimiter = delimiter ?? ",";
  const skip = await csvHeaderRow(file, delimiter, encoding);
  headerRow = skip;
  // Nomes únicos e não vazios: "valor", "valor_2", "coluna_3".
  const seen = new Map<string, number>();
  return new Promise((resolve, reject) => {
    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: "greedy",
      delimiter: delimiter ?? "",
      encoding,
      preview: previewRows ?? 0,
      chunkSize: 4 << 20,
      beforeFirstChunk: skip > 0 ? (chunk) => chunk.split(/\r?\n/).slice(skip).join("\n") : undefined,
      transformHeader: (h, i) => {
        let base = h.replace(/^\uFEFF/, "").trim() || `coluna_${i + 1}`;
        if (RESERVED_COLUMNS.has(base)) base = `${base}_coluna`;
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        return n === 1 ? base : `${base}_${n}`;
      },
      chunk: (results, parser) => {
        detected = results.meta.delimiter as Delimiter;
        for (const row of results.data) rows.push(row);
        post({ type: "progress", loaded: results.meta.cursor, total: file.size });
        if (!previewRows && rows.length > MAX_BROWSER_ROWS) {
          parser.abort();
          reject(
            new Error(
              `O arquivo tem mais de ${MAX_BROWSER_ROWS.toLocaleString("pt-BR")} linhas. ` +
                "O navegador processa até esse limite. Inicie o servidor local (pnpm api) para arquivos maiores.",
            ),
          );
        }
      },
      complete: () => resolve(detected),
      error: (err) => reject(err),
    });
  });
}

const TOO_MANY_ROWS = `O arquivo tem mais de ${MAX_BROWSER_ROWS.toLocaleString("pt-BR")} linhas. O navegador processa até esse limite.`;

/** Célula do Excel → texto no mesmo formato que viria de um CSV. */
function excelCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 19).replace("T", " ");
  }
  return String(v);
}

/**
 * Uma aba do .xlsx (a escolhida, ou a primeira com dados). O cabeçalho pode estar abaixo de títulos e
 * linhas em branco. Devolve os nomes das abas.
 */
async function openExcel(file: File, sheetName?: string): Promise<{ sheets: string[]; sheet: string }> {
  const book = await readXlsxFile(file);
  const sheets = book.map((s) => s.sheet);
  const chosen = book.find((s) => s.sheet === sheetName) ?? book.find((s) => s.data.length > 1) ?? book[0];
  if (!chosen) throw new Error("A planilha não tem abas com dados.");
  const data = chosen.data;
  if (data.length - 1 > MAX_BROWSER_ROWS) throw new Error(TOO_MANY_ROWS);
  headerRow = detectHeaderRow(data as unknown[][]);
  const headers = uniqueHeaders((data[headerRow] ?? []).map((h) => excelCell(h)));
  rows = [];
  for (const line of data.slice(headerRow + 1)) {
    if (line.every((v) => v === null || v === "")) continue;
    const row: Row = {};
    headers.forEach((h, i) => (row[h] = excelCell(line[i])));
    rows.push(row);
  }
  return { sheets, sheet: chosen.sheet };
}

async function openGeoJson(file: File): Promise<string | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("O arquivo não é um JSON válido.");
  }
  const result = geoJsonToRows(parsed);
  if (result.rows.length > MAX_BROWSER_ROWS) throw new Error(TOO_MANY_ROWS);
  rows = result.rows;
  const notes = [];
  if (result.converted > 0)
    notes.push(`${result.converted.toLocaleString("pt-BR")} feições não eram ponto (linhas ou áreas) e viraram o centro da sua extensão`);
  if (result.withoutGeometry > 0) notes.push(`${result.withoutGeometry.toLocaleString("pt-BR")} feições sem geometria`);
  return notes.length ? `${notes.join("; ")}.` : undefined;
}

const isGeometry = (v: unknown): v is Geometry =>
  typeof v === "object" && v !== null && "type" in v && ("coordinates" in v || "geometries" in v);

/** Valor do Parquet → texto no formato do CSV. */
function parquetCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "bigint" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return excelCell(v);
  if (v instanceof Uint8Array) return ""; // binário (ex.: WKB sem metadados GeoParquet)
  if (typeof v === "object") return JSON.stringify(v, (_, x) => (typeof x === "bigint" ? String(x) : x));
  return String(v);
}

/**
 * Parquet lido aos pedaços direto do arquivo (só os bytes necessários). Colunas de geometria
 * (GeoParquet) viram longitude/latitude, como no GeoJSON. Devolve o total de linhas do arquivo.
 */
/** Como as colunas do Parquet viram linhas (descoberto na amostra; reaproveitado na leitura completa). */
let parquetLayout: { plain: string[]; geometryKey?: string; lon: string; lat: string } | null = null;

function parquetRows(objects: Record<string, unknown>[]): { rows: Row[]; converted: number } {
  const { plain, geometryKey, lon, lat } = parquetLayout!;
  let converted = 0;
  const out = objects.map((o) => {
    const row: Row = {};
    for (const k of plain) row[k] = parquetCell(o[k]);
    if (geometryKey) {
      const a = isGeometry(o[geometryKey]) ? geometryAnchor(o[geometryKey]) : null;
      if (a?.converted) converted++;
      row[lon] = a ? String(a.point[0]) : "";
      row[lat] = a ? String(a.point[1]) : "";
    }
    return row;
  });
  return { rows: out, converted };
}

/** Um bloco de linhas do Parquet, já no formato de linha do CSV. */
async function parquetChunk(file: File, start: number, end: number): Promise<Row[]> {
  const buffer: AsyncBuffer = { byteLength: file.size, slice: (s, e) => file.slice(s, e).arrayBuffer() };
  const metadata = await parquetMetadataAsync(buffer);
  const objects = await parquetReadObjects({ file: buffer, metadata, compressors, rowStart: start, rowEnd: end });
  return parquetRows(objects).rows;
}

async function openParquet(file: File, previewRows?: number): Promise<{ total: number; note?: string }> {
  const buffer: AsyncBuffer = { byteLength: file.size, slice: (start, end) => file.slice(start, end).arrayBuffer() };
  const metadata = await parquetMetadataAsync(buffer);
  const total = Number(metadata.num_rows);
  if (!previewRows && total > MAX_BROWSER_ROWS) throw new Error(`${TOO_MANY_ROWS} Inicie o servidor local (pnpm api) para arquivos maiores.`);
  const objects = await parquetReadObjects({
    file: buffer,
    metadata,
    compressors,
    ...(previewRows ? { rowEnd: Math.min(previewRows, total) } : {}),
  });
  const first = objects[0] ?? {};
  const geometryKeys = Object.keys(first).filter((k) => objects.slice(0, 50).some((o) => isGeometry(o[k])));
  const plain = Object.keys(first).filter((k) => !geometryKeys.includes(k));
  const geometryKey = geometryKeys[0];
  const lon = plain.includes("longitude") ? "geometria_longitude" : "longitude";
  const lat = plain.includes("latitude") ? "geometria_latitude" : "latitude";
  parquetLayout = { plain, geometryKey, lon, lat };
  const converted = parquetRows(objects).converted;
  rows = parquetRows(objects).rows;
  const notes = [];
  if (geometryKey) notes.push(`a coluna de geometria "${geometryKey}" virou longitude/latitude`);
  if (converted > 0) notes.push(`${converted.toLocaleString("pt-BR")} geometrias não eram ponto e viraram o centro da sua extensão`);
  return { total, note: notes.length ? `${notes.join("; ")}.`.replace(/^./, (c) => c.toUpperCase()) : undefined };
}

self.onmessage = async (e: MessageEvent<WorkerRequest & { id?: number }>) => {
  const msg = e.data;
  // Resposta casada com o pedido (vários pedidos podem estar em andamento ao mesmo tempo).
  const post = (m: WorkerResponse) => self.postMessage({ ...m, id: msg.id });
  try {
    if (msg.type === "open") {
      const format = fileFormat(msg.file.name) ?? "csv";
      let encoding: Encoding = "utf-8";
      let delimiter: Delimiter = ",";
      let note: string | undefined;
      let total: number | undefined;
      let sheets: string[] | undefined;
      let sheet: string | undefined;
      recipe = [];
      headerRow = 0;
      sources.clear();
      if (format === "excel") ({ sheets, sheet } = await openExcel(msg.file, msg.options.sheet));
      else if (format === "parquet") ({ total, note } = await openParquet(msg.file, msg.options.previewRows));
      else if (format === "geojson") note = await openGeoJson(msg.file);
      else {
        encoding = msg.options.encoding ?? (await detectEncoding(msg.file));
        delimiter = await open(msg.file, msg.options.delimiter, encoding, msg.options.previewRows);
      }
      if (rows.length === 0) throw new Error("Não encontramos linhas de dados no arquivo.");
      openedBase = {
        format,
        note,
        rowCount: total ?? rows.length,
        delimiter,
        encoding,
        sampled: Boolean(msg.options.previewRows),
        headerRow,
        junk: detectJunkRows(Object.keys(rows[0]!), rows).map((f) => ({ ...f, rows: f.rows.map((i) => i + headerRow + 2) })),
        originalHeaders: Object.keys(rows[0]!),
        ...(sheets && sheets.length > 1 ? { sheets, sheet } : {}),
      };
      post({ type: "opened", file: { ...openedBase, ...view() } });
    } else if (msg.type === "recipe") {
      recipe = msg.steps;
      if (!openedBase) throw new Error("Abra um arquivo antes.");
      post({ type: "opened", file: { ...openedBase, ...view() } });
    } else if (msg.type === "addSource") {
      const other = await readTable(msg.file, msg.options);
      const id = `s${sources.size + 1}_${Date.now().toString(36)}`;
      sources.set(id, { name: msg.file.name, rows: other });
      const otherHeaders = Object.keys(other[0]!);
      const mainSample = applyRecipe(rows.slice(0, DETECT_ROWS), recipe, sampleContext());
      const headers = columnsAfter(rows[0] ? Object.keys(rows[0]) : [], recipe);
      post({
        type: "source",
        source: {
          id,
          name: msg.file.name,
          headers: otherHeaders,
          rowCount: other.length,
          preview: other.slice(0, 5),
          join: suggestJoinKeys(mainSample, headers, other, otherHeaders),
          appendMap: suggestAppendMap(openedBase?.originalHeaders ?? headers, otherHeaders),
        },
      });
    } else if (msg.type === "joinStats") {
      const other = sources.get(msg.source);
      if (!other) throw new Error("A outra planilha não está mais carregada. Escolha o arquivo de novo.");
      // Balanço nas primeiras 50 mil linhas (rápido o bastante para mudar a chave e ver na hora).
      const main = applyRecipe(rows.slice(0, 50_000), recipe, sampleContext());
      post({ type: "joinStats", stats: joinStats(main, msg.key, other.rows, msg.otherKey) });
    } else if (msg.type === "profile") {
      const sample = applyRecipe(rows.slice(0, DETECT_ROWS), recipe, sampleContext());
      const [info] = detectColumns([msg.column], sample);
      post({ type: "profiled", profile: profileColumn(info!, sample) });
    } else if (msg.type === "failed") {
      // Linhas que ficam de fora (sem localização legível), com o motivo, para a pessoa corrigir.
      if (!lastMapping) throw new Error("Valide os dados antes.");
      const out: Row[] = [];
      applied().forEach((row, i) => {
        const c = readCoordinates(row, lastMapping!);
        const reason = c === "empty" ? "sem localização" : c === null ? "localização ilegível" : null;
        if (reason) out.push({ linha_na_planilha: String(i + headerRow + 2), motivo: reason, ...row });
      });
      post({ type: "failedRows", blob: new Blob(["\uFEFF" + Papa.unparse(out, { delimiter: ";" })], { type: "text/csv" }), count: out.length });
    } else if (msg.type === "build") {
      lastMapping = msg.mapping;
      post({ type: "built", summary: summarize(applied(), msg.mapping, msg.colorBy, headerRow + 2) });
    } else if (msg.type === "tilesFile") {
      // Arquivo grande: relê inteiro aos pedaços direto em colunas (sem um objeto por linha).
      if (!lastMapping) throw new Error("Nada para processar: valide os dados antes.");
      const { streamCsv, streamParquet } = await import("./stream");
      const { buildTilesFromColumns } = await import("./tiles");
      const reading = (fraction: number) => post({ type: "tiling", stage: "reading", fraction });
      const opts = { mapping: lastMapping, colorBy: msg.colorBy, title: msg.title, recipe, ctx: context() };
      let cols;
      if (fileFormat(msg.file.name) === "parquet") {
        const buffer: AsyncBuffer = { byteLength: msg.file.size, slice: (s, e2) => msg.file.slice(s, e2).arrayBuffer() };
        const total = Number((await parquetMetadataAsync(buffer)).num_rows);
        cols = await streamParquet(total, (start, end) => parquetChunk(msg.file, start, end), opts, reading);
      } else {
        cols = await streamCsv(msg.file, { ...opts, delimiter: msg.delimiter, encoding: msg.encoding }, reading);
      }
      rows = []; // a amostra não serve mais
      const { bytes, report } = await buildTilesFromColumns(cols, msg, (stage, fraction) => post({ type: "tiling", stage, fraction }));
      post({ type: "tiled", blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/vnd.pmtiles" }), report });
    } else if (msg.type === "tiles") {
      if (!lastMapping) throw new Error("Nada para processar: valide os dados antes.");
      const { buildTiles } = await import("./tiles");
      const { features } = buildFeatures(applied(), lastMapping);
      const { bytes, report } = await buildTiles(features, lastMapping, msg, (stage, fraction) => post({ type: "tiling", stage, fraction }));
      post({ type: "tiled", blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/vnd.pmtiles" }), report });
    } else if (msg.type === "export") {
      if (!lastMapping) throw new Error("Nada para exportar: valide os dados antes.");
      const { features } = buildFeatures(applied(), lastMapping);
      const json = JSON.stringify({ type: "FeatureCollection", features });
      post({ type: "exported", blob: new Blob([json], { type: "application/geo+json" }) });
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
