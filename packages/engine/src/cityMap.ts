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
import { PMTiles, Protocol } from "pmtiles";
import { CatalogLayer, type CatalogPick, type DatapackManifest, type LayerData } from "./catalog";
import { CATEGORY_COLORS, DatasetLayer, OTHER_COLOR, categoryColor, readDatasetMeta, type AreaSummary, type DatasetPick } from "./dataset";
import type { HexFeature } from "./areaHexes";
import { paintBuildings, type BuildingPaintResult, type BuildingRecord } from "./buildingPaint";
import { areaBounds, circleArea, worldMask, type AreaGeometry } from "./geo";
import type { NearbySummary } from "./nearby";
import { BUILDINGS_3D_LAYER, BUILDINGS_SOURCE, BASEMAP_SOURCE, TERRAIN_SOURCE, buildStyle, type BasemapLook, type StyleOptions, type Theme } from "./style";

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
  /** Camadas externas genéricas (ex.: cobertura de fotos de rua); voltam após troca de estilo. */
  private readonly overlays = new Map<string, MapOverlay>();
  private locationMarker: Marker | null = null;
  private popup: Popup | null = null;
  /**
   * Estilo carregado (fontes e camadas podem ser adicionadas). Diferente de `isStyleLoaded()`
   * do MapLibre, que só fica verdadeiro quando todos os tiles terminaram de carregar.
   */
  private styleReady = false;
  /** Maquete ativa: área recortada e o que restaurar ao sair. */
  private diorama: {
    geometry: AreaGeometry;
    prevTerrain: boolean;
    prevExaggeration: number;
    datasetId: string;
    /** Hexágonos finos da área (GeoJSON), quando já carregados. */
    hexes: HexFeature[] | null;
    columns: boolean;
  } | null = null;
  private orbitFrame = 0;
  /** Prédios pintados pelos pontos de um dataset (no nível da rua). */
  private buildingPaint: { datasetId: string; onResult?: (r: BuildingPaintResult | null) => void; timer: number } | null = null;
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
  async addDataset(id: string, url: string, options: { attribution?: string } = {}): Promise<DatasetLayer> {
    const pmtiles = new PMTiles(url);
    initMapLibre().add(pmtiles);
    const meta = await readDatasetMeta(pmtiles);
    const layer = new DatasetLayer(this.map, id, url, meta, pmtiles, options.attribution);
    layer.labelTheme = this.styleOptions.theme ?? "light";
    this.datasets.push(layer);
    this.whenStyleReady(() => layer.attach());
    return layer;
  }

  /** Adiciona (ou religa) uma camada do catálogo a partir do manifesto do datapack. */
  showCatalogLayer(manifest: DatapackManifest, data: LayerData): CatalogLayer {
    let layer = this.catalog.get(manifest.id);
    if (!layer) {
      layer = new CatalogLayer(this.map, manifest, data);
      this.catalog.set(manifest.id, layer);
      const created = layer;
      this.whenStyleReady(() => this.attachCatalog(created));
    }
    layer.setVisible(true);
    return layer;
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

  /** Polígonos de uma camada do catálogo como prismas 3D. */
  setCatalogExtruded(id: string, on: boolean): void {
    this.catalog.get(id)?.setExtruded(on);
  }

  /** Contorno completo de uma feição do catálogo (ex.: município clicado). */
  getCatalogGeometry(id: string, featureId: string | number): Promise<AreaGeometry | null> {
    return this.catalog.get(id)?.getGeometry(featureId) ?? Promise.resolve(null);
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
      if (this.map.getLayer("diorama-data-surface")) this.map.setPaintProperty("diorama-data-surface", "fill-opacity", 0.88);
      paint.onResult?.(null);
      return;
    }
    const result = paintBuildings(this.map, {
      pointsSource: `cv-${dataset.id}`,
      categoryProperty: dataset.meta.categoryProperty,
      buildingsSource,
    });
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
    // Na maquete, a superfície colorida vira só um "chão" para os prédios aparecerem.
    if (this.map.getLayer("diorama-data-surface")) this.map.setPaintProperty("diorama-data-surface", "fill-opacity", 0.3);
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

  // ---------- Maquete ----------

  /**
   * Recorta uma área em 3D: escurece o entorno, busca os hexágonos finos da área, pinta o
   * relevo com eles (camada plana "drapeada" sobre o terreno) e leva a câmera até lá inclinada.
   * `onSummary` recebe os números da área assim que os hexágonos chegam; a promessa resolve
   * quando a câmera termina de inclinar.
   */
  enterDiorama(
    geometry: AreaGeometry,
    {
      datasetId,
      exaggeration = 1.8,
      columns = false,
      onSummary,
      padding = 70,
      maxZoom = 13.5,
    }: {
      datasetId: string;
      exaggeration?: number;
      columns?: boolean;
      onSummary?: (summary: AreaSummary) => void;
      /** Zoom máximo do enquadramento (áreas pequenas: nível da rua, onde aparecem os prédios). */
      maxZoom?: number;
      /** Espaço livre nas bordas (ex.: deixar a esquerda para um painel). */
      padding?: number | { top: number; bottom: number; left: number; right: number };
    },
  ): Promise<void> {
    this.stopOrbit();
    const dataset = this.datasets.find((d) => d.id === datasetId);
    this.diorama = {
      geometry,
      datasetId,
      hexes: null,
      columns,
      prevTerrain: this.diorama?.prevTerrain ?? this.terrainEnabled,
      prevExaggeration: this.diorama?.prevExaggeration ?? this.terrainExaggeration,
    };
    const session = this.diorama;
    this.addDioramaLayers();
    const [w, s, e, n] = areaBounds(geometry);
    const moveEnd = () => new Promise<void>((resolve) => this.map.once("moveend", () => resolve()));

    return (async () => {
      // Câmera e dados em paralelo: enquanto voa, os hexágonos finos da área chegam.
      this.setTerrain(true, exaggeration);
      const arrived = moveEnd();
      this.map.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        { padding, pitch: 58, bearing: -18, maxZoom, duration: 2600, essential: true },
      );
      if (dataset) {
        const { features } = await dataset.loadAreaHexes(geometry);
        if (this.diorama !== session) return;
        session.hexes = features;
        dataset.setVisible(false); // a camada da área substitui a normal
        this.addDioramaLayers();
        onSummary?.(dataset.summarize(features));
      }
      await arrived;
    })();
  }

  /** Colunas 3D sobre o relevo pintado, na maquete. */
  setDioramaColumns(on: boolean): void {
    if (!this.diorama) return;
    this.diorama.columns = on;
    if (this.map.getLayer("diorama-data-columns")) {
      this.map.setLayoutProperty("diorama-data-columns", "visibility", on ? "visible" : "none");
    }
  }

  exitDiorama(): void {
    if (!this.diorama) return;
    this.stopOrbit();
    const { prevTerrain, prevExaggeration, datasetId } = this.diorama;
    this.diorama = null;
    for (const id of ["diorama-outline", "diorama-glow", "diorama-mask", "diorama-data-columns", "diorama-data-surface"]) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
    for (const id of ["diorama-mask", "diorama-area", "diorama-data"]) if (this.map.getSource(id)) this.map.removeSource(id);
    this.datasets.find((d) => d.id === datasetId)?.setVisible(true);
    this.setTerrain(prevTerrain, prevExaggeration);
    this.map.easeTo({ pitch: 0, bearing: 0, duration: 1200 });
  }

  isInDiorama(): boolean {
    return this.diorama !== null;
  }

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

  private addDioramaLayers(): void {
    const d = this.diorama;
    if (!d || !this.styleReady) return;
    const mask = worldMask(d.geometry);
    const area = { type: "Feature" as const, properties: {}, geometry: d.geometry };
    const hexes = { type: "FeatureCollection" as const, features: d.hexes ?? [] };
    const beforeId = this.map.getStyle().layers.find((l) => l.type === "symbol")?.id;
    const dark = this.styleOptions.theme === "dark";

    if (this.map.getSource("diorama-mask")) {
      this.map.getSource<GeoJSONSource>("diorama-mask")?.setData(mask);
      this.map.getSource<GeoJSONSource>("diorama-area")?.setData(area);
      this.map.getSource<GeoJSONSource>("diorama-data")?.setData(hexes);
    } else {
      this.map.addSource("diorama-mask", { type: "geojson", data: mask });
      this.map.addSource("diorama-area", { type: "geojson", data: area });
      this.map.addSource("diorama-data", { type: "geojson", data: hexes });
    }

    // Ordem: dados da área (relevo pintado e colunas) → máscara do entorno → contorno → rótulos.
    // A escala de cor depende dos hexágonos da área: recria as camadas quando eles chegam.
    const dataset = this.datasets.find((x) => x.id === d.datasetId);
    for (const id of ["diorama-data-columns", "diorama-data-surface"]) if (this.map.getLayer(id)) this.map.removeLayer(id);
    if (dataset && d.hexes) {
      const before = this.map.getLayer("diorama-mask") ? "diorama-mask" : beforeId;
      const { surface, columns } = dataset.areaLayers("diorama-data", d.hexes);
      this.map.addLayer(surface, before);
      this.map.addLayer({ ...columns, layout: { visibility: d.columns ? "visible" : "none" } } as typeof columns, before);
    }
    if (!this.map.getLayer("diorama-mask")) {
      this.map.addLayer(
        { id: "diorama-mask", type: "fill", source: "diorama-mask", paint: { "fill-color": dark ? "#05070b" : "#ebe9e4", "fill-opacity": 0.86 } },
        beforeId,
      );
      this.map.addLayer(
        {
          id: "diorama-glow",
          type: "line",
          source: "diorama-area",
          paint: { "line-color": "#ffd166", "line-width": 12, "line-blur": 10, "line-opacity": 0.45 },
        },
        beforeId,
      );
      this.map.addLayer(
        { id: "diorama-outline", type: "line", source: "diorama-area", paint: { "line-color": "#ffd166", "line-width": 2.2 } },
        beforeId,
      );
    }
  }

  /** Clique com tudo o que está sob o cursor, de todas as camadas. */
  onMapPick(handler: (pick: MapPick) => void): () => void {
    const listener = (e: MapMouseEvent) => {
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
    const beforeId = this.map.getStyle().layers.find((l) => l.type === "symbol")?.id;
    for (const layer of overlay.layers) this.map.addLayer(layer, beforeId);
  }

  /**
   * Marcador de posição com direção (ex.: câmera da foto de rua). `bearing` em graus a partir do norte.
   * `null` remove.
   */
  /** Resumo do que um dataset tem num raio (ex.: Lugares em 500 m de um registro). */
  nearby(datasetId: string, center: [number, number], radiusM: number): Promise<NearbySummary> {
    const dataset = this.datasets.find((d) => d.id === datasetId);
    if (!dataset) return Promise.reject(new Error(`dataset desconhecido: ${datasetId}`));
    return dataset.nearby(center, radiusM);
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
    this.addDioramaLayers();
    if (this.buildingPaint) this.scheduleBuildingPaint();
  }
}

/** Camada externa genérica para `setOverlay`. */
export interface MapOverlay {
  id: string;
  source: SourceSpecification;
  layers: LayerSpecification[];
}
