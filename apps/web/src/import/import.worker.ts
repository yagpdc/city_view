/// <reference lib="webworker" />
import {
  buildFeatures,
  detectColumns,
  geoJsonToRows,
  geometryAnchor,
  type Geometry,
  guessLocation,
  guessStyleColumns,
  summarize,
  type ImportMapping,
  type Row,
} from "@cityview/importer";
import Papa from "papaparse";
import { parquetMetadataAsync, parquetReadObjects, type AsyncBuffer } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { readSheet } from "read-excel-file/web-worker";
import { MAX_BROWSER_ROWS, fileFormat, type Delimiter, type Encoding, type WorkerRequest, type WorkerResponse } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

const PREVIEW_ROWS = 50;
const DETECT_ROWS = 2000;

let rows: Row[] = [];
let lastMapping: ImportMapping | null = null;

const post = (msg: WorkerResponse) => self.postMessage(msg);

/** UTF-8 válido? Senão assume Windows-1252 (planilhas brasileiras exportadas pelo Excel). */
async function detectEncoding(file: File): Promise<Encoding> {
  const head = await file.slice(0, 1 << 20).arrayBuffer();
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true });
    return "utf-8";
  } catch {
    return "windows-1252";
  }
}

function open(file: File, delimiter: Delimiter | undefined, encoding: Encoding, previewRows?: number): Promise<Delimiter> {
  rows = [];
  let detected: Delimiter = delimiter ?? ",";
  let emptyHeaders = 0;
  return new Promise((resolve, reject) => {
    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: "greedy",
      delimiter: delimiter ?? "",
      encoding,
      preview: previewRows ?? 0,
      chunkSize: 4 << 20,
      transformHeader: (h) => h.trim() || `coluna_${++emptyHeaders}`,
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

/** Primeira planilha do .xlsx; a primeira linha é o cabeçalho. */
async function openExcel(file: File): Promise<void> {
  const data = await readSheet(file);
  if (data.length - 1 > MAX_BROWSER_ROWS) throw new Error(TOO_MANY_ROWS);
  let emptyHeaders = 0;
  const seen = new Set<string>();
  const headers = (data[0] ?? []).map((h) => {
    let name = excelCell(h).trim() || `coluna_${++emptyHeaders}`;
    for (let i = 2; seen.has(name); i++) name = `${excelCell(h).trim()}_${i}`;
    seen.add(name);
    return name;
  });
  rows = [];
  for (const line of data.slice(1)) {
    if (line.every((v) => v === null || v === "")) continue;
    const row: Row = {};
    headers.forEach((h, i) => (row[h] = excelCell(line[i])));
    rows.push(row);
  }
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
  let converted = 0;
  rows = objects.map((o) => {
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
  const notes = [];
  if (geometryKey) notes.push(`a coluna de geometria "${geometryKey}" virou longitude/latitude`);
  if (converted > 0) notes.push(`${converted.toLocaleString("pt-BR")} geometrias não eram ponto e viraram o centro da sua extensão`);
  return { total, note: notes.length ? `${notes.join("; ")}.`.replace(/^./, (c) => c.toUpperCase()) : undefined };
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === "open") {
      const format = fileFormat(msg.file.name) ?? "csv";
      let encoding: Encoding = "utf-8";
      let delimiter: Delimiter = ",";
      let note: string | undefined;
      let total: number | undefined;
      if (format === "excel") await openExcel(msg.file);
      else if (format === "parquet") ({ total, note } = await openParquet(msg.file, msg.options.previewRows));
      else if (format === "geojson") note = await openGeoJson(msg.file);
      else {
        encoding = msg.options.encoding ?? (await detectEncoding(msg.file));
        delimiter = await open(msg.file, msg.options.delimiter, encoding, msg.options.previewRows);
      }
      if (rows.length === 0) throw new Error("Não encontramos linhas de dados no arquivo.");
      const headers = Object.keys(rows[0]!);
      const columns = detectColumns(headers, rows.slice(0, DETECT_ROWS));
      const location = guessLocation(columns);
      const style = guessStyleColumns(columns, location ? [location.lat, location.lon] : []);
      post({
        type: "opened",
        file: {
          format,
          note,
          headers,
          preview: rows.slice(0, PREVIEW_ROWS),
          rowCount: total ?? rows.length,
          delimiter,
          encoding,
          columns,
          location,
          style,
          sampled: Boolean(msg.options.previewRows),
        },
      });
    } else if (msg.type === "build") {
      lastMapping = msg.mapping;
      post({ type: "built", summary: summarize(rows, msg.mapping, msg.colorBy) });
    } else if (msg.type === "tiles") {
      if (!lastMapping) throw new Error("Nada para processar: valide os dados antes.");
      const { buildTiles } = await import("./tiles");
      const { features } = buildFeatures(rows, lastMapping);
      const { bytes, report } = await buildTiles(features, lastMapping, msg, (stage, fraction) => post({ type: "tiling", stage, fraction }));
      post({ type: "tiled", blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/vnd.pmtiles" }), report });
    } else if (msg.type === "export") {
      if (!lastMapping) throw new Error("Nada para exportar: valide os dados antes.");
      const { features } = buildFeatures(rows, lastMapping);
      const json = JSON.stringify({ type: "FeatureCollection", features });
      post({ type: "exported", blob: new Blob([json], { type: "application/geo+json" }) });
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
