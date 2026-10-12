/**
 * "O que tem por perto": pontos de um dataset num raio, lidos direto do PMTiles no zoom dos pontos
 * (independe do que está desenhado na tela) e medidos no elipsoide.
 */
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import type { PMTiles } from "pmtiles";
import { areaBounds, circleArea, geodesicDistanceM, type Position } from "./geo";

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
