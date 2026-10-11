import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  Map as MapLibreMap,
  PointLike,
} from "maplibre-gl";
import type { PMTiles } from "pmtiles";

/** Metadados gravados pelo cityview-tiler (`cityview` no JSON do PMTiles, versão 2). */
export interface DatasetMeta {
  version: number;
  records: number;
  hexMaxZoom: number;
  pointsZoom: number;
  densityBreaks: number[];
  /** Rótulos das categorias de cor, por índice (a última pode ser "Outros"). */
  categories: string[];
  /** Propriedade dos pontos com o índice da categoria. */
  categoryProperty: string;
  /** Prefixo das contagens por categoria nos hexágonos (`c0`, `c1`…). */
  categoryCountPrefix: string;
  colorBy?: string | null;
  title?: string | null;
  /** Colunas presentes nos pontos. */
  columns: { name: string; type: "number" | "category" }[];
  bounds?: [number, number, number, number];
  /** Há índice de linhas no servidor (detalhes completos pelo id). */
  hasRowIndex?: boolean;
}

export type WhereClause = { in?: (string | number)[]; gte?: number; lte?: number };

export interface DatasetFilter {
  /** Categorias de cor visíveis (índices). Vazio/ausente = todas. Vale para pontos e agregados. */
  categories?: number[];
  /** Condições por coluna. Por enquanto só afetam os pontos individuais (zoom alto). */
  where?: Record<string, WhereClause>;
}

export type DatasetPick =
  | {
      kind: "record";
      datasetId: string;
      id: number;
      category: number | null;
      properties: Record<string, string | number>;
      lngLat: [number, number];
    }
  | {
      kind: "aggregate";
      datasetId: string;
      count: number;
      byCategory: number[];
      areaKm2: number;
      lngLat: [number, number];
    };

export const CATEGORY_COLORS = [
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
/** Cor de "Outros" e de pontos sem categoria. */
export const OTHER_COLOR = "#8a8f98";

/** Escala sequencial (densidade baixa → alta), um tom a mais que o número de quebras. */
const DENSITY_COLORS = ["#fff3c4", "#fed98e", "#fdb863", "#f98e4b", "#ec5f3c", "#d03b3f", "#9e1f4a"];

export function categoryColor(index: number, labels: string[]): string {
  if (labels[index] === "Outros" && index === labels.length - 1) return OTHER_COLOR;
  return CATEGORY_COLORS[index] ?? OTHER_COLOR;
}

export async function readDatasetMeta(pmtiles: PMTiles): Promise<DatasetMeta> {
  const metadata = (await pmtiles.getMetadata()) as { cityview?: DatasetMeta } | undefined;
  const meta = metadata?.cityview;
  if (!meta || meta.version !== 2) {
    throw new Error("PMTiles sem metadados `cityview` v2: gere o arquivo com o cityview-tiler atual.");
  }
  return meta;
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

  detach(): void {
    for (const id of this.layerIds) if (this.map.getLayer(id)) this.map.removeLayer(id);
    if (this.map.getSource(this.sourceId)) this.map.removeSource(this.sourceId);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const id of this.layerIds) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  setFilter(filter: DatasetFilter): void {
    this.filter = { ...filter };
    if (!this.map.getLayer(this.hexLayerId)) return;
    const count = this.countExpression();
    this.map.setPaintProperty(this.hexLayerId, "fill-color", this.densityColor(count));
    this.map.setFilter(this.hexLayerId, [">", count, 0]);
    this.map.setFilter(this.pointsLayerId, this.pointsFilter());
  }

  getFilter(): DatasetFilter {
    return { ...this.filter };
  }

  pick(point: PointLike): DatasetPick | null {
    if (!this.visible) return null;
    const [feature] = this.map.queryRenderedFeatures(point, { layers: this.layerIds });
    if (!feature) return null;
    const p = feature.properties as Record<string, string | number>;
    const at = this.map.unproject(point);
    const lngLat: [number, number] = [at.lng, at.lat];
    if (feature.layer.id === this.pointsLayerId) {
      const { [this.meta.categoryProperty]: category, ...properties } = p;
      return {
        kind: "record",
        datasetId: this.id,
        id: Number(feature.id),
        category: category === undefined ? null : Number(category),
        properties,
        lngLat,
      };
    }
    const prefix = this.meta.categoryCountPrefix;
    const byCategory = this.meta.categories.map((_, i) => Number(p[`${prefix}${i}`] ?? 0));
    const visible = this.activeCategories();
    const count = visible ? visible.reduce((sum, c) => sum + (byCategory[c] ?? 0), 0) : Number(p.n);
    return { kind: "aggregate", datasetId: this.id, count, byCategory, areaKm2: Number(p.a), lngLat };
  }

  private activeCategories(): number[] | null {
    const c = this.filter.categories;
    return c && c.length < this.meta.categories.length ? c : null;
  }

  /** Contagem do hexágono considerando só as categorias selecionadas. */
  private countExpression(): ExpressionSpecification {
    const categories = this.activeCategories();
    if (!categories) return ["get", "n"];
    if (categories.length === 0) return ["literal", 0] as unknown as ExpressionSpecification;
    const prefix = this.meta.categoryCountPrefix;
    const parts: ExpressionSpecification[] = categories.map((c) => ["coalesce", ["get", `${prefix}${c}`], 0]);
    return parts.length === 1 ? parts[0]! : ["+", ...parts];
  }

  private densityColor(count: ExpressionSpecification): ExpressionSpecification {
    const breaks = [...new Set(this.meta.densityBreaks)].sort((a, b) => a - b);
    const stops = breaks.flatMap((b, i) => [b, DENSITY_COLORS[Math.min(i + 1, DENSITY_COLORS.length - 1)]!]);
    return ["step", ["/", count, ["get", "a"]], DENSITY_COLORS[0]!, ...stops] as ExpressionSpecification;
  }

  private pointsFilter(): FilterSpecification {
    const conditions: ExpressionSpecification[] = [];
    const categories = this.activeCategories();
    if (categories) conditions.push(["in", ["get", this.meta.categoryProperty], ["literal", categories]]);
    for (const [column, clause] of Object.entries(this.filter.where ?? {})) {
      if (clause.in) conditions.push(["in", ["to-string", ["get", column]], ["literal", clause.in.map(String)]]);
      if (clause.gte !== undefined) conditions.push([">=", ["to-number", ["get", column]], clause.gte]);
      if (clause.lte !== undefined) conditions.push(["<=", ["to-number", ["get", column]], clause.lte]);
    }
    return ["all", ...conditions] as FilterSpecification;
  }

  private pointColor(): ExpressionSpecification | string {
    if (this.meta.categories.length === 0) return CATEGORY_COLORS[0]!;
    const pairs = this.meta.categories.flatMap((_, i) => [i, categoryColor(i, this.meta.categories)]);
    return ["match", ["get", this.meta.categoryProperty], ...pairs, OTHER_COLOR] as unknown as ExpressionSpecification;
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
          "circle-color": this.pointColor(),
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 2, 16, 3.5, 19, 7],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 14, 0, 16, 0.75],
        },
      },
    ];
  }
}
