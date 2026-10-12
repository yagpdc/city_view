/**
 * Prédios pintados pelos pontos do cliente.
 *
 * No nível da rua, cruza os pontos do dataset com os prédios do mapa base que estão na tela:
 * o ponto cai dentro de um prédio (ou, se não cair em nenhum, no prédio mais próximo até
 * `maxDistanceM`). Cada prédio com clientes vira uma feição com a categoria predominante,
 * a quantidade e a altura — desenhada como extrusão colorida por cima da cidade cinza.
 */
import type { Map as MapLibreMap } from "maplibre-gl";
import { pointInArea, ringCentroid, type AreaGeometry, type Position } from "./geo";

export interface PaintedBuilding {
  type: "Feature";
  geometry: AreaGeometry;
  /** `recs`: JSON com até MAX_RECORDS registros do prédio (id, categoria, propriedades). */
  properties: { c: number; n: number; h: number; mh: number; recs: string };
}

/** Um registro do cliente dentro de um prédio. */
export interface BuildingRecord {
  id: number;
  category: number;
  properties: Record<string, string | number>;
}

const MAX_RECORDS = 25;

export interface BuildingPaintResult {
  features: PaintedBuilding[];
  points: number;
  matchedPoints: number;
  buildings: number;
}

interface ClientPoint {
  lon: number;
  lat: number;
  category: number;
  id: number;
  properties: Record<string, string | number>;
}

const CELL = 0.0005; // ~55 m
const cellKey = (lon: number, lat: number) => `${Math.floor(lon / CELL)}:${Math.floor(lat / CELL)}`;
const M_PER_DEG_LAT = 111_320;

function bbox(g: AreaGeometry): [number, number, number, number] {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for (const poly of polys) {
    for (const [x, y] of poly[0] ?? []) {
      if (x < w) w = x;
      if (y < s) s = y;
      if (x > e) e = x;
      if (y > n) n = y;
    }
  }
  return [w, s, e, n];
}

function dominant(counts: Map<number, number>): number {
  let best = -1;
  let bestN = -1;
  for (const [c, n] of counts) if (n > bestN || (n === bestN && c < best)) [best, bestN] = [c, n];
  return best;
}

export function paintBuildings(
  map: MapLibreMap,
  opts: {
    pointsSource: string;
    categoryProperty: string;
    buildingsSource: string;
    maxDistanceM?: number;
  },
): BuildingPaintResult {
  const maxDistanceM = opts.maxDistanceM ?? 25;

  // Pontos do cliente carregados na tela (um por id: o mesmo ponto pode vir de mais de um tile).
  const seen = new Set<string | number>();
  const points: ClientPoint[] = [];
  for (const f of map.querySourceFeatures(opts.pointsSource, { sourceLayer: "points" })) {
    if (f.geometry.type !== "Point") continue;
    const key = f.id ?? `${f.geometry.coordinates.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [lon, lat] = f.geometry.coordinates as Position;
    const { [opts.categoryProperty]: c, ...properties } = (f.properties ?? {}) as Record<string, string | number>;
    points.push({ lon, lat, category: c === undefined || c === null ? -1 : Number(c), id: Number(f.id ?? 0), properties });
  }
  const grid = new Map<string, number[]>();
  points.forEach((p, i) => {
    const k = cellKey(p.lon, p.lat);
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });

  // Prédios na tela.
  const buildings: { geometry: AreaGeometry; props: Record<string, unknown>; center: Position; box: [number, number, number, number] }[] = [];
  for (const f of map.querySourceFeatures(opts.buildingsSource, { sourceLayer: "buildings" })) {
    if (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon") continue;
    const geometry = f.geometry as AreaGeometry;
    const outer = geometry.type === "Polygon" ? geometry.coordinates[0] : geometry.coordinates[0]?.[0];
    if (!outer || outer.length < 3) continue;
    buildings.push({ geometry, props: f.properties ?? {}, center: ringCentroid(outer), box: bbox(geometry) });
  }

  // 1) Pontos dentro de prédios.
  const assignment = new Int32Array(points.length).fill(-1);
  buildings.forEach((b, bi) => {
    const [w, s, e, n] = b.box;
    for (let x = Math.floor(w / CELL); x <= Math.floor(e / CELL); x++) {
      for (let y = Math.floor(s / CELL); y <= Math.floor(n / CELL); y++) {
        for (const pi of grid.get(`${x}:${y}`) ?? []) {
          if (assignment[pi]! !== -1) continue;
          const p = points[pi]!;
          if (p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n && pointInArea([p.lon, p.lat], b.geometry)) assignment[pi] = bi;
        }
      }
    }
  });

  // 2) Pontos soltos: prédio mais próximo (pelo centro) dentro do raio.
  const centerGrid = new Map<string, number[]>();
  buildings.forEach((b, bi) => {
    const k = cellKey(b.center[0], b.center[1]);
    const list = centerGrid.get(k);
    if (list) list.push(bi);
    else centerGrid.set(k, [bi]);
  });
  points.forEach((p, pi) => {
    if (assignment[pi]! !== -1) return;
    const cx = Math.floor(p.lon / CELL);
    const cy = Math.floor(p.lat / CELL);
    const mPerDegLon = M_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180);
    let best = -1;
    let bestD = maxDistanceM;
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (const bi of centerGrid.get(`${x}:${y}`) ?? []) {
          const [bx, by] = buildings[bi]!.center;
          const d = Math.hypot((bx - p.lon) * mPerDegLon, (by - p.lat) * M_PER_DEG_LAT);
          if (d < bestD) [best, bestD] = [bi, d];
        }
      }
    }
    assignment[pi] = best;
  });

  // Agrega por prédio.
  const perBuilding = new Map<number, Map<number, number>>();
  const recordsPerBuilding = new Map<number, BuildingRecord[]>();
  let matchedPoints = 0;
  points.forEach((p, pi) => {
    const bi = assignment[pi]!;
    if (bi === -1) return;
    matchedPoints++;
    let counts = perBuilding.get(bi);
    if (!counts) perBuilding.set(bi, (counts = new Map()));
    counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    let recs = recordsPerBuilding.get(bi);
    if (!recs) recordsPerBuilding.set(bi, (recs = []));
    if (recs.length < MAX_RECORDS) recs.push({ id: p.id, category: p.category, properties: p.properties });
  });

  const features: PaintedBuilding[] = [];
  for (const [bi, counts] of perBuilding) {
    const b = buildings[bi]!;
    const n = [...counts.values()].reduce((a, v) => a + v, 0);
    const h = Number(b.props.height ?? 0) || 6;
    features.push({
      type: "Feature",
      geometry: b.geometry,
      properties: {
        c: dominant(counts),
        n,
        h,
        mh: Number(b.props.min_height ?? 0) || 0,
        recs: JSON.stringify(recordsPerBuilding.get(bi) ?? []),
      },
    });
  }
  return { features, points: points.length, matchedPoints, buildings: buildings.length };
}
