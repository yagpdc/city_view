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
import { whereExpressions, type WhereClause } from "./filter";
import { ICON_PIXEL_RATIO, rasterizeMarker } from "./icons";
import { loadNearby, searchPoints, type NearbySummary, type SearchHit } from "./nearby";

/** Metadados gravados pelo cityview-tiler (`cityview` no JSON do PMTiles, versão 2). */
export interface DatasetMeta {
  version: number;
  records: number;
  hexMaxZoom: number;
  pointsZoom: number;
  /**
   * Primeiro zoom com pontos (tiler a partir de 2026-10-13: 0). Ausente nos arquivos antigos, que só têm pontos
   * a partir de `pointsZoom`: neles os hexágonos continuam sendo a vista afastada.
   */
  pointsMinZoom?: number;
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

export type { WhereClause };

export interface DatasetFilter {
  /** Categorias de cor visíveis (índices). Vazio/ausente = todas. Vale para pontos e agregados. */
  categories?: number[];
  /** Condições por coluna. Só afetam os pontos individuais (zoom alto): os hexágonos não têm as colunas. */
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
  /** Vista de densidade (hexágonos) escolhida no cartão; o padrão são as bolinhas em todos os zooms. */
  private hexView = false;
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
    this.iconsLayerId = `cv-${id}-icons`;
  }

  private readonly iconsLayerId: string;
  /** Marcador por categoria (índice), já rasterizado; null = só os círculos. */
  private icons: (ImageData | null)[] | null = null;

  /** Zoom a partir do qual os pontos ganham marcador com ícone (e nome). */
  private get iconZoom(): number {
    return Math.max(this.meta.pointsZoom + 2, 16);
  }

  private iconName(i: number): string {
    return `${this.sourceId}-icon-${i}`;
  }

  /**
   * Ícone por categoria (SVG de traço, ex.: Lucide; índice = categoria; um a mais vale para "Outros").
   * Ao aproximar, cada ponto ganha um marcador (círculo da cor da categoria com o ícone e o nome embaixo).
   * Marcadores não se sobrepõem: onde não cabe, fica o ponto simples. null volta aos círculos com rótulo.
   */
  async setIcons(svgs: (string | null)[] | null): Promise<void> {
    const color = (i: number) => (i < this.meta.categories.length ? categoryColor(i, this.meta.categories) : OTHER_COLOR);
    this.icons = svgs ? await Promise.all(svgs.map((s, i) => (s ? rasterizeMarker(s, color(i)) : Promise.resolve(null)))) : null;
    if (!this.map.getSource(this.sourceId)) return;
    this.removeIconLayer();
    if (this.map.getLayer(this.labelsLayerId)) this.map.removeLayer(this.labelsLayerId);
    if (!this.addIconLayer()) {
      const labels = this.labelsLayer();
      if (labels) this.map.addLayer(labels);
    }
    this.setVisible(this.visible);
  }

