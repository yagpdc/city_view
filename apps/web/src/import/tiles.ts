/**
 * Arquivo do usuário → PMTiles, no próprio navegador (motor em Rust compilado para WebAssembly).
 * Roda dentro do worker de importação; nada sai do computador (docs/adr/0002).
 */
import type { ImportMapping, PointFeature } from "@cityview/importer";
import init, { TileJob, last_panic } from "@cityview/tiler-wasm";
import wasmUrl from "@cityview/tiler-wasm/wasm?url";
import type { Columns } from "./stream";

export interface TileReport {
  records: number;
  categories: string[];
  bounds: [number, number, number, number];
  tilesBytes: number;
}

/** Malha para contar os registros por região (do mais amplo ao mais fino). */
export interface RegionSource {
  id: string;
  url: string;
  code: string;
}
type Options = { name: string; colorBy?: string; title?: string; regions?: RegionSource[] };
type Result = { bytes: Uint8Array; report: TileReport };

let ready: Promise<unknown> | null = null;
/**
 * Texto viaja como uma string por coluna, valores unidos por U+001F (o motor divide): milhões de strings
 * soltas quebram a ponte JS↔WASM quando a memória do WASM cresce durante a cópia.
 */
const SEP = "\u001f";
const join = (values: string[]) => values.map((v) => v.replaceAll(SEP, " ")).join(SEP);

async function newJob(name: string): Promise<TileJob> {
  ready ??= init({ module_or_path: wasmUrl });
  await ready;
  return new TileJob(name);
}

const regionText = new Map<string, Promise<string | null>>();

/** Entrega as malhas ao motor; sem rede ou sem a malha, a camada sai sem a contagem por região. */
async function addRegions(job: TileJob, regions: RegionSource[] = []): Promise<void> {
  for (const r of regions) {
    let text = regionText.get(r.url);
    if (!text) {
      text = fetch(r.url)
        .then((res) => (res.ok ? res.text() : null))
        .catch(() => null);
      regionText.set(r.url, text);
    }
    const json = await text;
    if (!json) {
      console.warn("[regiões] malha indisponível:", r.url);
      continue;
    }
    try {
      job.add_regions(r.id, json, r.code);
    } catch (e) {
      console.warn("[regiões]", r.id, (e as Error).message);
    }
  }
}

/** Roda o motor e devolve bytes + relatório. */
function run(job: TileJob, onProgress: (stage: string, fraction: number) => void): Result {
  let bytes: Uint8Array;
  try {
    bytes = job.build((stage: string, fraction: number) => onProgress(stage, fraction));
  } catch (e) {
    // Pânico no Rust chega como "unreachable": a mensagem real fica guardada no motor.
    throw new Error(last_panic() ?? (e as Error).message);
  }
  const raw = JSON.parse(job.report() ?? "{}") as { records?: number; categories?: string[]; bounds?: [number, number, number, number]; tilesBytes?: number };
  // Só libera depois de dar certo: se o motor falhou no meio, `free` esconderia o erro original.
  job.free();
  return {
    bytes,
    report: { records: raw.records ?? 0, categories: raw.categories ?? [], bounds: raw.bounds ?? [0, 0, 0, 0], tilesBytes: raw.tilesBytes ?? bytes.length },
  };
}

/**
 * Arquivos de até ~2 milhões de linhas: feições já validadas (números e datas convertidos pelo importador).
 */
export async function buildTiles(features: PointFeature[], mapping: ImportMapping, options: Options, onProgress: (stage: string, fraction: number) => void): Promise<Result> {
  const job = await newJob(options.name);
  const n = features.length;
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  features.forEach((f, i) => {
    lon[i] = f.geometry.coordinates[0];
    lat[i] = f.geometry.coordinates[1];
  });
  job.set_points(lat, lon);
  const text = (name: string) => join(features.map((f) => (f.properties[name] === null || f.properties[name] === undefined ? "" : String(f.properties[name]))));
  if (options.colorBy) job.set_color(options.colorBy, text(options.colorBy));
  if (options.title) job.set_title(options.title);
  for (const c of mapping.columns) {
    if (c.type === "number") {
      const values = new Float64Array(n);
      features.forEach((f, i) => {
        const v = f.properties[c.name];
        values[i] = typeof v === "number" ? v : Number.NaN;
      });
      job.add_number(c.name, values);
    } else if (c.type === "category") job.add_category(c.name, text(c.name));
    // Texto e datas vão nos pontos: no navegador não há "arquivo de origem" para buscar depois.
    else job.add_text(c.name, text(c.name));
  }
  await addRegions(job, options.regions);
  return run(job, onProgress);
}

/** Arquivos grandes: colunas compactas lidas aos pedaços (`stream.ts`). */
export async function buildTilesFromColumns(cols: Columns, options: Options, onProgress: (stage: string, fraction: number) => void): Promise<Result> {
  const job = await newJob(options.name);
  job.set_points(cols.lat, cols.lon);
  if (options.colorBy && cols.color) job.set_color_ids(options.colorBy, cols.color.get(), join(cols.color.values));
  if (options.title) job.set_title(options.title);
  for (const c of cols.columns) {
    if (c.kind === "number") job.add_number(c.name, c.values.get());
    else if (c.kind === "category") job.add_category_ids(c.name, c.values.get(), join(c.values.values));
    else job.add_text(c.name, join(c.values));
  }
  await addRegions(job, options.regions);
  return run(job, onProgress);
}
