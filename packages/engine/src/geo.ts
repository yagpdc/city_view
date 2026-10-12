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

// WGS84
const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_B = WGS84_A * (1 - WGS84_F);

/**
 * Distância geodésica no elipsoide WGS84 (Vincenty, fórmula inversa), em metros.
 * Pontos quase antípodas podem não convergir; nesse caso cai na esfera de raio médio.
 */
export function geodesicDistanceM([lon1, lat1]: Position, [lon2, lat2]: Position): number {
  const rad = Math.PI / 180;
  const L = (lon2 - lon1) * rad;
  const U1 = Math.atan((1 - WGS84_F) * Math.tan(lat1 * rad));
  const U2 = Math.atan((1 - WGS84_F) * Math.tan(lat2 * rad));
  const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1), sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);
  let λ = L;
  for (let i = 0; i < 100; i++) {
    const sinλ = Math.sin(λ), cosλ = Math.cos(λ);
    const sinσ = Math.sqrt((cosU2 * sinλ) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosλ) ** 2);
    if (sinσ === 0) return 0;
    const cosσ = sinU1 * sinU2 + cosU1 * cosU2 * cosλ;
    const σ = Math.atan2(sinσ, cosσ);
    const sinα = (cosU1 * cosU2 * sinλ) / sinσ;
    const cos2α = 1 - sinα ** 2;
    const cos2σm = cos2α === 0 ? 0 : cosσ - (2 * sinU1 * sinU2) / cos2α;
    const C = (WGS84_F / 16) * cos2α * (4 + WGS84_F * (4 - 3 * cos2α));
    const prev = λ;
    λ = L + (1 - C) * WGS84_F * sinα * (σ + C * sinσ * (cos2σm + C * cosσ * (-1 + 2 * cos2σm ** 2)));
    if (Math.abs(λ - prev) < 1e-12) {
      const u2 = (cos2α * (WGS84_A ** 2 - WGS84_B ** 2)) / WGS84_B ** 2;
      const A = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
      const B = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
      const Δσ =
        B * sinσ * (cos2σm + (B / 4) * (cosσ * (-1 + 2 * cos2σm ** 2) - (B / 6) * cos2σm * (-3 + 4 * sinσ ** 2) * (-3 + 4 * cos2σm ** 2)));
      return WGS84_B * A * (σ - Δσ);
    }
  }
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(L / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * 1000 * Math.asin(Math.sqrt(a));
}
