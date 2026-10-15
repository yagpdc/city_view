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
import { matchesWhere, whereExpressions, type WhereClause } from "./filter";
import { ICON_PIXEL_RATIO, rasterizeMarker } from "./icons";
import { countPointsInArea, loadNearby, searchPoints, type NearbySummary, type SearchHit } from "./nearby";
import { regionLabel, type RegionBoundaries } from "./regions";
import { DEFAULT_DATA_STYLE, PALETTES, classColors, metersPerPixelAtZoom0, type DataStyle } from "./dataStyle";

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
  columns: { name: string; type: "number" | "category" | "text"; min?: number; max?: number }[];
  bounds?: [number, number, number, number];
  /** Há índice de linhas no servidor (detalhes completos pelo id). */
  hasRowIndex?: boolean;
  /** Contagem por região de verdade: nível ("uf", "mun") → código → [total, c0, c1…]. */
  regions?: Record<string, Record<string, number[]>> | null;
}

export type { WhereClause };

export interface DatasetFilter {
  /** Categorias de cor visíveis (índices). Vazio/ausente = todas. Vale para pontos e agregados. */
  categories?: number[];
  /** Condições por coluna. Só afetam os pontos individuais (zoom alto): os hexágonos não têm as colunas. */
  where?: Record<string, WhereClause>;
}

/** Um registro desenhado na tela (widgets "Tabela" e "Gráfico por coluna"). */
export interface ViewportRecord {
  id: number;
  category: number | null;
  properties: Record<string, string | number>;
  lngLat: [number, number];
}

export interface ViewportRecords {
  /** Até o limite pedido, na ordem em que vêm dos tiles. */
  records: ViewportRecord[];
  /** Quantos registros com colunas passam no filtro na área visível (pode passar do limite). */
  total: number;
  /** Pontos sem as colunas (mapa afastado: tiles cheios guardam só a cor de cada ponto). */
  thinned: number;
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
      /** Nome da região (vista "Regiões"); ausente nos hexágonos. */
      name?: string;
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
/** Na vista "Regiões", as bolinhas aparecem a partir deste zoom (antes, só a malha com os números). */
const REGION_POINTS_FROM = 11;
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
  /** Vista "Regiões": a malha com a contagem de cada região; as bolinhas entram ao aproximar. */
  private regionView = false;
  /** Estilo do editor (forma, cor, tamanho…). Hexágonos e regiões também são formas. */
  private dataStyle: DataStyle = DEFAULT_DATA_STYLE;
  /** Malhas compartilhadas (definidas pelo CityMap antes de anexar). */
  regionBoundaries: RegionBoundaries | null = null;
  /** Pedido de montagem em andamento (descarta respostas antigas). */
  private regionBuild = 0;
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

  /** Camadas clicáveis (hexágonos, regiões e pontos). */
  get layerIds(): string[] {
    return [this.hexLayerId, ...this.regionLevels().map((l) => this.regionIds(l.id).fill), this.pointsLayerId];
  }

  /** Todas as camadas, inclusive os rótulos. */
  private get allLayerIds(): string[] {
    const regions = this.regionLevels().flatMap((l) => {
      const ids = this.regionIds(l.id);
      return [ids.fill, ids.line, ids.label];
    });
    return [...this.layerIds, ...regions, this.iconsLayerId, this.labelsLayerId];
  }

  private regionIds(level: string) {
    const base = `cv-${this.id}-reg-${level}`;
    return { source: base, labels: `${base}-pts`, fill: `${base}-fill`, line: `${base}-line`, label: `${base}-label` };
  }

  /** Níveis da malha que este arquivo contou (na ordem das malhas configuradas). */
  private regionLevels() {
    const counted = this.meta.regions ?? {};
    return (this.regionBoundaries?.levels ?? []).filter((l) => counted[l.id] && Object.keys(counted[l.id]!).length > 0);
  }

