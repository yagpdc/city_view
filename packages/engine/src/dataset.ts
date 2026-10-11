import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  Map as MapLibreMap,
  PointLike,
} from "maplibre-gl";
import type { PMTiles } from "pmtiles";

/** Metadados gravados pelo cityview-tiler (`cityview` no JSON do PMTiles). */
export interface DatasetMeta {
  records: number;
  sectors: number;
  hexMaxZoom: number;
  pointsZoom: number;
  densityBreaks: number[];
}

export interface DatasetFilter {
  /** Setores visíveis (índices). Vazio/ausente = todos. Vale para pontos e agregados. */
  sectors?: number[];
  /** Portes visíveis. Por enquanto só afeta os pontos individuais (zoom alto). */
  sizes?: number[];
  yearMin?: number;
  yearMax?: number;
}

export type DatasetPick =
  | { kind: "record"; id: number; sector: number; size: number; year: number; lngLat: [number, number] }
  | { kind: "aggregate"; count: number; bySector: number[]; areaKm2: number; lngLat: [number, number] };

export const SECTOR_COLORS = [
  "#4e79a7",
  "#f28e2b",
  "#e15759",
  "#76b7b2",
  "#59a14f",
  "#edc948",
  "#b07aa1",
  "#ff9da7",
  "#9c755f",
  "#bab0ac",
];

/** Escala sequencial (densidade baixa → alta), um tom a mais que o número de quebras. */
const DENSITY_COLORS = ["#fff3c4", "#fed98e", "#fdb863", "#f98e4b", "#ec5f3c", "#d03b3f", "#9e1f4a"];

function sectorColorExpression(): ExpressionSpecification {
  const pairs = SECTOR_COLORS.flatMap((color, i) => [i, color]);
  return ["match", ["get", "sector"], ...pairs, "#888888"] as unknown as ExpressionSpecification;
}

export async function readDatasetMeta(pmtiles: PMTiles): Promise<DatasetMeta> {
  const metadata = (await pmtiles.getMetadata()) as { cityview?: DatasetMeta } | undefined;
  if (!metadata?.cityview) {
    throw new Error("PMTiles sem metadados `cityview`: o arquivo precisa ser gerado pelo cityview-tiler.");
  }
  return metadata.cityview;
}

export class DatasetLayer {
  private filter: DatasetFilter = {};
  private visible = true;
  private readonly sourceId: string;
  private readonly hexLayerId: string;
  private readonly pointsLayerId: string;

  constructor(
    private readonly map: MapLibreMap,
    readonly id: string,
    private readonly url: string,
    readonly meta: DatasetMeta,
  ) {
    this.sourceId = `cv-${id}`;
    this.hexLayerId = `cv-${id}-hex`;
    this.pointsLayerId = `cv-${id}-points`;
  }

  get layerIds(): string[] {
    return [this.hexLayerId, this.pointsLayerId];
  }

  /** (Re)adiciona fonte e camadas. Chamado na criação e sempre que o estilo é recarregado. */
  attach(): void {
    if (this.map.getSource(this.sourceId)) return;
    this.map.addSource(this.sourceId, { type: "vector", url: `pmtiles://${this.url}` });

    // Dados acima do mapa base, mas abaixo dos rótulos.
    const beforeId = this.map.getStyle().layers.find((l) => l.type === "symbol")?.id;
    for (const layer of this.layers()) this.map.addLayer(layer, beforeId);
    this.setVisible(this.visible);
  }

  setFilter(filter: DatasetFilter): void {
    this.filter = { ...filter };
    if (!this.map.getLayer(this.hexLayerId)) return;
    const count = this.countExpression();
    this.map.setPaintProperty(this.hexLayerId, "fill-color", this.densityColor(count));
    this.map.setFilter(this.hexLayerId, [">", count, 0]);
    this.map.setFilter(this.pointsLayerId, this.pointsFilter());
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const id of this.layerIds) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    }
  }

  getFilter(): DatasetFilter {
    return { ...this.filter };
  }

  pick(point: PointLike): DatasetPick | null {
    if (!this.visible) return null;
    const [feature] = this.map.queryRenderedFeatures(point, { layers: this.layerIds });
    if (!feature) return null;
    const p = feature.properties as Record<string, number>;
    const at = this.map.unproject(point);
    const lngLat: [number, number] = [at.lng, at.lat];
    if (feature.layer.id === this.pointsLayerId) {
      return { kind: "record", id: Number(feature.id), sector: p.sector!, size: p.size!, year: p.year!, lngLat };
    }
    const bySector = Array.from({ length: this.meta.sectors }, (_, i) => p[`s${i}`] ?? 0);
    const visible = this.activeSectors();
    const count = visible ? visible.reduce((sum, s) => sum + (bySector[s] ?? 0), 0) : p.n!;
    return { kind: "aggregate", count, bySector, areaKm2: p.a!, lngLat };
  }

  private activeSectors(): number[] | null {
    const s = this.filter.sectors;
    return s && s.length > 0 && s.length < this.meta.sectors ? s : null;
  }

  /** Contagem do hexágono considerando só os setores selecionados. */
  private countExpression(): ExpressionSpecification {
    const sectors = this.activeSectors();
    if (!sectors) return ["get", "n"];
    const parts: ExpressionSpecification[] = sectors.map((s) => ["coalesce", ["get", `s${s}`], 0]);
    return parts.length === 1 ? parts[0]! : ["+", ...parts];
  }

  private densityColor(count: ExpressionSpecification): ExpressionSpecification {
    const breaks = [...new Set(this.meta.densityBreaks)].sort((a, b) => a - b);
    const stops = breaks.flatMap((b, i) => [b, DENSITY_COLORS[Math.min(i + 1, DENSITY_COLORS.length - 1)]!]);
    return ["step", ["/", count, ["get", "a"]], DENSITY_COLORS[0]!, ...stops] as ExpressionSpecification;
  }

  private pointsFilter(): FilterSpecification {
    const f = this.filter;
    const conditions: ExpressionSpecification[] = [];
    const sectors = this.activeSectors();
    if (sectors) conditions.push(["in", ["get", "sector"], ["literal", sectors]]);
    if (f.sizes && f.sizes.length > 0) conditions.push(["in", ["get", "size"], ["literal", f.sizes]]);
    if (f.yearMin !== undefined) conditions.push([">=", ["get", "year"], f.yearMin]);
    if (f.yearMax !== undefined) conditions.push(["<=", ["get", "year"], f.yearMax]);
    return ["all", ...conditions] as FilterSpecification;
  }

  private layers(): LayerSpecification[] {
    const count = this.countExpression();
    return [
      {
        id: this.hexLayerId,
        type: "fill",
        source: this.sourceId,
        "source-layer": "hex",
        maxzoom: this.meta.pointsZoom,
        filter: [">", count, 0],
        paint: {
          "fill-color": this.densityColor(count),
          "fill-opacity": 0.72,
          "fill-outline-color": "rgba(255,255,255,0.25)",
        },
      },
      {
        id: this.pointsLayerId,
        type: "circle",
        source: this.sourceId,
        "source-layer": "points",
        minzoom: this.meta.pointsZoom,
        filter: this.pointsFilter(),
        paint: {
          "circle-color": sectorColorExpression(),
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 2, 16, 3.5, 19, 7],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 14, 0, 16, 0.75],
        },
      },
    ];
  }
}
