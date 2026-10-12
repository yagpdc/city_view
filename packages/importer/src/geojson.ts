import type { Row } from "./detect";

type Position = number[];
interface Geometry {
  type: string;
  coordinates?: unknown;
  geometries?: Geometry[];
}
interface Feature {
  type: "Feature";
  geometry: Geometry | null;
  properties: Record<string, unknown> | null;
}

export interface GeoJsonRows {
  rows: Row[];
  /** Colunas criadas com a posição de cada feição. */
  lon: string;
  lat: string;
  /** Feições que não eram ponto e viraram o centro da sua extensão. */
  converted: number;
  /** Feições sem geometria (ficam sem posição). */
  withoutGeometry: number;
}

function* positions(g: Geometry): Generator<Position> {
  if (g.type === "GeometryCollection") {
    for (const child of g.geometries ?? []) yield* positions(child);
    return;
  }
  const walk = function* (c: unknown): Generator<Position> {
    if (Array.isArray(c) && typeof c[0] === "number") yield c as Position;
    else if (Array.isArray(c)) for (const x of c) yield* walk(x);
  };
  yield* walk(g.coordinates);
}

/** Ponto: a própria posição. Outras geometrias: centro da extensão (bbox). */
function anchor(g: Geometry): { point: Position; converted: boolean } | null {
  if (g.type === "Point" && Array.isArray(g.coordinates)) return { point: g.coordinates as Position, converted: false };
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of positions(g)) {
    if (x === undefined || y === undefined) continue;
    w = Math.min(w, x); e = Math.max(e, x);
    s = Math.min(s, y); n = Math.max(n, y);
  }
  if (!Number.isFinite(w)) return null;
  return { point: [(w + e) / 2, (s + n) / 2], converted: g.type !== "MultiPoint" || w !== e || s !== n };
}

const cell = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Nome de coluna livre, sem colidir com as propriedades. */
function freeName(base: string, taken: Set<string>): string {
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
  return name;
}

/**
 * GeoJSON (FeatureCollection, Feature ou geometria solta) → linhas de texto,
 * com a posição em colunas de longitude/latitude, para seguir o mesmo fluxo do CSV.
 */
export function geoJsonToRows(input: unknown): GeoJsonRows {
  const root = input as { type?: string; features?: Feature[] };
  const features: Feature[] =
    root?.type === "FeatureCollection" && Array.isArray(root.features)
      ? root.features
      : root?.type === "Feature"
        ? [root as unknown as Feature]
        : root?.type
          ? [{ type: "Feature", geometry: root as Geometry, properties: {} }]
          : [];
  if (features.length === 0) throw new Error("O arquivo não é um GeoJSON com feições.");

  const keys = new Set<string>();
  for (const f of features) for (const k of Object.keys(f.properties ?? {})) keys.add(k);
  const lon = freeName("longitude", keys);
  const lat = freeName("latitude", keys);

  let converted = 0;
  let withoutGeometry = 0;
  const rows: Row[] = features.map((f) => {
    const row: Row = {};
    for (const k of keys) row[k] = cell(f.properties?.[k]);
    const a = f.geometry ? anchor(f.geometry) : null;
    if (!a) withoutGeometry++;
    else if (a.converted) converted++;
    row[lon] = a ? String(a.point[0]) : "";
    row[lat] = a ? String(a.point[1]) : "";
    return row;
  });
  return { rows, lon, lat, converted, withoutGeometry };
}
