/// <reference path="./env.d.ts" />
import {
  type GeoJSONSource,
  type LayerSpecification,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  type SourceSpecification,
  ScaleControl,
  addProtocol,
  setWorkerUrl,
  type MapMouseEvent,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { FileSource, PMTiles, Protocol } from "pmtiles";
import { CatalogLayer, type CatalogPick, type DatapackManifest, type LayerData } from "./catalog";
import { CATEGORY_COLORS, DatasetLayer, OTHER_COLOR, categoryColor, readDatasetMeta, type AreaSummary, type DatasetFilter, type DatasetPick } from "./dataset";
import { paintBuildings, type BuildingPaintResult, type BuildingRecord } from "./buildingPaint";
import { circleArea, type AreaGeometry } from "./geo";
import type { NearbySummary, SearchHit } from "./nearby";
import { lineLengthM, polygonMeasure } from "./measure";
import { loadMaqueteData, type MaqueteData, type MaqueteInputPoint } from "./maquete/extract";

export type MeasureMode = "distance" | "area";

/** Resultado vivo da medição (atualiza a cada clique e ao mover o mouse). */
export interface MeasureState {
  mode: MeasureMode;
  points: [number, number][];
  lengthM: number;
  areaM2: number;
  perimeterM: number;
  done: boolean;
}
import { BUILDINGS_3D_LAYER, BUILDINGS_SOURCE, BASEMAP_SOURCE, TERRAIN_SOURCE, buildStyle, maquetePalette, type BasemapLook, type StyleOptions, type Theme } from "./style";
import type { MaquetePalette } from "./maquete/scene";

export interface Camera {
  center: [lon: number, lat: number];
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface CityMapOptions extends StyleOptions {
  container: HTMLElement;
  camera?: Partial<Camera>;
  /** Exagero vertical do relevo (1 = real). */
  terrainExaggeration?: number;
  /**
   * Sincroniza a câmera com o hash da URL. Desligado quando embutido no site de terceiros.
   * Uma string vira o nome do parâmetro (`#map=…`), deixando o resto do hash livre.
   */
  hash?: boolean | string;
  /** Relevo começa ligado (quando há fonte de relevo). */
  terrain?: boolean;
}

export type CityMapEvent = "load" | "move" | "idle";

/** Tudo o que está sob um clique: o dado do cliente (se houver) e as camadas de catálogo. */
export interface MapPick {
  lngLat: [number, number];
  dataset: DatasetPick | null;
  catalog: CatalogPick[];
  /** Prédio aceso pelos dados: quantos registros caem nele e quais (até 25). */
  building: { datasetId: string; count: number; category: number; records: BuildingRecord[] } | null;
}

let protocol: Protocol | null = null;

function initMapLibre(): Protocol {
  if (!protocol) {
    // O worker é carregado de arquivo próprio; o bundler precisa emitir e nos dar a URL.
    setWorkerUrl(workerUrl);
    protocol = new Protocol();
    addProtocol("pmtiles", protocol.tile);
  }
  return protocol;
}

/**
 * Fachada do mapa. O resto da aplicação fala com o CityMap, nunca com o MapLibre direto,
 * para podermos evoluir (ou trocar) o motor de renderização sem reescrever a UI.
 */
export class CityMap {
  private readonly map: MapLibreMap;
  private styleOptions: StyleOptions;
  private terrainEnabled = true;
  private terrainExaggeration: number;
  private buildingsEnabled = true;
  private readonly resizeObserver: ResizeObserver;
  private readonly datasets: DatasetLayer[] = [];
  private readonly catalog = new Map<string, CatalogLayer>();
  /** Filtro por camada (dataset ou catálogo), guardado mesmo antes de a camada existir. */
  private readonly layerFilters = new Map<string, DatasetFilter>();
  /** Datasets com a vista de hexágonos ligada (vale também para os que ainda vão carregar). */
  private readonly hexViews = new Set<string>();
  /** Ícones por categoria pedidos para cada dataset (aplicados também a datasets que ainda vão carregar). */
  private readonly datasetIcons = new Map<string, (string | null)[]>();
  /** Camadas externas genéricas (ex.: cobertura de fotos de rua); voltam após troca de estilo. */
  private readonly overlays = new Map<string, MapOverlay>();
  private locationMarker: Marker | null = null;
  private popup: Popup | null = null;
  private measure: {
    mode: MeasureMode;
    points: [number, number][];
    cursor: [number, number] | null;
    done: boolean;
    onChange: (state: MeasureState) => void;
    cleanup: () => void;
  } | null = null;
  /**
   * Estilo carregado (fontes e camadas podem ser adicionadas). Diferente de `isStyleLoaded()`
   * do MapLibre, que só fica verdadeiro quando todos os tiles terminaram de carregar.
   */
  private styleReady = false;
  private orbitFrame = 0;
  /** Prédios pintados pelos pontos de um dataset (no nível da rua). */
  private buildingPaint: { datasetId: string; onResult?: (r: BuildingPaintResult | null) => void; timer: number; signature?: string } | null = null;
  private readonly repaintBuildings = () => this.scheduleBuildingPaint();
  /** Tiles novos de pontos ou prédios: repinta (ignora a própria fonte dos prédios pintados). */
  private readonly repaintOnTiles = (e: { sourceId?: string; isSourceLoaded?: boolean; tile?: unknown }) => {
    const paint = this.buildingPaint;
    if (!paint || !e.tile || !e.isSourceLoaded) return;
    if (e.sourceId === `cv-${paint.datasetId}` || e.sourceId === BUILDINGS_SOURCE || e.sourceId === BASEMAP_SOURCE) {
      this.scheduleBuildingPaint();
    }
  };
  private orbitCleanup: (() => void) | null = null;

  constructor({
    container,
    camera,
    terrainExaggeration = 1.5,
    hash = false,
    terrain = true,
    ...styleOptions
  }: CityMapOptions) {
    initMapLibre();
    this.styleOptions = styleOptions;
    this.terrainExaggeration = terrainExaggeration;
    this.terrainEnabled = terrain;

    this.map = new MapLibreMap({
      container,
      style: buildStyle(styleOptions),
      center: camera?.center ?? [-46.6333, -23.5505],
      zoom: camera?.zoom ?? 12,
      pitch: camera?.pitch ?? 0,
      bearing: camera?.bearing ?? 0,
      maxPitch: 85,
      hash,
      attributionControl: { compact: true },
    });

    this.map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    this.map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    this.map.on("style.load", () => {
      this.styleReady = true;
      this.applyState();
    });

    // O container muda de tamanho sem a janela mudar (ex.: sidebar abrindo/fechando).
    this.resizeObserver = new ResizeObserver(() => this.map.resize());
    this.resizeObserver.observe(container);
  }

  /** Acesso bruto ao MapLibre. Uso restrito ao pacote engine e a depuração. */
  get native(): MapLibreMap {
    return this.map;
  }

  get camera(): Camera {
    const c = this.map.getCenter();
    return {
      center: [c.lng, c.lat],
      zoom: this.map.getZoom(),
      pitch: this.map.getPitch(),
      bearing: this.map.getBearing(),
    };
  }

  on(event: CityMapEvent, handler: () => void): () => void {
    this.map.on(event, handler);
    return () => this.map.off(event, handler);
  }

  /**
   * Carrega um dataset gerado pelo cityview-tiler (PMTiles) e o desenha no mapa.
   * Resolve depois de ler os metadados; os tiles chegam sob demanda.
   */
  /**
   * Dataset em PMTiles: uma URL (servidor, data/out) ou o arquivo já em memória (Blob gerado no navegador
   * a partir dos arquivos do usuário — nada sai do computador dele).
   */
  async addDataset(id: string, source: string | Blob, options: { attribution?: string } = {}): Promise<DatasetLayer> {
    // Blob: o protocolo pmtiles:// acha o arquivo pela chave (nome do File).
    const pmtiles = typeof source === "string" ? new PMTiles(source) : new PMTiles(new FileSource(new File([source], `local-${id}.pmtiles`)));
    const url = typeof source === "string" ? source : `local-${id}.pmtiles`;
    initMapLibre().add(pmtiles);
    const meta = await readDatasetMeta(pmtiles);
    const layer = new DatasetLayer(this.map, id, url, meta, pmtiles, options.attribution);
    layer.labelTheme = this.styleOptions.theme ?? "light";
    const filter = this.layerFilters.get(id);
    if (filter) layer.setFilter(filter);
    const icons = this.datasetIcons.get(id);
    if (icons) void layer.setIcons(icons);
    if (this.hexViews.has(id)) layer.setHexView(true);
    this.datasets.push(layer);
    this.whenStyleReady(() => layer.attach());
    return layer;
  }

  /** Adiciona (ou religa) uma camada do catálogo a partir do manifesto do datapack. */
  showCatalogLayer(manifest: DatapackManifest, data: LayerData): CatalogLayer {
    let layer = this.catalog.get(manifest.id);
    if (!layer) {
      layer = new CatalogLayer(this.map, manifest, data);
      const filter = this.layerFilters.get(manifest.id);
      layer.setFilter(filter?.categories ?? null, filter?.where ?? null);
      this.catalog.set(manifest.id, layer);
      const created = layer;
      this.whenStyleReady(() => this.attachCatalog(created));
    }
    layer.setVisible(true);
    return layer;
  }

  /**
   * Filtra uma camada: `categories` são os índices da legenda visíveis, `where` as condições por coluna
   * (faixa numérica, texto contém). null mostra tudo. Vale para datasets em tiles (categorias em pontos,
   * hexágonos e "Na tela"; condições só nos pontos, que têm as colunas) e camadas GeoJSON.
   */
  setLayerFilter(id: string, filter: DatasetFilter | null): void {
    const next: DatasetFilter = {};
    if (filter?.categories) next.categories = filter.categories;
    if (filter?.where && Object.keys(filter.where).length) next.where = filter.where;
    if (Object.keys(next).length) this.layerFilters.set(id, next);
    else this.layerFilters.delete(id);
    this.datasets.find((d) => d.id === id)?.setFilter(next);
    this.catalog.get(id)?.setFilter(next.categories ?? null, next.where ?? null);
  }

  /**
   * Ícone por categoria de um dataset (SVG de traço, índice = categoria; null numa posição = sem ícone).
   * Ao aproximar, os pontos viram marcadores com o ícone. null tira os ícones.
   */
  setDatasetIcons(id: string, svgs: (string | null)[] | null): Promise<void> {
    if (svgs) this.datasetIcons.set(id, svgs);
    else this.datasetIcons.delete(id);
    return this.datasets.find((d) => d.id === id)?.setIcons(svgs) ?? Promise.resolve();
  }

  getLayerFilter(id: string): DatasetFilter | null {
    return this.layerFilters.get(id) ?? null;
  }

  /** Faixa de valores de uma coluna numérica no que já foi carregado da camada (dica para o filtro). */
  columnRange(id: string, column: string): { min: number; max: number } | null {
    if (!this.styleReady) return null;
    return (this.datasets.find((d) => d.id === id) ?? this.catalog.get(id))?.columnRange(column) ?? null;
  }

  hideCatalogLayer(id: string): void {
    this.catalog.get(id)?.setVisible(false);
  }

  removeCatalogLayer(id: string): void {
    this.catalog.get(id)?.detach();
    this.catalog.delete(id);
  }

  /** Enquadra a câmera num retângulo [oeste, sul, leste, norte]. */
  fitBounds(bounds: [number, number, number, number], maxZoom = 14): void {
    const [w, s, e, n] = bounds;
    this.map.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom, duration: 1200 });
  }

  removeDataset(id: string): void {
    const i = this.datasets.findIndex((d) => d.id === id);
    if (i === -1) return;
    this.datasets[i]!.detach();
    this.datasets.splice(i, 1);
  }

  hasDataset(id: string): boolean {
    return this.datasets.some((d) => d.id === id);
  }

  setDatasetVisible(id: string, visible: boolean): void {
    this.datasets.find((d) => d.id === id)?.setVisible(visible);
  }

  /** Hexágonos dos datasets como colunas 3D. */
  setDatasetsExtruded(on: boolean): void {
    for (const d of this.datasets) d.setExtruded(on);
  }

  /** Vista de densidade (hexágonos) de um dataset; desligada = bolinhas em todos os zooms. */
  setDatasetHexView(id: string, on: boolean): void {
    if (on) this.hexViews.add(id);
    else this.hexViews.delete(id);
    this.datasets.find((d) => d.id === id)?.setHexView(on);
  }

  /** O arquivo tem pontos no zoom afastado? (os antigos só têm hexágonos lá) */
  datasetHasLowZoomPoints(id: string): boolean {
    return this.datasets.find((d) => d.id === id)?.hasLowZoomPoints ?? false;
  }

  /** Polígonos de uma camada do catálogo como prismas 3D. */
  setCatalogExtruded(id: string, on: boolean): void {
    this.catalog.get(id)?.setExtruded(on);
  }

  /** Contorno completo de uma feição do catálogo (ex.: município clicado). */
  getCatalogGeometry(id: string, featureId: string | number): Promise<AreaGeometry | null> {
    return this.catalog.get(id)?.getGeometry(featureId) ?? Promise.resolve(null);
  }

  // ---------- Maquete holográfica ----------

  private maqueteTiles: PMTiles[] | null = null;

  /** Cores da maquete no tema e estilo atuais do mapa. */
  maquetePalette(): MaquetePalette {
    return maquetePalette(this.styleOptions.theme ?? "light", this.styleOptions.look ?? "data");
  }

  /**
   * Dados da maquete de um ponto: prédios, ruas, água e verde num raio (do mapa base detalhado) e,
   * se `datasetIds` vier, os pontos desses datasets na área (acendem prédios e viram feixes).
   */
  async maqueteData(center: [number, number], radiusM: number, datasetIds: string[] = []): Promise<MaqueteData> {
    // Mapa detalhado (prédios) primeiro; fora da cobertura dele, o mapa base (ruas e água, sem prédios).
    this.maqueteTiles ??= [this.styleOptions.buildingsUrl, this.styleOptions.basemapUrl].filter((u): u is string => Boolean(u)).map((u) => new PMTiles(u));
    const points: MaqueteInputPoint[] = [];
    for (const id of datasetIds) {
      const dataset = this.datasets.find((d) => d.id === id);
      if (!dataset) continue;
      const near = await dataset.nearby(center, radiusM).catch(() => null);
      const title = dataset.meta.title ?? undefined;
      for (const p of near?.points ?? []) {
        const color = p.category !== null && p.category < dataset.meta.categories.length ? categoryColor(p.category, dataset.meta.categories) : OTHER_COLOR;
        points.push({
          lngLat: p.lngLat,
          color,
          datasetId: id,
          category: p.category,
          properties: p.properties,
          ...(title && p.properties[title] ? { title: String(p.properties[title]) } : {}),
        });
      }
    }
    return loadMaqueteData(this.maqueteTiles, { center, radiusM, points });
  }

  // ---------- Prédios dos seus dados ----------

  /**
   * Pinta os prédios 3D com a categoria predominante dos pontos do dataset que caem neles.
   * Só acontece a partir do zoom dos pontos (14); abaixo disso `onResult` recebe `null`.
   * Passe `null` para desligar.
   */
  setBuildingPaint(datasetId: string | null, onResult?: (r: BuildingPaintResult | null) => void): void {
    if (this.buildingPaint) {
      window.clearTimeout(this.buildingPaint.timer);
      this.map.off("moveend", this.repaintBuildings);
      this.map.off("sourcedata", this.repaintOnTiles);
    }
    this.buildingPaint = datasetId ? { datasetId, onResult, timer: 0 } : null;
    if (!datasetId) {
      if (this.map.getLayer("client-buildings")) this.map.removeLayer("client-buildings");
      if (this.map.getSource("client-buildings")) this.map.removeSource("client-buildings");
      this.dimBaseBuildings(false);
      return;
    }
    this.map.on("moveend", this.repaintBuildings);
    this.map.on("sourcedata", this.repaintOnTiles);
    this.scheduleBuildingPaint();
  }

  private scheduleBuildingPaint(): void {
    const paint = this.buildingPaint;
    if (!paint) return;
    window.clearTimeout(paint.timer);
    paint.timer = window.setTimeout(() => this.runBuildingPaint(), 200);
  }

  private runBuildingPaint(): void {
    const paint = this.buildingPaint;
    const dataset = paint && this.datasets.find((d) => d.id === paint.datasetId);
    if (!paint || !dataset || !this.styleReady) return;
    const buildingsSource = this.map.getSource(BUILDINGS_SOURCE) ? BUILDINGS_SOURCE : BASEMAP_SOURCE;
    const empty = { type: "FeatureCollection" as const, features: [] };
    if (this.map.getZoom() < dataset.meta.pointsZoom) {
      this.map.getSource<GeoJSONSource>("client-buildings")?.setData(empty);
      this.dimBaseBuildings(false);
      paint.onResult?.(null);
      return;
    }
    const result = paintBuildings(this.map, {
      pointsSource: `cv-${dataset.id}`,
      pointsLayer: `cv-${dataset.id}-points`,
      categoryProperty: dataset.meta.categoryProperty,
      buildingsSource,
      buildingsLayer: BUILDINGS_3D_LAYER,
    });
    // Tiles chegando disparam nova pintura; se o resultado é o mesmo, não redesenha (evita piscar).
    if (result.signature === paint.signature && this.map.getSource("client-buildings")) return;
    paint.signature = result.signature;
    const data = { type: "FeatureCollection" as const, features: result.features };
    const source = this.map.getSource<GeoJSONSource>("client-buildings");
    if (source) source.setData(data);
    else {
      this.map.addSource("client-buildings", { type: "geojson", data });
      const pairs = dataset.meta.categories.flatMap((_, i) => [i, categoryColor(i, dataset.meta.categories)]);
      const color = (pairs.length ? ["match", ["get", "c"], ...pairs, OTHER_COLOR] : CATEGORY_COLORS[0]) as never;
      const beforeId = this.map.getStyle().layers.find((l) => l.type === "symbol")?.id;
      this.map.addLayer(
        {
          id: "client-buildings",
          type: "fill-extrusion",
          source: "client-buildings",
          paint: {
            "fill-extrusion-color": color,
            // Um pouco mais alto que o prédio original para não brigar com as paredes dele.
            "fill-extrusion-height": ["+", ["*", ["get", "h"], 1.04], 1.5],
            "fill-extrusion-base": ["get", "mh"],
            "fill-extrusion-opacity": 0.96,
            "fill-extrusion-vertical-gradient": true,
          },
        },
        beforeId,
      );
    }
    this.dimBaseBuildings(true);
    paint.onResult?.(result);
  }

  private pickBuilding(point: { x: number; y: number }): MapPick["building"] {
    if (!this.buildingPaint || !this.map.getLayer("client-buildings")) return null;
    const [f] = this.map.queryRenderedFeatures([point.x, point.y], { layers: ["client-buildings"] });
    if (!f) return null;
    const p = f.properties as { c: number; n: number; recs: string };
    let records: BuildingRecord[] = [];
    try {
      records = JSON.parse(p.recs) as BuildingRecord[];
    } catch {
      // propriedade ausente: segue sem a lista
    }
    return { datasetId: this.buildingPaint.datasetId, count: Number(p.n), category: Number(p.c), records };
  }

  /** A cidade cinza fica mais apagada quando os prédios dos dados estão acesos. */
  private dimBaseBuildings(on: boolean): void {
    if (!this.map.getLayer(BUILDINGS_3D_LAYER)) return;
    const dark = this.styleOptions.theme === "dark";
    this.map.setPaintProperty(BUILDINGS_3D_LAYER, "fill-extrusion-color", on ? (dark ? "#23262c" : "#c9c6c0") : dark ? "#2c2f36" : "#d9d6d0");
  }

  // ---------- Câmera ----------

  setTerrainExaggeration(exaggeration: number): void {
    this.setTerrain(true, exaggeration);
  }

  /**
   * Câmera girando devagar em volta do centro. Para quando a pessoa interagir com o mapa;
   * `onStop` avisa (para a interface desmarcar o controle).
   */
  startOrbit(degreesPerSecond = 5, onStop?: () => void): void {
    this.stopOrbit();
    let last = performance.now();
    const step = (now: number) => {
      this.map.setBearing(this.map.getBearing() + ((now - last) / 1000) * degreesPerSecond);
      last = now;
      this.orbitFrame = requestAnimationFrame(step);
    };
    this.orbitFrame = requestAnimationFrame(step);
    const interrupt = () => {
      if (!this.orbitFrame) return;
      this.stopOrbit();
      onStop?.();
    };
    this.orbitCleanup = () => {
      this.map.off("mousedown", interrupt);
      this.map.off("touchstart", interrupt);
      this.map.off("wheel", interrupt);
    };
    this.map.on("mousedown", interrupt);
    this.map.on("touchstart", interrupt);
    this.map.on("wheel", interrupt);
  }

  stopOrbit(): void {
    cancelAnimationFrame(this.orbitFrame);
    this.orbitFrame = 0;
    this.orbitCleanup?.();
    this.orbitCleanup = null;
  }

  isOrbiting(): boolean {
    return this.orbitFrame !== 0;
  }

  /** Clique com tudo o que está sob o cursor, de todas as camadas. */
  onMapPick(handler: (pick: MapPick) => void): () => void {
    const listener = (e: MapMouseEvent) => {
      if (this.measure) return; // medindo: o clique marca pontos
      const dataset = this.datasets.map((d) => d.pick(e.point)).find((p) => p !== null) ?? null;
      const catalog = [...this.catalog.values()].map((c) => c.pick(e.point)).filter((p): p is CatalogPick => p !== null);
      handler({ lngLat: [e.lngLat.lng, e.lngLat.lat], dataset, catalog, building: this.pickBuilding(e.point) });
    };
    this.map.on("click", listener);
    return () => this.map.off("click", listener);
  }

  /** Executa já se o estilo estiver pronto; senão, `applyState` cuida disso no "style.load". */
  private whenStyleReady(fn: () => void): void {
    if (this.styleReady) fn();
  }

  /** Polígonos ficam abaixo dos dados do cliente; pontos, acima; rótulos sempre por cima. */
  private attachCatalog(layer: CatalogLayer): void {
    const layers = this.map.getStyle().layers;
    const firstSymbol = layers.find((l) => l.type === "symbol")?.id;
    const firstDataset = layers.find((l) => l.id.startsWith("cv-"))?.id;
    layer.attach(layer.manifest.geometry === "polygon" ? (firstDataset ?? firstSymbol) : firstSymbol);
  }

  /** Clique sobre dados: devolve o registro ou o agregado sob o cursor. */
  onPick(handler: (pick: DatasetPick | null) => void): () => void {
    const listener = (e: MapMouseEvent) => {
      for (const dataset of this.datasets) {
        const pick = dataset.pick(e.point);
        if (pick) return handler(pick);
      }
      handler(null);
    };
    this.map.on("click", listener);
    return () => this.map.off("click", listener);
  }

  /** Cursor de "clicável" sobre camadas de dados. */
  enableHoverCursor(): void {
    this.map.on("mousemove", (e) => {
      if (this.measure) return;
      const layers = [
        ...this.datasets.flatMap((d) => d.layerIds),
        ...[...this.catalog.values()].filter((c) => c.isVisible()).flatMap((c) => c.layerIds),
      ].filter((id) => this.map.getLayer(id));
      const hit = layers.length > 0 && this.map.queryRenderedFeatures(e.point, { layers }).length > 0;
      this.map.getCanvas().style.cursor = hit ? "pointer" : "";
    });
  }

  /** Resolve quando o mapa terminar de renderizar (tiles carregados, sem animação pendente). */
  whenIdle(): Promise<void> {
    return new Promise((resolve) => {
      this.map.once("idle", () => resolve());
      this.map.triggerRepaint();
    });
  }

  flyTo(camera: Partial<Camera>): void {
    this.map.flyTo({ ...camera, essential: true });
  }

  /** Muda a câmera sem animação (ex.: trocar de aba). */
  jumpTo(camera: Partial<Camera>): void {
    this.map.jumpTo(camera);
  }

  setTheme(theme: Theme): void {
    this.styleOptions = { ...this.styleOptions, theme };
    this.styleReady = false;
    this.map.setStyle(buildStyle(this.styleOptions));
  }

  /** "data" (neutro, para dados) ou "classic" (colorido). */
  setLook(look: BasemapLook): void {
    this.styleOptions = { ...this.styleOptions, look };
    this.styleReady = false;
    this.map.setStyle(buildStyle(this.styleOptions));
  }

  setTerrain(enabled: boolean, exaggeration = this.terrainExaggeration): void {
    this.terrainEnabled = enabled;
    this.terrainExaggeration = exaggeration;
    if (this.styleReady) this.applyState();
  }

  setBuildings3D(enabled: boolean): void {
    this.buildingsEnabled = enabled;
    if (this.styleReady) this.applyState();
  }

  /**
   * Liga (ou troca) uma camada externa: uma fonte + camadas, acima dos dados e abaixo dos rótulos.
   * A fonte usa o id do overlay; os ids das camadas devem ser únicos.
   */
  setOverlay(overlay: MapOverlay): void {
    this.removeOverlay(overlay.id);
    this.overlays.set(overlay.id, overlay);
    this.whenStyleReady(() => this.attachOverlay(overlay));
  }

  removeOverlay(id: string): void {
    const overlay = this.overlays.get(id);
    if (!overlay) return;
    this.overlays.delete(id);
    for (const layer of overlay.layers) if (this.map.getLayer(layer.id)) this.map.removeLayer(layer.id);
    if (this.map.getSource(id)) this.map.removeSource(id);
  }

  private attachOverlay(overlay: MapOverlay): void {
    if (this.map.getSource(overlay.id)) return;
    this.map.addSource(overlay.id, overlay.source);
    // Camadas de apoio (ex.: cobertura de fotos de rua) ficam abaixo dos pontos dos datasets: o dado é o
    // protagonista. As do próprio motor (`cv-`, ex.: medição) ficam por cima dos dados.
    const layers = this.map.getStyle().layers;
    const firstSymbol = layers.find((l) => l.type === "symbol")?.id;
    const firstData = layers.find((l) => l.id.startsWith("cv-") && !this.overlays.has(l.id.split("-").slice(0, 2).join("-")))?.id;
    const beforeId = overlay.id.startsWith("cv-") ? firstSymbol : (firstData ?? firstSymbol);
    for (const layer of overlay.layers) this.map.addLayer(layer, beforeId);
  }

  /**
   * Marcador de posição com direção (ex.: câmera da foto de rua). `bearing` em graus a partir do norte.
   * `null` remove.
   */
  /** O que um dataset tem desenhado na tela agora (widgets "Na tela"); null se escondido. */
  viewportSummary(datasetId: string): (AreaSummary & { mode: "points" | "hex" }) | null {
    if (!this.styleReady) return null;
    return this.datasets.find((d) => d.id === datasetId)?.viewportSummary() ?? null;
  }

  /** Avisa quando o mapa para de mexer (ou carrega dados novos), para recalcular widgets. */
  onViewChange(fn: () => void): () => void {
    let timer = 0;
    const run = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(fn, 250);
    };
    this.map.on("moveend", run);
    this.map.on("idle", run);
    return () => {
      window.clearTimeout(timer);
      this.map.off("moveend", run);
      this.map.off("idle", run);
    };
  }

  /** Inclinação para 3D (com prédios) ou 2D (de cima). */
  setPerspective(mode: "2d" | "3d"): void {
    this.map.easeTo({ pitch: mode === "3d" ? 55 : 0, bearing: mode === "3d" ? this.map.getBearing() : 0, duration: 800 });
  }

  /** Resumo do que um dataset tem num raio (ex.: Lugares em 500 m de um registro). */
  nearby(datasetId: string, center: [number, number], radiusM: number): Promise<NearbySummary> {
    const dataset = this.datasets.find((d) => d.id === datasetId);
    if (!dataset) return Promise.reject(new Error(`dataset desconhecido: ${datasetId}`));
    return dataset.nearby(center, radiusM);
  }

  /**
   * Busca por nome em todos os datasets com título (ou só nos indicados), ao redor de um centro.
   * Devolve até `limit` por dataset, já com o id do dataset.
   */
  async searchDatasets(
    query: string,
    options: { center?: [number, number]; radiusM?: number; datasetIds?: string[]; limit?: number } = {},
  ): Promise<(SearchHit & { datasetId: string })[]> {
    const c = this.map.getCenter();
    const center = options.center ?? ([c.lng, c.lat] as [number, number]);
    const targets = this.datasets.filter((d) => !options.datasetIds || options.datasetIds.includes(d.id));
    const results = await Promise.all(
      targets.map((d) =>
        d
          .search(query, center, options.radiusM ?? 6000, options.limit ?? 8)
          .then((hits) => hits.map((h) => ({ ...h, datasetId: d.id })))
          .catch(() => []),
      ),
    );
    return results.flat();
  }

  // ---------- Medição (distância e área no elipsoide) ----------

  /**
   * Liga o modo de medir: clique marca pontos, mover mostra o trecho seguinte, duplo clique ou Enter
   * termina, Backspace desfaz, Esc encerra. Depois de terminado, um novo clique começa outra medição.
   */
  startMeasure(mode: MeasureMode, onChange: (state: MeasureState) => void, onExit?: () => void): void {
    this.stopMeasure();
    const m = { mode, points: [] as [number, number][], cursor: null as [number, number] | null, done: false, onChange, cleanup: () => {} };
    this.measure = m;
    this.map.doubleClickZoom.disable();
    const canvas = this.map.getCanvas();
    canvas.style.cursor = "crosshair";
    const click = (e: MapMouseEvent) => {
      const p: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      if (m.done) {
        m.points = [];
        m.done = false;
      }
      // O duplo clique gera dois cliques no mesmo lugar: não repete o ponto.
      const last = m.points.at(-1);
      if (last && this.map.project(last).dist(e.point) < 4) return;
      m.points.push(p);
      this.renderMeasure();
    };
    const move = (e: MapMouseEvent) => {
      if (m.done || m.points.length === 0) return;
      m.cursor = [e.lngLat.lng, e.lngLat.lat];
      this.renderMeasure();
    };
    const dbl = (e: MapMouseEvent) => {
      e.preventDefault();
      this.finishMeasure();
    };
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Enter") this.finishMeasure();
      else if (e.key === "Backspace") this.undoMeasure();
      else if (e.key === "Escape") {
        this.stopMeasure();
        onExit?.();
      }
    };
    this.map.on("click", click);
    this.map.on("mousemove", move);
    this.map.on("dblclick", dbl);
    window.addEventListener("keydown", key);
    m.cleanup = () => {
      this.map.off("click", click);
      this.map.off("mousemove", move);
      this.map.off("dblclick", dbl);
      window.removeEventListener("keydown", key);
    };
    this.renderMeasure();
  }

  setMeasureMode(mode: MeasureMode): void {
    if (!this.measure) return;
    this.measure.mode = mode;
    this.renderMeasure();
  }

  finishMeasure(): void {
    if (!this.measure) return;
    this.measure.done = this.measure.points.length > 1;
    this.measure.cursor = null;
    this.renderMeasure();
  }

  undoMeasure(): void {
    if (!this.measure) return;
    this.measure.points.pop();
    this.measure.done = false;
    this.renderMeasure();
  }

  clearMeasure(): void {
    if (!this.measure) return;
    this.measure.points = [];
    this.measure.cursor = null;
    this.measure.done = false;
    this.renderMeasure();
  }

  stopMeasure(): void {
    if (!this.measure) return;
    this.measure.cleanup();
    this.measure = null;
    this.removeOverlay("cv-measure");
    this.map.doubleClickZoom.enable();
    this.map.getCanvas().style.cursor = "";
  }

  isMeasuring(): boolean {
    return this.measure !== null;
  }

  private renderMeasure(): void {
    const m = this.measure;
    if (!m) return;
    const pts = m.cursor ? [...m.points, m.cursor] : [...m.points];
    const area = m.mode === "area";
    const features: object[] = [];
    if (area && pts.length >= 3) {
      features.push({ type: "Feature", properties: { kind: "fill" }, geometry: { type: "Polygon", coordinates: [[...pts, pts[0]]] } });
    }
    if (pts.length >= 2) {
      const line = area && pts.length >= 3 ? [...pts, pts[0]] : pts;
      features.push({ type: "Feature", properties: { kind: "line" }, geometry: { type: "LineString", coordinates: line } });
    }
    for (const p of m.points) features.push({ type: "Feature", properties: { kind: "vertex" }, geometry: { type: "Point", coordinates: p } });
    const data = { type: "FeatureCollection", features } as GeoJSON.FeatureCollection;
    const source = this.map.getSource("cv-measure") as GeoJSONSource | undefined;
    if (source && this.overlays.has("cv-measure")) source.setData(data);
    else {
      this.setOverlay({
        id: "cv-measure",
        source: { type: "geojson", data },
        layers: [
          { id: "cv-measure-fill", type: "fill", source: "cv-measure", filter: ["==", ["get", "kind"], "fill"], paint: { "fill-color": "#6068ee", "fill-opacity": 0.14 } },
          { id: "cv-measure-line", type: "line", source: "cv-measure", filter: ["==", ["get", "kind"], "line"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#4a50d6", "line-width": 2.5 } },
          {
            id: "cv-measure-vertex",
            type: "circle",
            source: "cv-measure",
            filter: ["==", ["get", "kind"], "vertex"],
            paint: { "circle-radius": 5, "circle-color": "#ffffff", "circle-stroke-color": "#4a50d6", "circle-stroke-width": 2.5 },
          },
        ],
      });
    }
    const poly = area ? polygonMeasure(pts) : { areaM2: 0, perimeterM: 0 };
    m.onChange({ mode: m.mode, points: [...m.points], lengthM: lineLengthM(pts), areaM2: poly.areaM2, perimeterM: poly.perimeterM, done: m.done });
  }

  /** Desenha (ou apaga, com null) o círculo de um raio em metros. */
  setRadius(radius: { center: [number, number]; radiusM: number } | null): void {
    if (!radius) return this.removeOverlay("cv-radius");
    const circle = circleArea(radius.center, radius.radiusM / 1000);
    this.setOverlay({
      id: "cv-radius",
      source: { type: "geojson", data: { type: "Feature", properties: {}, geometry: circle } },
      layers: [
        { id: "cv-radius-fill", type: "fill", source: "cv-radius", paint: { "fill-color": "#ff7a00", "fill-opacity": 0.06 } },
        {
          id: "cv-radius-line",
          type: "line",
          source: "cv-radius",
          paint: { "line-color": "#ff7a00", "line-width": 1.5, "line-dasharray": [2, 2] },
        },
      ],
    });
  }

  /**
   * Cartão sobre o mapa num ponto (conteúdo é um elemento do app, ex.: um portal React).
   * `onClose` roda quando o usuário fecha o cartão. Chamar de novo move o cartão.
   */
  showPopup(lngLat: [number, number], content: HTMLElement, onClose?: () => void): void {
    this.popup?.off("close", this.popupClose);
    this.popupClose = () => onClose?.();
    if (!this.popup) {
      this.popup = new Popup({ closeButton: true, closeOnClick: false, maxWidth: "340px", offset: 12, className: "cv-popup" });
    }
    this.popup.setLngLat(lngLat).setDOMContent(content);
    if (!this.popup.isOpen()) this.popup.addTo(this.map);
    this.popup.on("close", this.popupClose);
  }

  hidePopup(): void {
    this.popup?.off("close", this.popupClose);
    this.popup?.remove();
  }

  private popupClose: () => void = () => {};

  setLocationMarker(location: { lngLat: [number, number]; bearing?: number } | null): void {
    if (!location) {
      this.locationMarker?.remove();
      this.locationMarker = null;
      return;
    }
    if (!this.locationMarker) {
      const el = document.createElement("div");
      el.className = "cv-location-marker";
      el.innerHTML = '<span class="cv-location-cone"></span><span class="cv-location-dot"></span>';
      this.locationMarker = new Marker({ element: el, rotationAlignment: "map", pitchAlignment: "map" });
      this.locationMarker.setLngLat(location.lngLat).addTo(this.map);
    }
    this.locationMarker.setLngLat(location.lngLat).setRotation(location.bearing ?? 0);
    this.locationMarker.getElement().classList.toggle("has-bearing", location.bearing !== undefined);
  }

  destroy(): void {
    this.stopOrbit();
    this.resizeObserver.disconnect();
    // O MapLibre apaga a câmera do hash ao remover o mapa. Quem recria o mapa logo em seguida
    // (React StrictMode, troca de container) perderia a posição de um link; o hash fica como estava.
    const url = typeof location === "undefined" ? null : location.href;
    this.map.remove();
    if (url && url !== location.href) history.replaceState(history.state, "", url);
  }

  private applyState(): void {
    // Trocar o estilo (ex.: tema) remove fontes e camadas; os datasets voltam aqui.
    for (const dataset of this.datasets) {
      dataset.labelTheme = this.styleOptions.theme ?? "light";
      dataset.attach();
      dataset.setFilter(dataset.getFilter());
    }
    for (const layer of this.catalog.values()) this.attachCatalog(layer);
    for (const overlay of this.overlays.values()) this.attachOverlay(overlay);
    const hasTerrain = Boolean(this.map.getSource(TERRAIN_SOURCE));
    this.map.setTerrain(
      hasTerrain && this.terrainEnabled
        ? { source: TERRAIN_SOURCE, exaggeration: this.terrainExaggeration }
        : null,
    );
    if (this.map.getLayer(BUILDINGS_3D_LAYER)) {
      this.map.setLayoutProperty(BUILDINGS_3D_LAYER, "visibility", this.buildingsEnabled ? "visible" : "none");
    }
    if (this.buildingPaint) this.scheduleBuildingPaint();
  }
}

/** Camada externa genérica para `setOverlay`. */
export interface MapOverlay {
  id: string;
  source: SourceSpecification;
  layers: LayerSpecification[];
}
