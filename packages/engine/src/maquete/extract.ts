/**
 * Dados da maquete: prédios, ruas, água e áreas verdes de um raio, lidos direto do PMTiles do mapa base
 * (independe do que está na tela) e passados para metros locais em torno do centro.
 *
 * Metros locais (plano tangente: x = leste, y = norte) só servem para desenhar a maquete; as medidas
 * mostradas (área construída) são geodésicas, calculadas em lon/lat.
 */
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import type { PMTiles } from "pmtiles";
import { areaBounds, circleArea, pointInArea, type AreaGeometry, type Position } from "../geo";
import { polygonMeasure } from "../measure";

export type XY = [number, number];

export interface MaqueteBuilding {
  /** Anel externo e buracos, em metros locais. */
  rings: XY[][];
  height: number;
  base: number;
  /** Cor de destaque (categoria predominante dos pontos dentro dele) ou null. */
  color: string | null;
  /** Índices (em `points`) dos seus registros que caem neste prédio. */
  records: number[];
}

export interface MaquetePoint {
  x: number;
  y: number;
  color: string;
  /** Altura do prédio onde o ponto está (0 = na rua). */
  ground: number;
  /** Índice do prédio onde o ponto cai, ou -1 (na rua). */
  building: number;
  datasetId: string;
  category: number | null;
  properties: Record<string, string | number>;
  title?: string;
}

export interface MaqueteData {
  center: Position;
  radiusM: number;
  buildings: MaqueteBuilding[];
  roads: { kind: string; line: XY[] }[];
  water: XY[][][];
  parks: XY[][][];
  points: MaquetePoint[];
  stats: { buildings: number; tallestM: number; averageHeightM: number; builtAreaM2: number; points: number; withHeight: number };
}

export interface MaqueteInputPoint {
  lngLat: Position;
  color: string;
  datasetId: string;
  category: number | null;
  properties: Record<string, string | number>;
  title?: string;
}

const M_PER_DEG_LAT = 111_320;

/** Metros locais da maquete (x leste, y norte, a partir do centro) → [lon, lat]. */
export function localToLngLat(center: Position, [x, y]: XY): Position {
  const mLon = M_PER_DEG_LAT * Math.cos((center[1] * Math.PI) / 180);
  return [center[0] + x / mLon, center[1] + y / M_PER_DEG_LAT];
}
const lonToTile = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
function latToTile(lat: number, z: number): number {
  const r = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z);
}
const tileToLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const tileToLat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

/** Recorta um polígono por um polígono convexo (Sutherland–Hodgman). */
function clipPolygon(ring: XY[], clip: XY[]): XY[] {
  let out = ring;
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i]!;
    const b = clip[(i + 1) % clip.length]!;
    const inside = (p: XY) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
    const cross = (p: XY, q: XY): XY => {
      const [x1, y1] = p, [x2, y2] = q, [x3, y3] = a, [x4, y4] = b;
      const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
      return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
    };
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j]!;
      const prev = input[(j + input.length - 1) % input.length]!;
      if (inside(cur)) {
        if (!inside(prev)) out.push(cross(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cross(prev, cur));
    }
    if (out.length === 0) break;
  }
  return out;
}

