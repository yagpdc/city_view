import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  Map as MapLibreMap,
  PointLike,
} from "maplibre-gl";
import type { PMTiles } from "pmtiles";
import { loadAreaHexes, type HexFeature } from "./areaHexes";
import type { AreaGeometry, Position } from "./geo";
import { loadNearby, searchPoints, type NearbySummary, type SearchHit } from "./nearby";

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
  columns: { name: string; type: "number" | "category" | "text" }[];
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

/** Paleta de dados City View (docs/DESIGN.md): todas ≥ 3:1 sobre o mapa claro e o escuro. */
export const CATEGORY_COLORS = [
  "#2f6fd6",
  "#e8590c",
  "#2b9348",
  "#c2255c",
  "#1098ad",
  "#7048e8",
  "#b08900",
  "#8c6d31",
  "#5c940d",
  "#a61e4d",
];
/** Cor de "Outros" e de pontos sem categoria. */
export const OTHER_COLOR = "#6b7485";

/** Escala sequencial (densidade baixa → alta), um tom a mais que o número de quebras. */
const DENSITY_COLORS = ["#fff3bf", "#ffd43b", "#fd7e14", "#e8590c", "#d6336c", "#ae3ec9", "#5f3dc4"];
/** Escala viva (estilo "inferno") para pintar o relevo na maquete e as colunas 3D. */
/** Mesma escala, invertida: no 3D (fundo escuro) o pouco é escuro e o muito acende. */
const VIVID_COLORS = [...DENSITY_COLORS].reverse();
/** Altura máxima de uma coluna, em larguras de hexágono. */
const COLUMN_HEIGHT_FACTOR = 2.6;

