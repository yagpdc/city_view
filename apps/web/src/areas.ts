import { areaBounds, circleArea, pointInArea, type AreaGeometry, type Bounds } from "@cityview/engine";
import { dataUrl } from "./catalog";

/** Uma área da maquete: município (com dados do IBGE) ou raio em volta do clique. */
export interface Area {
  kind: "municipio" | "raio";
  name: string;
  geometry: AreaGeometry;
  areaKm2: number;
  population?: number;
  radiusKm?: number;
}

interface Municipio {
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
  return { kind: "municipio", name: found.name, geometry: found.geometry, areaKm2: found.areaKm2, population: found.population };
}
