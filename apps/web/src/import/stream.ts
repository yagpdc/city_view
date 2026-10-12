/**
 * Arquivos grandes (milhões de linhas): relê o arquivo aos pedaços e guarda direto em colunas compactas
 * (números em Float64Array, categorias como índice + dicionário), sem montar um objeto por linha.
 * Roda no worker de importação; o resultado vai para o motor de tiles (WASM).
 */
import { applyCoordinateFix, applyRecipeToRow, parseDate, parseNumber, readCoordinates, type ImportMapping, type RecipeStep, type Row } from "@cityview/importer";
import Papa from "papaparse";
import type { Delimiter, Encoding } from "./protocol";

const EMPTY = 0xffffffff;
/** Limite de valores distintos por coluna categórica (o resto conta como vazio), como no motor. */
const MAX_DISTINCT = 65_536;

class F64 {
  a = new Float64Array(1 << 16);
  n = 0;
  push(v: number) {
    if (this.n === this.a.length) {
      const b = new Float64Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = v;
  }
  get() {
    return this.a.subarray(0, this.n);
  }
}

class Ids {
  a = new Uint32Array(1 << 16);
  n = 0;
  private map = new Map<string, number>();
  values: string[] = [];
  push(raw: string | undefined) {
    const v = raw?.trim() ?? "";
    let id = EMPTY;
    if (v) {
      const known = this.map.get(v);
      if (known !== undefined) id = known;
      else if (this.values.length < MAX_DISTINCT) {
        id = this.values.length;
        this.values.push(v);
        this.map.set(v, id);
      }
    }
    if (this.n === this.a.length) {
      const b = new Uint32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = id;
  }
  get() {
    return this.a.subarray(0, this.n);
  }
}

export type StreamColumn =
  | { kind: "number"; name: string; values: F64 }
  | { kind: "category"; name: string; values: Ids }
  | { kind: "text"; name: string; values: string[] };

export interface Columns {
  lat: Float64Array;
  lon: Float64Array;
  color: Ids | null;
  columns: StreamColumn[];
  rows: number;
}

/** Acumula linhas (de qualquer formato) nas colunas do mapeamento. */
class Builder {
  lat = new F64();
  lon = new F64();
  color: Ids | null;
  columns: StreamColumn[];
  rows = 0;

  constructor(
    private mapping: ImportMapping,
    private colorBy: string | undefined,
    title: string | undefined,
    private recipe: RecipeStep[] = [],
  ) {
    this.color = colorBy ? new Ids() : null;
    this.columns = mapping.columns.map((c): StreamColumn => {
      if (c.type === "number") return { kind: "number", name: c.name, values: new F64() };
      // Milhões de linhas: só o título fica como texto inteiro; o resto (categorias, datas, outros textos)
      // vira índice + dicionário, que cabe na memória (acima de 65 mil valores distintos, o excedente fica vazio).
      if (c.name === title) return { kind: "text", name: c.name, values: [] };
      return { kind: "category", name: c.name, values: new Ids() };
    });
  }

  add(original: Row) {
    // Receita do builder linha a linha (filtros podem tirar a linha).
    const row = this.recipe.length ? applyRecipeToRow(original, this.recipe) : original;
    if (!row) return;
    const m = this.mapping;
    this.rows++;
    const c = readCoordinates(row, m);
    const [lat, lon] = c === null || c === "empty" ? [Number.NaN, Number.NaN] : m.fix ? applyCoordinateFix(m.fix, c[0], c[1]) : c;
    this.lat.push(lat);
    this.lon.push(lon);
    if (this.color) this.color.push(row[this.colorBy!]);
    this.columns.forEach((c, i) => {
      const raw = row[c.name];
      const def = m.columns[i]!;
      if (c.kind === "number") c.values.push(parseNumber(raw, def.locale) ?? Number.NaN);
      else if (c.kind === "category") {
        const t = def.type === "date" && raw ? parseDate(raw) : null;
        c.values.push(t !== null ? new Date(t).toISOString().slice(0, 10) : raw);
      } else c.values.push(raw?.trim() ?? "");
    });
  }

  done(): Columns {
    return { lat: this.lat.get(), lon: this.lon.get(), color: this.color, columns: this.columns, rows: this.rows };
  }
}

/** CSV inteiro aos pedaços (Papa Parse), direto para colunas. */
export function streamCsv(
  file: File,
  opts: { mapping: ImportMapping; colorBy?: string; title?: string; recipe?: RecipeStep[]; delimiter: Delimiter; encoding: Encoding; headerRow?: number },
  onProgress: (fraction: number) => void,
): Promise<Columns> {
  const builder = new Builder(opts.mapping, opts.colorBy, opts.title, opts.recipe);
  let emptyHeaders = 0;
  return new Promise((resolve, reject) => {
    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: "greedy",
      delimiter: opts.delimiter,
      encoding: opts.encoding,
      chunkSize: 8 << 20,
      transformHeader: (h) => h.trim() || `coluna_${++emptyHeaders}`,
      chunk: (results) => {
        for (const row of results.data) builder.add(row);
        onProgress(results.meta.cursor / file.size);
      },
      complete: () => resolve(builder.done()),
      error: (err) => reject(err),
    });
  });
}

/** Parquet inteiro em blocos de linhas, convertidos como na amostra (`toRows`) e jogados nas colunas. */
export async function streamParquet(
  total: number,
  readChunk: (start: number, end: number) => Promise<Row[]>,
  opts: { mapping: ImportMapping; colorBy?: string; title?: string; recipe?: RecipeStep[] },
  onProgress: (fraction: number) => void,
): Promise<Columns> {
  const builder = new Builder(opts.mapping, opts.colorBy, opts.title, opts.recipe);
  const STEP = 200_000;
  for (let start = 0; start < total; start += STEP) {
    const rows = await readChunk(start, Math.min(total, start + STEP));
    for (const row of rows) builder.add(row);
    onProgress(Math.min(1, (start + STEP) / total));
  }
  return builder.done();
}
