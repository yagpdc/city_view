/**
 * @pinny/sdk — o mapa do Pinny para embutir no seu produto.
 *
 * ```ts
 * import Pinny from "@pinny/sdk";
 * const map = Pinny.map({ container: "#mapa", dataset: "https://.../empresas.pmtiles" });
 * map.on("click", (item) => console.log(item));
 * ```
 */
import { PinnyMap, categoryColor, type DatasetFilter, type DatasetLayer, type DatasetPick } from "@pinny/engine";

export type Theme = "light" | "dark";

export interface MapOptions {
  /** Elemento (ou seletor CSS) onde o mapa será desenhado. Ele deve ter altura definida. */
  container: HTMLElement | string;
  /** URL do dataset processado pelo Pinny. */
  dataset: string;
  /** URL do mapa base. Padrão: mapa base servido junto (provisório até termos CDN). */
  basemap?: string;
  theme?: Theme;
  /** Posição inicial [lon, lat]. Padrão: Brasil inteiro. */
  center?: [number, number];
  zoom?: number;
}

/** Filtro de dados. Campos ausentes não filtram. */
export type Filter = DatasetFilter;

/** O que está sob o clique: um registro individual (zoom alto) ou um agregado (hexágono). */
export type Item = DatasetPick;

export interface DatasetInfo {
  records: number;
  /** Rótulos das categorias de cor (valores da coluna de cor, mais frequentes primeiro). */
  categories: string[];
  /** Cor de cada categoria, no mesmo índice. */
  categoryColors: string[];
  /** Coluna usada para colorir. */
  colorBy: string | null;
}

type Events = {
  /** Dataset carregado e primeira renderização concluída. */
  ready: () => void;
  /** Clique no mapa; `null` quando não há dado sob o cursor. */
  click: (item: Item | null) => void;
  /** Mapa terminou de renderizar (após mover, filtrar etc.). */
  idle: () => void;
};

export interface PinnyMapHandle {
  /** Resolve quando o dataset está carregado e desenhado pela primeira vez. */
  readonly ready: Promise<DatasetInfo>;
  /** Aplica um filtro. Resolve quando o mapa terminou de redesenhar. */
  filter(filter: Filter): Promise<void>;
  on<E extends keyof Events>(event: E, handler: Events[E]): () => void;
  flyTo(target: { center?: [number, number]; zoom?: number }): void;
  setTheme(theme: Theme): void;
  destroy(): void;
}

const DEFAULT_BASEMAP = "/data/brasil.pmtiles";
const BRAZIL: { center: [number, number]; zoom: number } = { center: [-52, -14.5], zoom: 3.6 };

function resolveContainer(container: HTMLElement | string): HTMLElement {
  if (typeof container !== "string") return container;
  const el = document.querySelector<HTMLElement>(container);
  if (!el) throw new Error(`Pinny: container não encontrado: ${container}`);
  return el;
}

const absolute = (url: string) => new URL(url, location.href).href;

export function map(options: MapOptions): PinnyMapHandle {
  const engine = new PinnyMap({
    container: resolveContainer(options.container),
    basemapUrl: absolute(options.basemap ?? DEFAULT_BASEMAP),
    theme: options.theme ?? "light",
    camera: {
      center: options.center ?? BRAZIL.center,
      zoom: options.zoom ?? BRAZIL.zoom,
      pitch: 0,
      bearing: 0,
    },
    terrain: false,
  });
  engine.enableHoverCursor();

  let dataset: DatasetLayer | null = null;

  const readyListeners = new Set<() => void>();
  const ready = engine.addDataset("data", absolute(options.dataset)).then(async (layer) => {
    dataset = layer;
    await engine.whenIdle();
    readyListeners.forEach((fn) => fn());
    const { records, categories, colorBy } = layer.meta;
    return { records, categories, categoryColors: categories.map((_, i) => categoryColor(i, categories)), colorBy: colorBy ?? null };
  });

  return {
    ready,
    async filter(filter) {
      await ready;
      dataset!.setFilter(filter);
      await engine.whenIdle();
    },
    on(event, handler) {
      switch (event) {
        case "ready":
          readyListeners.add(handler as Events["ready"]);
          return () => readyListeners.delete(handler as Events["ready"]);
        case "click":
          return engine.onPick(handler as Events["click"]);
        case "idle":
          return engine.on("idle", handler as Events["idle"]);
        default:
          throw new Error(`Pinny: evento desconhecido: ${String(event)}`);
      }
    },
    flyTo(target) {
      engine.flyTo(target);
    },
    setTheme(theme) {
      engine.setTheme(theme);
    },
    destroy() {
      engine.destroy();
    },
  };
}

const Pinny = { map };
export default Pinny;
