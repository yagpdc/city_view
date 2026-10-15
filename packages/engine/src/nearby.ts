/**
 * "O que tem por perto": pontos de um dataset num raio, lidos direto do PMTiles no zoom dos pontos
 * (independe do que está desenhado na tela) e medidos no elipsoide.
 */
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import type { PMTiles } from "pmtiles";
import { matchesWhere, type Where } from "./filter";
import { areaBounds, circleArea, geodesicDistanceM, pointInArea, type AreaGeometry, type Position } from "./geo";

export interface NearbyPoint {
  lngLat: Position;
  distanceM: number;
  /** Índice da categoria de cor, ou null. */
  category: number | null;
  properties: Record<string, string | number>;
}

export interface NearbySummary {
  center: Position;
  radiusM: number;
  total: number;
  /** Contagem por categoria de cor (mesma ordem de `meta.categories`). */
  byCategory: number[];
  /** Pontos do raio, do mais perto ao mais longe. */
  points: NearbyPoint[];
}

/** Acima disso o raio cobre tiles demais no zoom dos pontos. */
const MAX_TILES = 64;

const lonToTile = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
function latToTile(lat: number, z: number): number {
  const r = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z);
}

export async function loadNearby(
  pmtiles: PMTiles,
  options: { center: Position; radiusM: number; zoom: number; categoryProperty: string; categories: number },
): Promise<NearbySummary> {
  const { center, radiusM, zoom, categoryProperty } = options;
  const [w, s, e, n] = areaBounds(circleArea(center, radiusM / 1000, 32));
  const x0 = lonToTile(w, zoom), x1 = lonToTile(e, zoom), y0 = latToTile(n, zoom), y1 = latToTile(s, zoom);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES) throw new Error("raio grande demais para contar ponto a ponto");

  const jobs: Promise<NearbyPoint[]>[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      jobs.push(
        pmtiles.getZxy(zoom, x, y).then((res) => {
          if (!res) return [];
          const layer = new VectorTile(new PbfReader(new Uint8Array(res.data))).layers.points;
          if (!layer) return [];
          const out: NearbyPoint[] = [];
          for (let i = 0; i < layer.length; i++) {
            const f = layer.feature(i).toGeoJSON(x, y, zoom) as unknown as {
              geometry: { type: string; coordinates: Position };
              properties: Record<string, string | number>;
            };
            if (f.geometry.type !== "Point") continue;
            const lngLat: Position = [f.geometry.coordinates[0], f.geometry.coordinates[1]];
            const distanceM = geodesicDistanceM(center, lngLat);
            if (distanceM > radiusM) continue;
            const { [categoryProperty]: c, ...properties } = f.properties;
            out.push({ lngLat, distanceM, category: typeof c === "number" ? c : null, properties: { ...properties } });
          }
          return out;
        }),
      );
    }
  }
  const points = (await Promise.all(jobs)).flat().sort((a, b) => a.distanceM - b.distanceM);
  const byCategory = new Array<number>(options.categories).fill(0);
  for (const p of points) if (p.category !== null && p.category < byCategory.length) byCategory[p.category]!++;
  return { center, radiusM, total: points.length, byCategory, points };
}

/**
 * Conta, ponto a ponto, os registros dentro de uma área (anotações), lendo os tiles do zoom dos pontos.
 * `null` quando a área cobre tiles demais nesse zoom (quem chama soma os hexágonos).
 */
