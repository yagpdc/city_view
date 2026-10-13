/**
 * Vista "Regiões": a malha de verdade (estados, municípios…) com a contagem de registros de cada uma, que o
 * tiler grava nos metadados do PMTiles (`regions`). As malhas vêm de GeoJSON do app (ex.: IBGE), carregadas
 * uma vez e compartilhadas por todas as camadas.
 */
import type { AreaGeometry, Position } from "./geo";

/** Um nível da malha e em que zooms ele aparece. */
export interface RegionLevelSource {
  /** Mesmo id usado na contagem do tiler ("uf", "mun"). */
  id: string;
  url: string;
  /** Propriedade com o código (padrão "codigo"). */
  code?: string;
  minzoom: number;
  maxzoom: number;
}

export interface RegionFeature {
  code: string;
  name: string;
  areaKm2: number;
  geometry: AreaGeometry;
  /** Onde vai o número (centro do maior polígono). */
  labelAt: Position;
}

/** Centro de massa do anel externo do maior polígono (onde escrever o número). */
function labelPoint(geometry: AreaGeometry): Position {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let best: Position = [0, 0];
  let bestArea = -1;
  for (const poly of polygons) {
    const ring = poly[0];
    if (!ring || ring.length < 3) continue;
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x0, y0] = ring[j]!;
      const [x1, y1] = ring[i]!;
      const f = x0 * y1 - x1 * y0;
      a += f;
      cx += (x0 + x1) * f;
      cy += (y0 + y1) * f;
    }
    const area = Math.abs(a / 2);
    if (area > bestArea && a !== 0) {
      bestArea = area;
      best = [cx / (3 * a), cy / (3 * a)];
    }
  }
  return best;
}

export class RegionBoundaries {
  private readonly cache = new Map<string, Promise<RegionFeature[]>>();

  constructor(readonly levels: RegionLevelSource[]) {}

  load(levelId: string): Promise<RegionFeature[]> {
    let p = this.cache.get(levelId);
    if (!p) {
      const level = this.levels.find((l) => l.id === levelId);
      const codeProp = level?.code ?? "codigo";
      p = level
        ? fetch(level.url)
            .then((r) => (r.ok ? r.json() : { features: [] }))
            .then((fc: { features: { geometry: AreaGeometry | null; properties: Record<string, string | number> }[] }) =>
              fc.features
                .filter((f) => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"))
                .map((f) => {
                  const p = f.properties;
                  const name = String(p.nome ?? p.name ?? p[codeProp]);
                  return {
                    code: String(p[codeProp]),
                    // Município leva a UF junto ("Campinas · SP"); estado fica só com o nome.
                    name: p.uf && levelId !== "uf" ? `${name} · ${p.uf}` : name,
                    areaKm2: Number(p.area_km2 ?? 0),
                    geometry: f.geometry!,
                    labelAt: labelPoint(f.geometry!),
                  };
                }),
            )
            .catch(() => [])
        : Promise.resolve([]);
      this.cache.set(levelId, p);
    }
    return p;
  }
}

const compactFmt = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const intFmt = new Intl.NumberFormat("pt-BR");
/** "312", "4,8 mil", "1,2 mi". */
export const regionLabel = (n: number) => (n < 10_000 ? intFmt.format(n) : compactFmt.format(n));