/** Recorta uma linha pelo círculo: trechos com as duas pontas dentro (o resto, cortado na borda). */
function clipLine(line: XY[], r: number): XY[][] {
  const parts: XY[][] = [];
  let cur: XY[] = [];
  const inside = (p: XY) => p[0] * p[0] + p[1] * p[1] <= r * r;
  const edge = (p: XY, q: XY): XY => {
    // Ponto do segmento p→q na circunferência (resolve |p + t(q-p)| = r).
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const a = dx * dx + dy * dy, b = 2 * (p[0] * dx + p[1] * dy), c = p[0] * p[0] + p[1] * p[1] - r * r;
    const disc = Math.sqrt(Math.max(0, b * b - 4 * a * c));
    const t1 = (-b - disc) / (2 * a), t2 = (-b + disc) / (2 * a);
    const t = t1 >= 0 && t1 <= 1 ? t1 : t2;
    return [p[0] + t * dx, p[1] + t * dy];
  };
  for (let i = 0; i < line.length; i++) {
    const p = line[i]!;
    const prev = line[i - 1];
    if (inside(p)) {
      if (prev && !inside(prev)) cur.push(edge(prev, p));
      cur.push(p);
    } else if (prev && inside(prev)) {
      cur.push(edge(prev, p));
      parts.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) parts.push(cur);
  return parts.filter((p) => p.length > 1);
}

function centroid(ring: XY[]): XY {
  let x = 0, y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

/**
 * Lê a área do PMTiles do mapa base (camadas buildings, roads, water, landuse) no zoom máximo dele.
 * `points` (seus dados) acendem os prédios onde caem e viram feixes de luz.
 */
export async function loadMaqueteData(
  sources: PMTiles[],
  options: { center: Position; radiusM: number; points?: MaqueteInputPoint[] },
): Promise<MaqueteData> {
  const { center, radiusM } = options;
  // Primeira fonte que cobre o centro (o mapa detalhado só existe em algumas áreas).
  let basemap: PMTiles | null = null;
  let z = 15;
  for (const source of sources) {
    const header = await source.getHeader();
    const zz = Math.min(15, header.maxZoom);
    if (await source.getZxy(zz, lonToTile(center[0], zz), latToTile(center[1], zz))) {
      basemap = source;
      z = zz;
      break;
    }
  }
  const [lon0, lat0] = center;
  const mLon = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  const toXY = ([lon, lat]: Position): XY => [(lon - lon0) * mLon, (lat - lat0) * M_PER_DEG_LAT];
  const toLngLat = ([x, y]: XY): Position => [lon0 + x / mLon, lat0 + y / M_PER_DEG_LAT];
  // Círculo como 96-gono convexo, para recortar polígonos.
  const circle: XY[] = Array.from({ length: 96 }, (_, i) => {
    const a = (i / 96) * Math.PI * 2;
    return [Math.cos(a) * radiusM, Math.sin(a) * radiusM];
  });

  const [w, s, e, n] = areaBounds(circleArea(center, radiusM / 1000, 32));
  const tiles: [number, number][] = [];
  for (let x = lonToTile(w, z); x <= lonToTile(e, z); x++) for (let y = latToTile(n, z); y <= latToTile(s, z); y++) tiles.push([x, y]);
  if (tiles.length > 36) throw new Error("raio grande demais para a maquete");
  if (!basemap) throw new Error("sem mapa base nesta área");
  const source = basemap;

  const buildings: (MaqueteBuilding & { lngLat: Position[][] })[] = [];
  const roads: MaqueteData["roads"] = [];
  const water: XY[][][] = [];
  const parks: XY[][][] = [];

  await Promise.all(
    tiles.map(async ([tx, ty]) => {
      const res = await source.getZxy(z, tx, ty);
      if (!res) return;
      const vt = new VectorTile(new PbfReader(new Uint8Array(res.data)));
      // Cada prédio fica com o tile que contém o centro dele (os tiles se sobrepõem na borda).
      const tw = tileToLon(tx, z), te = tileToLon(tx + 1, z), tn = tileToLat(ty, z), ts = tileToLat(ty + 1, z);
      const ownTile = ([lon, lat]: Position) => lon >= tw && lon < te && lat <= tn && lat > ts;

      const polygons = (layerName: string, keep: (p: Record<string, unknown>) => boolean) => {
        const layer = vt.layers[layerName];
        const out: { rings: Position[][]; props: Record<string, unknown> }[] = [];
        if (!layer) return out;
        for (let i = 0; i < layer.length; i++) {
          const f = layer.feature(i);
          if (!keep(f.properties)) continue;
          const g = f.toGeoJSON(tx, ty, z).geometry as { type: string; coordinates: unknown };
          if (g.type === "Polygon") out.push({ rings: g.coordinates as Position[][], props: f.properties });
          else if (g.type === "MultiPolygon") for (const poly of g.coordinates as Position[][][]) out.push({ rings: poly, props: f.properties });
        }
        return out;
      };

      for (const { rings, props } of polygons("buildings", () => true)) {
        const outer = rings[0];
        if (!outer || outer.length < 4) continue;
        const local = rings.map((r) => r.map(toXY));
        const c = centroid(local[0]!);
        if (c[0] * c[0] + c[1] * c[1] > radiusM * radiusM || !ownTile(toLngLat(c))) continue;
        const height = Number(props.height ?? 0);
        buildings.push({ rings: local, lngLat: rings, height: height > 0 ? height : 0, base: Number(props.min_height ?? 0) || 0, color: null, records: [] });
      }
      for (const { rings } of polygons("water", () => true)) {
        const clipped = rings.map((r) => clipPolygon(r.map(toXY), circle)).filter((r) => r.length > 2);
        if (clipped.length) water.push(clipped);
      }
      for (const { rings } of polygons("landuse", (p) => ["park", "forest", "wood", "grass", "garden", "recreation_ground", "pitch", "cemetery", "nature_reserve"].includes(String(p.kind)))) {
        const clipped = rings.map((r) => clipPolygon(r.map(toXY), circle)).filter((r) => r.length > 2);
        if (clipped.length) parks.push(clipped);
      }
      const roadLayer = vt.layers.roads;
      if (roadLayer) {
        for (let i = 0; i < roadLayer.length; i++) {
          const f = roadLayer.feature(i);
          const kind = String(f.properties.kind ?? "minor_road");
          const g = f.toGeoJSON(tx, ty, z).geometry as { type: string; coordinates: unknown };
          const lines = g.type === "LineString" ? [g.coordinates as Position[]] : g.type === "MultiLineString" ? (g.coordinates as Position[][]) : [];
          for (const line of lines) for (const part of clipLine(line.map(toXY), radiusM)) roads.push({ kind, line: part });
        }
      }
    }),
  );

  // Prédios sem altura no OSM: estimativa modesta, para a maquete não virar um tapete.
  let withHeight = 0;
  for (const b of buildings) {
    if (b.height > 0) withHeight++;
    else b.height = 6 + (Math.abs(Math.sin(b.rings[0]![0]![0] * 12.9898 + b.rings[0]![0]![1] * 78.233)) % 1) * 6;
  }

  // Seus dados: acendem o prédio onde caem (cor predominante); os da rua viram alfinetes.
  // Como no "Prédios acesos" do mapa, um ponto fora de qualquer contorno (endereço na calçada) vai para o
  // prédio mais próximo até SNAP_M — senão a maquete vira uma floresta de alfinetes.
  const SNAP_M = 25;
  const boxes = buildings.map((b) => {
    let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [px, py] of b.rings[0]!) [w, s, e, n] = [Math.min(w, px), Math.min(s, py), Math.max(e, px), Math.max(n, py)];
    return [w - SNAP_M, s - SNAP_M, e + SNAP_M, n + SNAP_M] as const;
  });
  /** Distância do ponto à parede mais próxima do prédio (contorno externo, metros locais). */
  const wallDistance = (ring: XY[], x: number, y: number) => {
    let best = Infinity;
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = ring[i - 1]!, [bx, by] = ring[i]!;
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
    }
    return best;
  };
  const points: MaquetePoint[] = [];
  const tally = new Map<number, Map<string, number>>();
  for (const p of options.points ?? []) {
    const [x, y] = toXY(p.lngLat);
    if (x * x + y * y > radiusM * radiusM) continue;
    let ground = 0;
    let bi = buildings.findIndex((b) => pointInArea(p.lngLat, { type: "Polygon", coordinates: b.lngLat } as AreaGeometry));
    if (bi === -1) {
      let best = SNAP_M;
      boxes.forEach(([w, s, e, n], i) => {
        if (x < w || x > e || y < s || y > n) return;
        const d = wallDistance(buildings[i]!.rings[0]!, x, y);
        if (d < best) [best, bi] = [d, i];
      });
    }
    if (bi !== -1) {
      ground = buildings[bi]!.height;
      const t = tally.get(bi) ?? new Map<string, number>();
      t.set(p.color, (t.get(p.color) ?? 0) + 1);
      tally.set(bi, t);
      buildings[bi]!.records.push(points.length);
    }
    points.push({
      x,
      y,
      color: p.color,
      ground,
      building: bi,
      datasetId: p.datasetId,
      category: p.category,
      properties: p.properties,
      ...(p.title && { title: p.title }),
    });
  }
  for (const [bi, t] of tally) buildings[bi]!.color = [...t.entries()].sort((a, b) => b[1] - a[1])[0]![0];

  let builtAreaM2 = 0;
  for (const b of buildings) builtAreaM2 += polygonMeasure(b.lngLat[0]!).areaM2;
  const heights = buildings.map((b) => b.height);
  return {
    center,
    radiusM,
    buildings: buildings.map(({ lngLat: _, ...b }) => b),
    roads,
    water,
    parks,
    points,
    stats: {
      buildings: buildings.length,
      tallestM: heights.length ? Math.max(...heights) : 0,
      averageHeightM: heights.length ? heights.reduce((a, h) => a + h, 0) / heights.length : 0,
      builtAreaM2,
      points: points.length,
      withHeight,
    },
  };
}
