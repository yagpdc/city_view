/// <reference path="./env.d.ts" />
import {
  type GeoJSONSource,
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  addProtocol,
  setWorkerUrl,
  type MapMouseEvent,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { PMTiles, Protocol } from "pmtiles";
import { CatalogLayer, type CatalogPick, type DatapackManifest, type LayerData } from "./catalog";
import { DatasetLayer, readDatasetMeta, type AreaSummary, type DatasetPick } from "./dataset";
import type { HexFeature } from "./areaHexes";
import { areaBounds, worldMask, type AreaGeometry } from "./geo";
import { BUILDINGS_3D_LAYER, TERRAIN_SOURCE, buildStyle, type BasemapLook, type StyleOptions, type Theme } from "./style";

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
  /** Sincroniza a câmera com o hash da URL. Desligado quando embutido no site de terceiros. */
  hash?: boolean;
  /** Relevo começa ligado (quando há fonte de relevo). */
  terrain?: boolean;
}

export type CityMapEvent = "load" | "move" | "idle";

/** Tudo o que está sob um clique: o dado do cliente (se houver) e as camadas de catálogo. */
export interface MapPick {
  lngLat: [number, number];
  dataset: DatasetPick | null;
  catalog: CatalogPick[];
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
  async addDataset(id: string, url: string): Promise<DatasetLayer> {
    const pmtiles = new PMTiles(url);
    initMapLibre().add(pmtiles);
    const meta = await readDatasetMeta(pmtiles);
    const layer = new DatasetLayer(this.map, id, url, meta, pmtiles);
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
    }: {
      datasetId: string;
      exaggeration?: number;
      columns?: boolean;
      onSummary?: (summary: AreaSummary) => void;
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
        { padding, pitch: 58, bearing: -18, maxZoom: 13.5, duration: 2600, essential: true },
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

  /** Câmera girando devagar em volta do centro (para quando a pessoa interagir). */
  startOrbit(degreesPerSecond = 5): void {
    this.stopOrbit();
    let last = performance.now();
    const step = (now: number) => {
      this.map.setBearing(this.map.getBearing() + ((now - last) / 1000) * degreesPerSecond);
      last = now;
      this.orbitFrame = requestAnimationFrame(step);
    };
    this.orbitFrame = requestAnimationFrame(step);
    const stop = () => this.stopOrbit();
    this.map.once("mousedown", stop);
    this.map.once("touchstart", stop);
    this.map.once("wheel", stop);
  }

  stopOrbit(): void {
    cancelAnimationFrame(this.orbitFrame);
    this.orbitFrame = 0;
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
    const dataset = this.datasets.find((x) => x.id === d.datasetId);
    if (dataset && !this.map.getLayer("diorama-data-surface")) {
      const { surface, columns } = dataset.areaLayers("diorama-data");
      this.map.addLayer(surface, beforeId);
      this.map.addLayer({ ...columns, layout: { visibility: d.columns ? "visible" : "none" } } as typeof columns, beforeId);
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
      handler({ lngLat: [e.lngLat.lng, e.lngLat.lat], dataset, catalog });
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

  destroy(): void {
    this.stopOrbit();
    this.resizeObserver.disconnect();
    this.map.remove();
  }

  private applyState(): void {
    // Trocar o estilo (ex.: tema) remove fontes e camadas; os datasets voltam aqui.
    for (const dataset of this.datasets) {
      dataset.attach();
      dataset.setFilter(dataset.getFilter());
    }
    for (const layer of this.catalog.values()) this.attachCatalog(layer);
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
  }
}