export async function countPointsInArea(
  pmtiles: PMTiles,
  options: { area: AreaGeometry; zoom: number; categoryProperty: string; categories: number; allowed: number[] | null; where?: Where },
): Promise<{ count: number; byCategory: number[] } | null> {
  const { area, zoom, categoryProperty, allowed, where } = options;
  const [w, s, e, n] = areaBounds(area);
  const x0 = lonToTile(w, zoom), x1 = lonToTile(e, zoom), y0 = latToTile(n, zoom), y1 = latToTile(s, zoom);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES) return null;
  const byCategory = new Array<number>(options.categories).fill(0);
  const seen = new Set<string | number>();
  let count = 0;
  const jobs: Promise<void>[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      jobs.push(
        cachedTile(pmtiles, zoom, x, y).then((layer) => {
          if (!layer) return;
          for (let i = 0; i < layer.length; i++) {
            const feature = layer.feature(i);
            const f = feature.toGeoJSON(x, y, zoom) as unknown as { geometry: { type: string; coordinates: Position }; properties: Record<string, string | number> };
            if (f.geometry.type !== "Point") continue;
            const lngLat: Position = [f.geometry.coordinates[0], f.geometry.coordinates[1]];
            if (lngLat[0] < w || lngLat[0] > e || lngLat[1] < s || lngLat[1] > n || !pointInArea(lngLat, area)) continue;
            // O mesmo ponto pode vir em dois tiles (borda): conta uma vez.
            const key = feature.id ?? `${lngLat[0]},${lngLat[1]}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const { [categoryProperty]: c, ...properties } = f.properties;
            const category = typeof c === "number" ? c : null;
            if (allowed && (category === null || !allowed.includes(category))) continue;
            if (where && !matchesWhere(properties, where)) continue;
            count++;
            if (category !== null && category < byCategory.length) byCategory[category]!++;
          }
        }),
      );
    }
  }
  await Promise.all(jobs);
  return { count, byCategory };
}

/** Tiles de pontos já decodificados, por arquivo (buscas seguidas não baixam de novo). */
const tileCache = new WeakMap<PMTiles, Map<string, Promise<ReturnType<typeof decodePoints>>>>();

function decodePoints(data: ArrayBuffer) {
  return new VectorTile(new PbfReader(new Uint8Array(data))).layers.points ?? null;
}

function cachedTile(pmtiles: PMTiles, z: number, x: number, y: number) {
  let cache = tileCache.get(pmtiles);
  if (!cache) tileCache.set(pmtiles, (cache = new Map()));
  const key = `${z}/${x}/${y}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = pmtiles.getZxy(z, x, y).then((res) => (res ? decodePoints(res.data) : null));
    pending.catch(() => cache!.delete(key));
    cache.set(key, pending);
  }
  return pending;
}

export interface SearchHit extends NearbyPoint {
  id: number;
  title: string;
  /** Menor = melhor (0: começa com a busca; 1: alguma palavra começa; 2: contém). */
  rank: number;
}

/** Texto para comparar: minúsculas, sem acentos, espaços simples. */
export const normalizeText = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Busca por nome (coluna de título) nos pontos ao redor de um centro, lendo os tiles do zoom
 * dos pontos. Só decodifica a geometria dos que batem. Ordena por relevância e distância.
 */
export async function searchPoints(
  pmtiles: PMTiles,
  options: { query: string; center: Position; radiusM: number; zoom: number; titleProperty: string; categoryProperty: string; limit: number },
): Promise<SearchHit[]> {
  const q = normalizeText(options.query);
  if (q.length < 2) return [];
  const words = q.split(" ");
  const { center, radiusM, zoom, titleProperty, categoryProperty } = options;
  // O raio encolhe até caber no limite de tiles (zonas muito ao norte/sul ou zoom alto).
  let r = radiusM;
  let range: { x0: number; x1: number; y0: number; y1: number };
  for (;;) {
    const [w, s, e, n] = areaBounds(circleArea(center, r / 1000, 32));
    range = { x0: lonToTile(w, zoom), x1: lonToTile(e, zoom), y0: latToTile(n, zoom), y1: latToTile(s, zoom) };
    if ((range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1) <= MAX_TILES || r < 500) break;
    r *= 0.75;
  }
  const jobs: Promise<SearchHit[]>[] = [];
  for (let x = range.x0; x <= range.x1; x++) {
    for (let y = range.y0; y <= range.y1; y++) {
      jobs.push(
        cachedTile(pmtiles, zoom, x, y).then((layer) => {
          if (!layer) return [];
          const out: SearchHit[] = [];
          for (let i = 0; i < layer.length; i++) {
            const feature = layer.feature(i);
            const title = feature.properties[titleProperty];
            if (typeof title !== "string") continue;
            const t = normalizeText(title);
            if (!words.every((w) => t.includes(w))) continue;
            const rank = t.startsWith(q) ? 0 : t.split(" ").some((tw) => tw.startsWith(words[0]!)) ? 1 : 2;
            const g = feature.toGeoJSON(x, y, zoom) as unknown as { geometry: { type: string; coordinates: Position } };
            if (g.geometry.type !== "Point") continue;
            const lngLat: Position = [g.geometry.coordinates[0], g.geometry.coordinates[1]];
            const { [categoryProperty]: c, ...properties } = feature.properties as Record<string, string | number>;
            out.push({
              id: Number(feature.id),
              title,
              rank,
              lngLat,
              distanceM: geodesicDistanceM(center, lngLat),
              category: typeof c === "number" ? c : null,
              properties: { ...properties },
            });
          }
          return out;
        }),
      );
    }
  }
  return (await Promise.all(jobs))
    .flat()
    .sort((a, b) => a.rank - b.rank || a.distanceM - b.distanceM)
    .slice(0, options.limit);
}
