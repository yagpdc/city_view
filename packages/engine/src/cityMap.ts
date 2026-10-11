/// <reference path="./env.d.ts" />
import {
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
import { DatasetLayer, readDatasetMeta, type DatasetPick } from "./dataset";
import { BUILDINGS_3D_LAYER, TERRAIN_SOURCE, buildStyle, type StyleOptions, type Theme } from "./style";

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
    const layer = new DatasetLayer(this.map, id, url, meta);
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

  setDatasetVisible(id: string, visible: boolean): void {
    this.datasets.find((d) => d.id === id)?.setVisible(visible);
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
  }
}