  /** O arquivo tem contagem por região? (gerados antes de 2026-10-13: não) */
  get hasRegions(): boolean {
    return this.regionLevels().length > 0;
  }

  /** Liga/desliga a vista "Regiões". */
  setRegionView(on: boolean): void {
    if (on === this.regionView) return;
    this.regionView = on;
    this.rebuildDataLayers();
  }

  isRegionView(): boolean {
    return this.regionView;
  }

  private get regionShown(): boolean {
    return this.regionView && !this.extruded && this.hasRegions;
  }

  private removeRegionLayers(): void {
    for (const l of this.regionLevels()) {
      const ids = this.regionIds(l.id);
      for (const id of [ids.label, ids.line, ids.fill]) if (this.map.getLayer(id)) this.map.removeLayer(id);
      for (const id of [ids.labels, ids.source]) if (this.map.getSource(id)) this.map.removeSource(id);
    }
  }

  /** Monta a malha com a contagem (respeitando o filtro de categorias) e as camadas de cada nível. */
  private async addRegionLayers(): Promise<void> {
    const build = ++this.regionBuild;
    const boundaries = this.regionBoundaries;
    if (!boundaries) return;
    const levels = this.regionLevels();
    const loaded = await Promise.all(levels.map((l) => boundaries.load(l.id)));
    if (build !== this.regionBuild || !this.regionShown || !this.map.getSource(this.sourceId)) return;
    const visible = this.activeCategories();
    const dark = this.labelTheme === "dark";
    levels.forEach((level, li) => {
      const counts = this.meta.regions?.[level.id] ?? {};
      const ids = this.regionIds(level.id);
      const polys: GeoJSON.Feature[] = [];
      const points: GeoJSON.Feature[] = [];
      const densities: number[] = [];
      for (const r of loaded[li]!) {
        const row = counts[r.code];
        if (!row) continue;
        const byCategory = row.slice(1);
        const n = visible ? visible.reduce((s, c) => s + (byCategory[c] ?? 0), 0) : row[0]!;
        if (n <= 0) continue;
        const d = r.areaKm2 > 0 ? n / r.areaKm2 : n;
        densities.push(d);
        const props = { code: r.code, name: r.name, n, d, a: r.areaKm2, label: regionLabel(n), by: JSON.stringify(byCategory) };
        polys.push({ type: "Feature", geometry: r.geometry as GeoJSON.Geometry, properties: props });
        points.push({ type: "Feature", geometry: { type: "Point", coordinates: r.labelAt }, properties: props });
      }
      // Cor pela densidade (registros/km²), com quebras nos quantis desta camada e deste nível.
      densities.sort((a, b) => a - b);
      const q = (t: number) => densities[Math.min(densities.length - 1, Math.floor((densities.length - 1) * t))] ?? 0;
      const breaks = [...new Set([0.2, 0.4, 0.6, 0.8, 0.95].map(q))].filter((b) => b > 0);
      const color = (breaks.length
        ? ["step", ["get", "d"], DENSITY_COLORS[1]!, ...breaks.flatMap((b, i) => [b, DENSITY_COLORS[Math.min(i + 2, DENSITY_COLORS.length - 1)]!])]
        : DENSITY_COLORS[2]!) as ExpressionSpecification;
      this.map.addSource(ids.source, { type: "geojson", data: { type: "FeatureCollection", features: polys } });
      this.map.addSource(ids.labels, { type: "geojson", data: { type: "FeatureCollection", features: points } });
      const before = this.map.getLayer(this.pointsLayerId) ? this.pointsLayerId : undefined;
      const zooms = { minzoom: level.minzoom, maxzoom: level.maxzoom };
      this.map.addLayer({ id: ids.fill, type: "fill", source: ids.source, ...zooms, paint: { "fill-color": color, "fill-opacity": 0.55 } }, before);
      this.map.addLayer(
        { id: ids.line, type: "line", source: ids.source, ...zooms, paint: { "line-color": dark ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.9)", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 10, 1.4] } },
        before,
      );
      this.map.addLayer({
        id: ids.label,
        type: "symbol",
        source: ids.labels,
        ...zooms,
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Noto Sans Medium"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 11, 10, 14],
          "text-padding": 2,
          // Maiores primeiro na disputa por espaço.
          "symbol-sort-key": ["-", 0, ["get", "n"]],
        },
        paint: { "text-color": dark ? "#eceef2" : "#151a24", "text-halo-color": dark ? "#10141c" : "#ffffff", "text-halo-width": 1.6 },
      });
    });
    this.setVisible(this.visible);
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
    if (this.regionShown) void this.addRegionLayers();
    this.setVisible(this.visible);
  }

