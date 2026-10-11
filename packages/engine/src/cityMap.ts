import { Map as MapLibreMap, NavigationControl, ScaleControl, addProtocol, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { Protocol } from "pmtiles";
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
}

export type CityMapEvent = "load" | "move";

let initialized = false;

function initMapLibre(): void {
  if (initialized) return;
  // O worker é carregado de arquivo próprio; o bundler precisa emitir e nos dar a URL.
  setWorkerUrl(workerUrl);
  addProtocol("pmtiles", new Protocol().tile);
  initialized = true;
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

  constructor({ container, camera, terrainExaggeration = 1.5, ...styleOptions }: CityMapOptions) {
    initMapLibre();
    this.styleOptions = styleOptions;
    this.terrainExaggeration = terrainExaggeration;

    this.map = new MapLibreMap({
      container,
      style: buildStyle(styleOptions),
      center: camera?.center ?? [-46.6333, -23.5505],
      zoom: camera?.zoom ?? 12,
      pitch: camera?.pitch ?? 0,
      bearing: camera?.bearing ?? 0,
      maxPitch: 85,
      hash: true,
    });

    this.map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    this.map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    this.map.on("style.load", () => this.applyState());
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
    this.map.remove();
  }

  private applyState(): void {
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
