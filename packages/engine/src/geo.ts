/** Utilidades geográficas pequenas (sem dependências) para áreas da maquete. */

export type Position = [number, number];
export type Ring = Position[];
export type AreaGeometry = { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };
export type Bounds = [number, number, number, number];

const EARTH_RADIUS_KM = 6371.0088;

function polygons(g: AreaGeometry): Ring[][] {
  return g.type === "Polygon" ? [g.coordinates] : g.coordinates;
}

function inRing([x, y]: Position, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Ponto dentro do polígono (considera buracos e multipolígonos). */
export function pointInArea(point: Position, g: AreaGeometry): boolean {
  return polygons(g).some(([outer, ...holes]) => outer !== undefined && inRing(point, outer) && !holes.some((h) => inRing(point, h)));
}

export function areaBounds(g: AreaGeometry): Bounds {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of polygons(g)) {
    for (const [x, y] of poly[0] ?? []) {
      if (x < w) w = x;
      if (y < s) s = y;
      if (x > e) e = x;
      if (y > n) n = y;
    }
  }
  return [w, s, e, n];
}

/** Média dos vértices (suficiente para hexágonos e polígonos convexos pequenos). */
export function ringCentroid(ring: Ring): Position {
  const pts = ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
  const sum = pts.reduce<Position>((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
  return [sum[0] / pts.length, sum[1] / pts.length];
}

/** Círculo geodésico aproximado como polígono. */
export function circleArea([lon, lat]: Position, radiusKm: number, steps = 96): AreaGeometry {
  const d = radiusKm / EARTH_RADIUS_KM;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const ring: Ring = [];
  for (let i = 0; i <= steps; i++) {
    const θ = (2 * Math.PI * i) / steps;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    ring.push([(λ2 * 180) / Math.PI, (φ2 * 180) / Math.PI]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

/** O mundo menos a área: um polígono com a área como buraco (para escurecer o entorno). */
export function worldMask(g: AreaGeometry): { type: "Feature"; properties: object; geometry: AreaGeometry } {
  const world: Ring = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ];
  const holes = polygons(g).map((p) => p[0]!).filter(Boolean);
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [world, ...holes] } };
}