  detach(): void {
    this.removeRegionLayers();
    for (const id of this.allLayerIds) if (this.map.getLayer(id)) this.map.removeLayer(id);
    if (this.map.getSource(this.sourceId)) this.map.removeSource(this.sourceId);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    const s = this.dataStyle;
    for (const id of this.allLayerIds) {
      if (!this.map.getLayer(id)) continue;
      // Marcadores com ícone só na forma "pontos"; nomes conforme a escolha do editor.
      const on = visible && (id === this.iconsLayerId ? s.labels && s.shape === "points" : id === this.labelsLayerId ? s.labels : true);
      this.map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
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
    if (this.regionShown && this.map.getSource(this.sourceId)) {
      this.removeRegionLayers();
      void this.addRegionLayers();
    }
    if (this.map.getLayer(this.iconsLayerId)) this.map.setFilter(this.iconsLayerId, this.pointsFilter());
    if (this.map.getLayer(this.labelsLayerId)) this.map.setFilter(this.labelsLayerId, this.pointsFilter());
  }

  /** Hexágonos como colunas 3D (altura e cor pela densidade). Liga os hexágonos enquanto durar. */
  setExtruded(on: boolean): void {
    if (on === this.extruded) return;
    this.extruded = on;
    this.rebuildDataLayers();
  }

  /** Aplica um estilo do editor (prévia ao vivo ou o salvo). */
  setDataStyle(style: DataStyle): void {
    this.dataStyle = style;
    this.hexView = style.shape === "hex";
    this.regionView = style.shape === "regions";
    this.rebuildDataLayers();
  }

  getDataStyle(): DataStyle {
    return this.dataStyle;
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
    if (this.extruded) return true;
    if (this.regionShown) return false;
    return this.hexView || !this.hasLowZoomPoints;
  }

  /** Refaz hexágonos e pontos (mudou a vista); marcadores e rótulos ficam. */
  private rebuildDataLayers(): void {
    if (!this.map.getSource(this.sourceId)) return;
    this.removeRegionLayers();
    for (const id of [this.hexLayerId, this.pointsLayerId]) if (this.map.getLayer(id)) this.map.removeLayer(id);
    const beforeId = this.map.getLayer(this.iconsLayerId) ? this.iconsLayerId : this.map.getLayer(this.labelsLayerId) ? this.labelsLayerId : undefined;
    const base = beforeId ?? this.map.getStyle().layers.find((l) => l.type === "symbol")?.id;
    for (const layer of this.layers()) this.map.addLayer(layer, base);
    if (this.regionShown) void this.addRegionLayers();
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
    const usePoints = this.map.getZoom() >= this.meta.pointsZoom && this.map.getLayer(this.pointsLayerId) && this.dataStyle.shape !== "heatmap";
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

  /**
   * Registros na área visível, com as colunas, respeitando o filtro do cartão. Lidos dos tiles já carregados
   * (vale para qualquer estilo: bolinhas, regiões, mapa de calor). Afastado, os tiles muito cheios guardam só a
   * cor de cada ponto: esses entram em `thinned`.
   */
  viewportRecords(limit = 5000): ViewportRecords | null {
    if (!this.visible || !this.map.getSource(this.sourceId)) return null;
    // Pela tela, não pela caixa de coordenadas: com o mapa inclinado a caixa pega muito além do horizonte.
    const bounds = this.map.getBounds();
    const canvas = this.map.getCanvas();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const onScreen = (p: [number, number]) => {
      if (!bounds.contains(p)) return false;
      const { x, y } = this.map.project(p);
      return x >= 0 && y >= 0 && x <= width && y <= height;
    };
    const visible = this.activeCategories();
    const where = this.filter.where;
    const cat = this.meta.categoryProperty;
    const seen = new Set<string>();
    const records: ViewportRecord[] = [];
    let total = 0;
    let thinned = 0;
    for (const f of this.map.querySourceFeatures(this.sourceId, { sourceLayer: "points" })) {
      if (f.geometry.type !== "Point") continue;
      const lngLat = f.geometry.coordinates as [number, number];
      if (!onScreen(lngLat)) continue;
      // O mesmo ponto vem em mais de um tile (borda): conta uma vez.
      const key = f.id !== undefined ? String(f.id) : `${lngLat[0]},${lngLat[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const { [cat]: rawCategory, ...properties } = f.properties as Record<string, string | number>;
      const category = rawCategory === undefined ? null : Number(rawCategory);
      if (visible && (category === null || !visible.includes(category))) continue;
      if (Object.keys(properties).length === 0) {
        thinned++;
        continue;
      }
      if (where && !matchesWhere(properties, where)) continue;
      total++;
      if (records.length < limit) records.push({ id: Number(f.id), category, properties, lngLat: [lngLat[0], lngLat[1]] });
    }
    return { records, total, thinned };
  }

  /**
   * O que há dentro de uma área desenhada: ponto a ponto quando ela cabe em poucos tiles do zoom dos pontos
   * (exato, com o filtro do cartão inteiro); senão, a soma dos hexágonos cujo centro cai nela.
   */
  async areaSummary(area: AreaGeometry): Promise<AreaSummary> {
    const exact = await countPointsInArea(this.pmtiles, {
      area,
      zoom: this.meta.pointsZoom,
      categoryProperty: this.meta.categoryProperty,
      categories: this.meta.categories.length,
      allowed: this.activeCategories(),
      where: this.filter.where,
    });
    if (exact) return { ...exact, cells: exact.count };
    const { features } = await this.loadAreaHexes(area);
    return this.summarize(features);
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
    if (feature.layer.id.startsWith(`cv-${this.id}-reg-`)) {
      const byCategory = JSON.parse(String(p.by ?? "[]")) as number[];
      return { kind: "aggregate", datasetId: this.id, count: Number(p.n), byCategory, areaKm2: Number(p.a), lngLat, name: String(p.name) };
    }
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
        "fill-opacity": 0.72 * this.dataStyle.opacity,
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
    const lowest = this.meta.pointsMinZoom ?? this.meta.pointsZoom;
    const pointsFrom = hex ? this.meta.pointsZoom : this.regionShown ? Math.max(lowest, REGION_POINTS_FROM) : lowest;
    return [...(hex ? [this.hexLayer()] : []), this.recordsLayer(pointsFrom)];
  }

  /** Menor e maior valor de uma coluna de número (metadados do tiler; arquivos antigos: o que já carregou). */
  private range(column: string): { min: number; max: number } {
    const c = this.meta.columns.find((x) => x.name === column);
    if (c?.min !== undefined && c.max !== undefined) return { min: c.min, max: c.max > c.min ? c.max : c.min + 1 };
    const r = this.columnRange(column);
    return r && r.max > r.min ? r : { min: 0, max: 1 };
  }

  /** Fator de tamanho pela coluna escolhida (metade no menor valor, o dobro no maior). */
  private sizeFactor(): ExpressionSpecification | number {
    const col = this.dataStyle.sizeBy;
    if (!col) return 1;
    const { min, max } = this.range(col);
    return ["interpolate", ["linear"], ["coalesce", ["to-number", ["get", col]], min], min, 0.5, max, 2] as ExpressionSpecification;
  }

  /** Valores de uma coluna de número nos pontos já carregados (para as faixas por quantil). */
  columnValues(column: string, max = 20000): number[] {
    if (!this.map.getSource(this.sourceId)) return [];
    const out: number[] = [];
    const seen = new Set<string | number>();
    for (const f of this.map.querySourceFeatures(this.sourceId, { sourceLayer: "points" })) {
      const v = f.properties[column];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const key = f.id ?? `${v}:${out.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
      if (out.length >= max) break;
    }
    return out;
  }

  /** Cor de cada registro conforme o estilo (com o destaque por cima). */
  private recordColor(): ExpressionSpecification | string {
    const base = this.baseColor();
    const hl = this.dataStyle.highlight;
    if (!hl?.length) return base;
    return ["case", ["in", ["get", this.meta.categoryProperty], ["literal", hl]], base, this.labelTheme === "dark" ? "#4a5263" : "#c4cbd5"] as unknown as ExpressionSpecification;
  }

  /** Opacidade: as categorias fora do destaque ficam apagadas. */
  private recordOpacity(factor = 1): ExpressionSpecification | number {
    const o = this.dataStyle.opacity * factor;
    const hl = this.dataStyle.highlight;
    if (!hl?.length) return o;
    return ["case", ["in", ["get", this.meta.categoryProperty], ["literal", hl]], o, o * 0.35] as unknown as ExpressionSpecification;
  }

  /** Destacadas desenhadas por cima das outras. */
  private sortKey(): ExpressionSpecification | undefined {
    const hl = this.dataStyle.highlight;
    if (!hl?.length) return undefined;
    return ["case", ["in", ["get", this.meta.categoryProperty], ["literal", hl]], 1, 0] as unknown as ExpressionSpecification;
  }

  private baseColor(): ExpressionSpecification | string {
    const c = this.dataStyle.color;
    if (c.mode === "single") return c.value;
    if (c.mode === "classes") {
      const colors = classColors(c.palette, c.breaks.length + 1);
      const steps = c.breaks.flatMap((b, i) => [b, colors[i + 1]!]);
      return ["case", ["has", c.column], ["step", ["to-number", ["get", c.column]], colors[0]!, ...steps], OTHER_COLOR] as unknown as ExpressionSpecification;
    }
    if (c.mode === "value") {
      const { min, max } = this.range(c.column);
      const pal = PALETTES[c.palette];
      const stops = pal.flatMap((color, i) => [min + ((max - min) * i) / (pal.length - 1), color]);
      return ["case", ["has", c.column], ["interpolate", ["linear"], ["to-number", ["get", c.column]], ...stops], OTHER_COLOR] as unknown as ExpressionSpecification;
    }
    return this.pointColor();
  }

  /** Tamanho que cresce com o zoom (tudo dentro do interpolate de zoom, como o MapLibre exige). */
  private zoomSize(stops: [number, number][], exponential = false): ExpressionSpecification {
    const f = this.sizeFactor();
    const out = stops.flatMap(([z, v]) => [z, f === 1 ? v : ["*", v, f]]);
    return ["interpolate", exponential ? ["exponential", 2] : ["linear"], ["zoom"], ...out] as unknown as ExpressionSpecification;
  }

  /** Raio em metros → px em cada zoom (tamanho real no chão), na latitude do centro da camada. */
  private metersToPx(meters: number): ExpressionSpecification {
    const b = this.meta.bounds;
    const lat = b ? (b[1] + b[3]) / 2 : 0;
    const r0 = meters / metersPerPixelAtZoom0(lat);
    return this.zoomSize([[0, r0], [24, r0 * 2 ** 24]], true);
  }

  private squareImage(): string {
    const name = "cv-square-sdf";
    if (!this.map.hasImage(name)) {
      const n = 64;
      const data = new Uint8ClampedArray(n * n * 4).fill(255);
      this.map.addImage(name, { width: n, height: n, data }, { sdf: true });
    }
    return name;
  }

  /** A camada dos registros na forma escolhida (pontos, círculos, quadrados ou mancha de calor). */
  private recordsLayer(minzoom: number): LayerSpecification {
    const s = this.dataStyle;
    const base = { id: this.pointsLayerId, source: this.sourceId, "source-layer": "points", minzoom, filter: this.pointsFilter() };
    const ring = this.labelTheme === "dark" ? "#10141c" : "#ffffff";
    if (s.shape === "heatmap") {
      const pal = s.color.mode === "value" || s.color.mode === "classes" ? PALETTES[s.color.palette] : PALETTES.densidade;
      const ramp = pal.flatMap((c, i) => [(i + 1) / pal.length, c]);
      return {
        ...base,
        type: "heatmap",
        paint: {
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, s.size * 0.6, 14, s.size, 18, s.size * 1.8],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 14, 1.6],
          "heatmap-weight": this.sizeFactor(),
          "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", ...ramp] as unknown as ExpressionSpecification,
          "heatmap-opacity": s.opacity,
        },
      } as LayerSpecification;
    }
    if (s.shape === "squares") {
      // Ícone quadrado de 64 px colorido (SDF): lado em metros vira escala do ícone em cada zoom.
      const b = this.meta.bounds;
      const lat = b ? (b[1] + b[3]) / 2 : 0;
      const side0 = s.size / metersPerPixelAtZoom0(lat) / 64;
      return {
        ...base,
        type: "symbol",
        layout: {
          "icon-image": this.squareImage(),
          "icon-size": this.zoomSize([[0, side0], [24, side0 * 2 ** 24]], true),
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-rotation-alignment": "map",
          "icon-pitch-alignment": "map",
          ...(this.sortKey() && { "symbol-sort-key": this.sortKey() }),
        },
        paint: { "icon-color": this.recordColor(), "icon-opacity": this.recordOpacity(0.6), "icon-halo-color": ring, "icon-halo-width": s.stroke ? 1 : 0 },
      } as LayerSpecification;
    }
    if (s.shape === "circles") {
      return {
        ...base,
        type: "circle",
        paint: {
          "circle-color": this.recordColor(),
          "circle-radius": this.metersToPx(s.size),
          "circle-opacity": this.recordOpacity(0.4),
          "circle-stroke-color": this.recordColor(),
          "circle-stroke-opacity": s.stroke ? this.recordOpacity() : 0,
          "circle-stroke-width": 1.2,
          "circle-pitch-alignment": "map",
          "circle-pitch-scale": "map",
        },
      } as LayerSpecification;
    }
    // Pontos (também por baixo dos hexágonos e das regiões, ao aproximar).
    const r = s.shape === "points" ? s.size : DEFAULT_DATA_STYLE.size;
    return {
      ...base,
      type: "circle",
      paint: {
        "circle-color": this.recordColor(),
        // Ponto do dado (docs/DESIGN.md · Mapa 1): anel da cor do chão separa vizinhos. Afastado, pequeno.
        "circle-radius": this.zoomSize([[0, r * 0.45], [8, r * 0.58], [12, r * 0.67], [14, r * 0.72], [16, r], [19, r * 1.55]]),
        "circle-opacity": this.recordOpacity(),
        "circle-stroke-color": ring,
        "circle-stroke-width": s.stroke ? (["interpolate", ["linear"], ["zoom"], 0, 0.4, 12, 0.7, 16, 1.5] as ExpressionSpecification) : 0,
        "circle-stroke-opacity": this.recordOpacity(),
      },
      ...(this.sortKey() && { layout: { "circle-sort-key": this.sortKey() } }),
    } as LayerSpecification;
  }
}
