import { areaBounds, circleArea, pointInArea, type AreaGeometry, type Bounds } from "@cityview/engine";
import { dataUrl } from "./catalog";

/** Uma área da maquete: município (com dados do IBGE) ou raio em volta do clique. */
export interface Area {
  kind: "municipio" | "raio";
  name: string;
  geometry: AreaGeometry;
  areaKm2: number;
  population?: number;
  /** Código IBGE (7 dígitos), quando a área é um município. */
  code?: string;
  radiusKm?: number;
}

interface Municipio {
  code: string;
  name: string;
  population: number;
  areaKm2: number;
  geometry: AreaGeometry;
  bounds: Bounds;
}

let municipios: Promise<Municipio[]> | null = null;

/** Malha municipal do catálogo (gerada por datapacks/build.py), carregada uma vez. */
function loadMunicipios(): Promise<Municipio[]> {
  municipios ??= fetch(dataUrl("municipios-populacao"))
    .then((r) => (r.ok ? r.json() : { features: [] }))
    .then((fc: { features: { geometry: AreaGeometry; properties: Record<string, string | number> }[] }) =>
      fc.features.map((f) => ({
        code: String(f.properties.codigo),
        name: `${f.properties.nome} · ${f.properties.uf}`,
        population: Number(f.properties.populacao),
        areaKm2: Number(f.properties.area_km2),
        geometry: f.geometry,
        bounds: areaBounds(f.geometry),
      })),
    )
    .catch(() => []);
  return municipios;
}

export function radiusArea(center: [number, number], radiusKm: number): Area {
  return {
    kind: "raio",
    name: radiusKm < 1 ? `Raio de ${radiusKm * 1000} m` : `Raio de ${radiusKm} km`,
    geometry: circleArea(center, radiusKm),
    areaKm2: Math.PI * radiusKm * radiusKm,
    radiusKm,
  };
}

/** Município que contém o ponto; fora do Brasil (ou sem a malha), um raio de 10 km. */
export async function areaAt(lngLat: [number, number]): Promise<Area> {
  const [x, y] = lngLat;
  const list = await loadMunicipios();
  const found = list.find(
    (m) => x >= m.bounds[0] && x <= m.bounds[2] && y >= m.bounds[1] && y <= m.bounds[3] && pointInArea(lngLat, m.geometry),
  );
  if (!found) return radiusArea(lngLat, 10);
  return {
    kind: "municipio",
    name: found.name,
    code: found.code,
    geometry: found.geometry,
    areaKm2: found.areaKm2,
    population: found.population,
  };
}

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Municípios pelo nome ("curitiba", "sao paulo sp"); os maiores primeiro entre os que batem igual. */
export async function searchMunicipios(query: string, limit = 4): Promise<{ code: string; name: string; bounds: Bounds; population: number }[]> {
  const q = fold(query).replace(/[·,-]/g, " ").replace(/\s+/g, " ");
  if (q.length < 2) return [];
  const words = q.split(" ");
  const all = await loadMunicipios();
  return all
    .map((m) => {
      const name = fold(m.name).replace(/[·,-]/g, " ").replace(/\s+/g, " ");
      if (!words.every((w) => name.includes(w))) return null;
      return { m, rank: name.startsWith(q) ? 0 : 1 };
    })
    .filter((x): x is { m: Municipio; rank: number } => x !== null)
    .sort((a, b) => a.rank - b.rank || b.m.population - a.m.population)
    .slice(0, limit)
    .map(({ m }) => ({ code: m.code, name: m.name, bounds: m.bounds, population: m.population }));
}

/** "-23.56, -46.65" ou "-23.56 -46.65" (lat, lon) → [lon, lat]. */
export function parseCoordinates(query: string): [number, number] | null {
  const m = /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/.exec(query.replace(/(\d),(\d)(?=.*[,; ]\s*-?\d)/, "$1.$2"));
  if (!m) return null;
  const lat = Number(m[1]!.replace(",", "."));
  const lon = Number(m[2]!.replace(",", "."));
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  return [lon, lat];
}
