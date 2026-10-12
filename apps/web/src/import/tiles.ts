/**
 * Arquivo do usuário → PMTiles, no próprio navegador (motor em Rust compilado para WebAssembly).
 * Roda dentro do worker de importação; nada sai do computador (docs/adr/0002).
 */
import type { ImportMapping, PointFeature } from "@cityview/importer";
import init, { TileJob, last_panic } from "@cityview/tiler-wasm";
import wasmUrl from "@cityview/tiler-wasm/wasm?url";

export interface TileReport {
  records: number;
  categories: string[];
  bounds: [number, number, number, number];
  tilesBytes: number;
}

let ready: Promise<unknown> | null = null;
const SEP = "\u001f";

/**
 * Monta as colunas a partir das feições já validadas (números e datas convertidos pelo importador)
 * e gera o PMTiles com hexágonos agregados e pontos.
 */
export async function buildTiles(
  features: PointFeature[],
  mapping: ImportMapping,
  options: { name: string; colorBy?: string; title?: string },
  onProgress: (stage: string, fraction: number) => void,
): Promise<{ bytes: Uint8Array; report: TileReport }> {
  ready ??= init({ module_or_path: wasmUrl });
  await ready;
  const n = features.length;
  const job = new TileJob(options.name);
  {
    const lat = new Float64Array(n);
    const lon = new Float64Array(n);
    features.forEach((f, i) => {
      lon[i] = f.geometry.coordinates[0];
      lat[i] = f.geometry.coordinates[1];
    });
    job.set_points(lat, lon);
    // Uma string por coluna, valores unidos por U+001F (o motor divide): milhões de strings soltas
    // quebram a ponte JS↔WASM quando a memória cresce durante a cópia.
    const text = (name: string) =>
      features.map((f) => (f.properties[name] === null || f.properties[name] === undefined ? "" : String(f.properties[name]).replaceAll(SEP, " "))).join(SEP);
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
}