/** Resumo dos dados do cliente dentro de uma área. */
export interface AreaSummary {
  count: number;
  byCategory: number[];
  /** Hexágonos considerados (para dar noção de cobertura). */
  cells: number;
}

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
  /** Hexágonos como colunas 3D. */
  private extruded = false;
  private readonly sourceId: string;
  private readonly hexLayerId: string;
  private readonly pointsLayerId: string;
  private readonly labelsLayerId: string;
  /** Tema do mapa base, para a cor dos rótulos (definido pelo CityMap antes de anexar). */
  labelTheme: "light" | "dark" = "light";

  constructor(
    private readonly map: MapLibreMap,
    readonly id: string,
    private readonly url: string,
    readonly meta: DatasetMeta,
    private readonly pmtiles: PMTiles,
    /** Crédito exibido no mapa (obrigatório para dados de terceiros, ex.: Overture). */
    private readonly attribution?: string,
  ) {
    this.sourceId = `cv-${id}`;
    this.hexLayerId = `cv-${id}-hex`;
    this.pointsLayerId = `cv-${id}-points`;
    this.labelsLayerId = `cv-${id}-labels`;
  }

  /** Camadas clicáveis (hexágonos e pontos). */
  get layerIds(): string[] {
    return [this.hexLayerId, this.pointsLayerId];
  }

  /** Todas as camadas, inclusive os rótulos. */
  private get allLayerIds(): string[] {
    return [...this.layerIds, this.labelsLayerId];
  }

  /** (Re)adiciona fonte e camadas. Chamado na criação e sempre que o estilo é recarregado. */
  attach(): void {
    if (this.map.getSource(this.sourceId)) return;
    this.map.addSource(this.sourceId, {
      type: "vector",
      url: `pmtiles://${this.url}`,
      ...(this.attribution ? { attribution: this.attribution } : {}),
    });
    // Dados acima do mapa base, mas abaixo dos rótulos.
    const beforeId = this.map.getStyle().layers.find((l) => l.type === "symbol")?.id;
    for (const layer of this.layers()) this.map.addLayer(layer, beforeId);
    // Rótulos acima dos do mapa base: na disputa por espaço, o nome dos dados ganha dos POIs do mapa.
    const labels = this.labelsLayer();
    if (labels) this.map.addLayer(labels);
    this.setVisible(this.visible);
  }

  detach(): void {
    for (const id of this.allLayerIds) if (this.map.getLayer(id)) this.map.removeLayer(id);
    if (this.map.getSource(this.sourceId)) this.map.removeSource(this.sourceId);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const id of this.allLayerIds) {
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
    this.map.setPaintProperty(this.hexLayerId, this.extruded ? "fill-extrusion-color" : "fill-color", this.densityColor(count));
    if (this.extruded) this.map.setPaintProperty(this.hexLayerId, "fill-extrusion-height", this.columnHeight(count));
    this.map.setFilter(this.hexLayerId, [">", count, 0]);
    this.map.setFilter(this.pointsLayerId, this.pointsFilter());
    if (this.map.getLayer(this.labelsLayerId)) this.map.setFilter(this.labelsLayerId, this.pointsFilter());
  }

  /** Hexágonos como colunas 3D (altura e cor pela densidade). */
  setExtruded(on: boolean): void {
    if (on === this.extruded) return;
    this.extruded = on;
    if (!this.map.getLayer(this.hexLayerId)) return;
    this.map.removeLayer(this.hexLayerId);
    this.map.addLayer(this.hexLayer(), this.pointsLayerId);
    this.setVisible(this.visible);
  }

  isExtruded(): boolean {
    return this.extruded;
  }

  /** Hexágonos da área no maior detalhe disponível (para a maquete). */
  loadAreaHexes(area: AreaGeometry): Promise<{ zoom: number; features: HexFeature[] }> {
    return loadAreaHexes(this.pmtiles, area, this.meta.hexMaxZoom);
  }

  /** Soma os hexágonos (respeitando o filtro de categorias). */
  /**
   * Resumo do que está desenhado na tela agora (para os widgets "Na tela"): pontos no zoom de rua,
   * hexágonos nos demais. Hexágonos repetidos na borda dos tiles contam uma vez (pelo centro).
   */
  viewportSummary(): (AreaSummary & { mode: "points" | "hex" }) | null {
    if (!this.visible) return null;
    const usePoints = this.map.getZoom() >= this.meta.pointsZoom && this.map.getLayer(this.pointsLayerId);
    if (usePoints) {
      const seen = new Set<string | number>();
      const byCategory = this.meta.categories.map(() => 0);
      const visible = this.activeCategories();
      let count = 0;
      for (const f of this.map.queryRenderedFeatures({ layers: [this.pointsLayerId] })) {
        const key = f.id ?? JSON.stringify((f.geometry as { coordinates?: unknown }).coordinates);
        if (seen.has(key)) continue;
        seen.add(key);
        const c = Number(f.properties[this.meta.categoryProperty]);
        if (Number.isInteger(c) && c >= 0 && c < byCategory.length) {
          if (visible && !visible.includes(c)) continue;
          byCategory[c]!++;
        }
        count++;
      }
      return { count, byCategory, cells: count, mode: "points" };
    }
    if (!this.map.getLayer(this.hexLayerId)) return null;
    const unique = new Map<string, HexFeature>();
    for (const f of this.map.queryRenderedFeatures({ layers: [this.hexLayerId] })) {
      const ring = (f.geometry as { type: string; coordinates: [number, number][][] }).coordinates?.[0];
      if (!ring?.length) continue;
      const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
      const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      const key = `${cx.toFixed(4)},${cy.toFixed(4)}`;
      if (!unique.has(key)) unique.set(key, { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: f.properties as Record<string, number> });
    }
    return { ...this.summarize([...unique.values()]), mode: "hex" };
  }

  summarize(features: HexFeature[]): AreaSummary {
    const prefix = this.meta.categoryCountPrefix;
    const visible = this.activeCategories();
    const byCategory = this.meta.categories.map(() => 0);
    let count = 0;
    for (const { properties: p } of features) {
      let n = 0;
      this.meta.categories.forEach((_, i) => {
        const v = Number(p[`${prefix}${i}`] ?? 0);
        byCategory[i]! += v;
        if (!visible || visible.includes(i)) n += v;
      });
      count += visible ? n : Number(p.n ?? 0);
    }
    return { count, byCategory, cells: features.length };
  }

  /**
   * Camadas para uma fonte GeoJSON com os hexágonos da área (mesmas propriedades dos tiles):
   * relevo pintado (plana, "drapeada" sobre o terreno) e colunas 3D.
   *
   * A escala é LOCAL: degradê contínuo entre os percentis 5 e 98 da densidade dentro da área,
   * para mostrar onde os dados se concentram ali — a escala nacional deixaria uma cidade densa
   * inteira com a mesma cor.
   */
  areaLayers(sourceId: string, features: HexFeature[]): { surface: LayerSpecification; columns: LayerSpecification } {
    const count = this.countExpression();
    const filter = [">", count, 0] as FilterSpecification;
    const density = (p: Record<string, number>) => {
      const visible = this.activeCategories();
      const n = visible
        ? visible.reduce((sum, i) => sum + Number(p[`${this.meta.categoryCountPrefix}${i}`] ?? 0), 0)
        : Number(p.n ?? 0);
      return Math.log1p(n / Number(p.a || 1));
    };
    const values = features.map((f) => density(f.properties)).filter((v) => v > 0).sort((a, b) => a - b);
    const q = (t: number) => values[Math.min(values.length - 1, Math.floor((values.length - 1) * t))] ?? 0;
    const lo = q(0.05);
    const hi = Math.max(lo + 1e-6, q(0.98));
    const t = ["interpolate", ["linear"], ["ln", ["+", 1, ["/", count, ["get", "a"]]]], lo, 0, hi, 1];
    const stops = VIVID_COLORS.flatMap((c, i) => [i / (VIVID_COLORS.length - 1), c]);
    const color = ["interpolate", ["linear"], t, ...stops] as unknown as ExpressionSpecification;
    // Colunas: até ~1/4 da largura da área, com um mínimo para os valores baixos aparecerem.
    const height = ["*", ["sqrt", ["get", "a"]], 1000 * COLUMN_HEIGHT_FACTOR * 1.6, ["max", 0.04, t]] as unknown as ExpressionSpecification;
    return {
      surface: {
        id: `${sourceId}-surface`,
        type: "fill",
        source: sourceId,
        filter,
        paint: { "fill-color": color, "fill-opacity": 0.88, "fill-antialias": false },
      },
      columns: {
        id: `${sourceId}-columns`,
        type: "fill-extrusion",
        source: sourceId,
        filter,
        paint: {
          "fill-extrusion-color": color,
          "fill-extrusion-height": height,
          "fill-extrusion-opacity": 0.95,
          "fill-extrusion-vertical-gradient": true,
        },
      },
    };
  }

  getFilter(): DatasetFilter {
    return { ...this.filter };
  }

  /** Pontos do dataset num raio (metros, no elipsoide), lidos no zoom dos pontos. */
  nearby(center: Position, radiusM: number): Promise<NearbySummary> {
    return loadNearby(this.pmtiles, {
      center,
      radiusM,
      zoom: this.meta.pointsZoom,
      categoryProperty: this.meta.categoryProperty,
      categories: this.meta.categories.length,
    });
  }

  /** Busca pelo nome (coluna de título) ao redor de um centro; vazio se o dataset não tem título. */
  search(query: string, center: Position, radiusM: number, limit = 8): Promise<SearchHit[]> {
    const title = this.meta.title;
    if (!title || !this.meta.columns.some((c) => c.name === title)) return Promise.resolve([]);
    return searchPoints(this.pmtiles, {
      query,
      center,
      radiusM,
      zoom: this.meta.pointsZoom,
      titleProperty: title,
      categoryProperty: this.meta.categoryProperty,
      limit,
    });
  }

  pick(point: PointLike): DatasetPick | null {
    if (!this.visible) return null;
    // Antes do estilo carregar (ou durante a troca de tema) as camadas ainda não existem.
    const layers = this.layerIds.filter((id) => this.map.getLayer(id));
    if (layers.length === 0) return null;
    const [feature] = this.map.queryRenderedFeatures(point, { layers });
    if (!feature) return null;
    const p = feature.properties as Record<string, string | number>;
    const at = this.map.unproject(point);
    const lngLat: [number, number] = [at.lng, at.lat];
    if (feature.layer.id === this.pointsLayerId) {
      const { [this.meta.categoryProperty]: category, ...properties } = p;
      // Registro: a posição é a do ponto, não a do clique.
      const coords = feature.geometry.type === "Point" ? (feature.geometry.coordinates as [number, number]) : lngLat;
      return {
        kind: "record",
        datasetId: this.id,
        id: Number(feature.id),
        category: category === undefined ? null : Number(category),
        properties,
        lngLat: [coords[0], coords[1]],
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

  private breaks(): number[] {
    return [...new Set(this.meta.densityBreaks)].sort((a, b) => a - b);
  }

  private densityColor(count: ExpressionSpecification, vivid = this.extruded): ExpressionSpecification {
    const palette = vivid ? VIVID_COLORS : DENSITY_COLORS;
    const stops = this.breaks().flatMap((b, i) => [b, palette[Math.min(i + 1, palette.length - 1)]!]);
    return ["step", ["/", count, ["get", "a"]], palette[0]!, ...stops] as ExpressionSpecification;
  }

  /**
   * Altura da coluna em metros: proporcional à largura do hexágono (√área) e ao logaritmo da
   * densidade normalizado pelas quebras — assim as colunas têm proporção parecida em qualquer zoom.
   */
  private columnHeight(count: ExpressionSpecification): ExpressionSpecification {
    const breaks = this.breaks();
    const lo = Math.log1p(breaks[0] ?? 0);
    const hi = Math.max(lo + 0.01, Math.log1p(breaks.at(-1) ?? 1));
    const density = ["/", count, ["get", "a"]];
    const t = ["interpolate", ["linear"], ["ln", ["+", 1, density]], lo, 0.04, hi, 1];
    return ["*", ["sqrt", ["get", "a"]], 1000 * COLUMN_HEIGHT_FACTOR, t] as unknown as ExpressionSpecification;
  }

  private hexLayer(): LayerSpecification {
    const count = this.countExpression();
    const common = {
      id: this.hexLayerId,
      source: this.sourceId,
      "source-layer": "hex",
      maxzoom: this.meta.pointsZoom,
      filter: [">", count, 0] as FilterSpecification,
    };
    if (this.extruded) {
      return {
        ...common,
        type: "fill-extrusion",
        paint: {
          "fill-extrusion-color": this.densityColor(count),
          "fill-extrusion-height": this.columnHeight(count),
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.92,
          "fill-extrusion-vertical-gradient": true,
        },
      };
    }
    return {
      ...common,
      type: "fill",
      paint: {
        "fill-color": this.densityColor(count),
        "fill-opacity": 0.72,
        "fill-outline-color": "rgba(255,255,255,0.25)",
      },
    };
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

  /** Nome de cada ponto (coluna de título) ao aproximar; sem título, sem rótulos. */
  private labelsLayer(): LayerSpecification | null {
    const title = this.meta.title;
    if (!title || !this.meta.columns.some((c) => c.name === title)) return null;
    const dark = this.labelTheme === "dark";
    return {
      id: this.labelsLayerId,
      type: "symbol",
      source: this.sourceId,
      "source-layer": "points",
      minzoom: Math.max(this.meta.pointsZoom + 2, 16),
      filter: this.pointsFilter(),
      layout: {
        "text-field": ["get", title],
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 16, 10.5, 19, 13],
        "text-anchor": "top",
        "text-offset": [0, 0.7],
        "text-max-width": 9,
        "text-padding": 3,
        "text-letter-spacing": 0.01,
      },
      paint: {
        "text-color": dark ? "#c4cbd5" : "#353d4c",
        "text-halo-color": dark ? "#10141c" : "#ffffff",
        "text-halo-width": 1.3,
        "text-halo-blur": 0.3,
      },
    };
  }

  private layers(): LayerSpecification[] {
    return [
      this.hexLayer(),
      {
        id: this.pointsLayerId,
        type: "circle",
        source: this.sourceId,
        "source-layer": "points",
        minzoom: this.meta.pointsZoom,
        filter: this.pointsFilter(),
        paint: {
          "circle-color": this.pointColor(),
          // Ponto do dado (docs/DESIGN.md · Mapa 1): anel da cor do chão separa vizinhos.
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 2.5, 16, 4.5, 19, 7],
          "circle-stroke-color": this.labelTheme === "dark" ? "#10141c" : "#ffffff",
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 14, 0.5, 16, 1.5],
        },
      },
    ];
  }
}