  /** Camada de marcadores (ícone + nome opcional); false se não há ícones. */
  private addIconLayer(): boolean {
    if (!this.icons || !this.map.getLayer(this.pointsLayerId)) return false;
    const pairs: (number | string)[] = [];
    let fallback = "";
    this.icons.forEach((data, i) => {
      if (!data) return;
      const name = this.iconName(i);
      if (!this.map.hasImage(name)) this.map.addImage(name, data, { pixelRatio: ICON_PIXEL_RATIO });
      // Um ícone além das categorias vale para o resto ("Outros").
      if (i >= this.meta.categories.length) fallback = name;
      else pairs.push(i, name);
    });
    if (pairs.length === 0 && !fallback) return false;
    const title = this.meta.title && this.meta.columns.some((c) => c.name === this.meta.title) ? this.meta.title : null;
    const dark = this.labelTheme === "dark";
    // Acima dos rótulos do mapa base: na disputa por espaço, o dado ganha dos POIs do mapa.
    this.map.addLayer({
      id: this.iconsLayerId,
      type: "symbol",
      source: this.sourceId,
      "source-layer": "points",
      minzoom: this.iconZoom,
      filter: this.pointsFilter(),
      layout: {
        "icon-image": (pairs.length ? ["match", ["get", this.meta.categoryProperty], ...pairs, fallback] : fallback) as unknown as ExpressionSpecification,
        "icon-size": ["interpolate", ["linear"], ["zoom"], this.iconZoom, 0.85, 19, 1.1],
        "icon-padding": 1,
        ...(title && {
          "text-field": ["get", title],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 16, 10.5, 19, 13],
          "text-anchor": "top",
          "text-offset": [0, 1.05],
          "text-max-width": 9,
          "text-padding": 2,
          "text-letter-spacing": 0.01,
          // Sem espaço para o nome, o marcador aparece mesmo assim.
          "text-optional": true,
        }),
      },
      paint: title
        ? {
            "text-color": dark ? "#c4cbd5" : "#353d4c",
            "text-halo-color": dark ? "#10141c" : "#ffffff",
            "text-halo-width": 1.3,
            "text-halo-blur": 0.3,
          }
        : {},
    } as LayerSpecification);
    return true;
  }

  private removeIconLayer(): void {
    if (this.map.getLayer(this.iconsLayerId)) this.map.removeLayer(this.iconsLayerId);
  }

  /** Camadas clicáveis (hexágonos e pontos). */
  get layerIds(): string[] {
    return [this.hexLayerId, this.pointsLayerId];
  }

  /** Todas as camadas, inclusive os rótulos. */
  private get allLayerIds(): string[] {
    return [...this.layerIds, this.iconsLayerId, this.labelsLayerId];
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
    // Marcadores (com nome) ou, sem ícones, só os rótulos — acima dos do mapa base.
    if (!this.addIconLayer()) {
      const labels = this.labelsLayer();
      if (labels) this.map.addLayer(labels);
    }
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
    if (this.map.getLayer(this.hexLayerId)) {
      const count = this.countExpression();
      this.map.setPaintProperty(this.hexLayerId, this.extruded ? "fill-extrusion-color" : "fill-color", this.densityColor(count));
      if (this.extruded) this.map.setPaintProperty(this.hexLayerId, "fill-extrusion-height", this.columnHeight(count));
      this.map.setFilter(this.hexLayerId, [">", count, 0]);
    }
    if (this.map.getLayer(this.pointsLayerId)) this.map.setFilter(this.pointsLayerId, this.pointsFilter());
    if (this.map.getLayer(this.iconsLayerId)) this.map.setFilter(this.iconsLayerId, this.pointsFilter());
    if (this.map.getLayer(this.labelsLayerId)) this.map.setFilter(this.labelsLayerId, this.pointsFilter());
  }

  /** Hexágonos como colunas 3D (altura e cor pela densidade). Liga os hexágonos enquanto durar. */
  setExtruded(on: boolean): void {
    if (on === this.extruded) return;
    this.extruded = on;
    this.rebuildDataLayers();
  }

  /** Vista de densidade em hexágonos (opcional); desligada, as bolinhas aparecem em todos os zooms. */
  setHexView(on: boolean): void {
    if (on === this.hexView) return;
    this.hexView = on;
    this.rebuildDataLayers();
  }

  isHexView(): boolean {
    return this.hexView;
  }

  /** Os pontos existem em zoom baixo neste arquivo? (arquivos antigos: não, só hexágonos) */
  get hasLowZoomPoints(): boolean {
    return this.meta.pointsMinZoom !== undefined && this.meta.pointsMinZoom < this.meta.pointsZoom;
  }

  /** Hexágonos aparecem: escolhidos, em colunas 3D, ou porque o arquivo antigo não tem pontos afastados. */
  private get hexShown(): boolean {
    return this.hexView || this.extruded || !this.hasLowZoomPoints;
  }

  /** Refaz hexágonos e pontos (mudou a vista); marcadores e rótulos ficam. */
  private rebuildDataLayers(): void {
    if (!this.map.getSource(this.sourceId)) return;
    for (const id of [this.hexLayerId, this.pointsLayerId]) if (this.map.getLayer(id)) this.map.removeLayer(id);
    const beforeId = this.map.getLayer(this.iconsLayerId) ? this.iconsLayerId : this.map.getLayer(this.labelsLayerId) ? this.labelsLayerId : undefined;
    const base = beforeId ?? this.map.getStyle().layers.find((l) => l.type === "symbol")?.id;
    for (const layer of this.layers()) this.map.addLayer(layer, base);
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
    if (!this.map.getSource(this.sourceId)) return null;
    // Contagem exata pelos hexágonos, mesmo quando a vista são as bolinhas (os tiles trazem as duas camadas).
    const shown = Boolean(this.map.getLayer(this.hexLayerId));
    const features = shown ? this.map.queryRenderedFeatures({ layers: [this.hexLayerId] }) : this.map.querySourceFeatures(this.sourceId, { sourceLayer: "hex" });
    const bounds = this.map.getBounds();
    const unique = new Map<string, HexFeature>();
    for (const f of features) {
      const ring = (f.geometry as { type: string; coordinates: [number, number][][] }).coordinates?.[0];
      if (!ring?.length) continue;
      const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
      const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      if (!shown && !bounds.contains([cx, cy])) continue;
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

  /** Menor e maior valor numérico de uma coluna nos pontos carregados (dica do filtro por valor). */
  columnRange(column: string): { min: number; max: number } | null {
    if (!this.map.getSource(this.sourceId)) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const f of this.map.querySourceFeatures(this.sourceId, { sourceLayer: "points" })) {
      const v = f.properties[column];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return min <= max ? { min, max } : null;
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
    conditions.push(...whereExpressions(this.filter.where));
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
      minzoom: this.iconZoom,
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
    const hex = this.hexShown;
    // Com hexágonos, os pontos entram no zoom de rua; sem, desde o zoom mais afastado que o arquivo tiver.
    const pointsFrom = hex ? this.meta.pointsZoom : (this.meta.pointsMinZoom ?? this.meta.pointsZoom);
    return [
      ...(hex ? [this.hexLayer()] : []),
      {
        id: this.pointsLayerId,
        type: "circle",
        source: this.sourceId,
        "source-layer": "points",
        minzoom: pointsFrom,
        filter: this.pointsFilter(),
        paint: {
          "circle-color": this.pointColor(),
          // Ponto do dado (docs/DESIGN.md · Mapa 1): anel da cor do chão separa vizinhos. Afastado, pequeno.
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 2, 8, 2.6, 12, 3, 14, 3.2, 16, 4.5, 19, 7],
          "circle-stroke-color": this.labelTheme === "dark" ? "#10141c" : "#ffffff",
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 0, 0.4, 12, 0.7, 16, 1.5],
        },
      },
    ];
  }
}
