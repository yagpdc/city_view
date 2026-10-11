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
    this.map.on("style.load", () => this.applyState());

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
    // O estilo pode já ter disparado "style.load" mas ainda estar carregando sprites/fontes;
    // tenta a cada atualização de estilo até conseguir.
    const tryAttach = () => {
      if (!this.map.isStyleLoaded()) return;
      this.map.off("styledata", tryAttach);
      layer.attach();
    };
    this.map.on("styledata", tryAttach);
    tryAttach();
    return layer;
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
      const layers = this.datasets.flatMap((d) => d.layerIds).filter((id) => this.map.getLayer(id));
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
    this.map.setStyle(buildStyle(this.styleOptions));
  }

  setTerrain(enabled: boolean, exaggeration = this.terrainExaggeration): void {
    this.terrainEnabled = enabled;
    this.terrainExaggeration = exaggeration;
    if (this.map.isStyleLoaded()) this.applyState();
  }

  setBuildings3D(enabled: boolean): void {
    this.buildingsEnabled = enabled;
    if (this.map.isStyleLoaded()) this.applyState();
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
