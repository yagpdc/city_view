/**
 * Abas de mapa, como as do navegador: cada aba é uma visão independente (camadas no projeto, filtros,
 * câmera, prédios acesos, tema e estilo do mapa base). O motor, a biblioteca e os dados (públicos e importados) são os mesmos para
 * todas; uma aba nova só começa sem nada ligado. Tudo fica neste navegador (localStorage).
 */
import type { BasemapLook, Camera, DataStyle, DatasetFilter, Theme } from "@cityview/engine";

export interface MapTab {
  id: string;
  title: string;
  /** Camadas visíveis. */
  active: string[];
  /** Camadas no projeto com o olho fechado. */
  hidden: string[];
  /** Filtro por camada (id no mapa). */
  filters: Record<string, DatasetFilter>;
  camera?: Camera;
  /** Camada que acende os prédios (id no mapa). */
  paintDataset?: string | null;
  /** Estilo salvo de cada camada (id no mapa), pelo editor de estilo. */
  styles?: Record<string, DataStyle>;
  /** Versão anterior (só a vista "Regiões"): vira `styles` ao abrir. */
  regionViews?: string[];
  /** Aparência do mapa base (abas salvas antes disso: claro, "Para dados"). */
  theme?: Theme;
  look?: BasemapLook;
}

export interface TabsState {
  tabs: MapTab[];
  current: string;
}

const TABS_KEY = "cityview.map-tabs";

const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** "Mapa N" com o menor N que ainda não existe. */
export function nextTitle(tabs: MapTab[]): string {
  const used = new Set(tabs.map((t) => t.title));
  let n = 1;
  while (used.has(`Mapa ${n}`)) n++;
  return `Mapa ${n}`;
}

export function createTab(tabs: MapTab[], init: Partial<Omit<MapTab, "id">> = {}): MapTab {
  return { id: newId(), title: nextTitle(tabs), active: [], hidden: [], filters: {}, ...init };
}

/**
 * Abas salvas. Na primeira vez, `legacy` monta a aba 1 com o que o app guardava antes das abas
 * (camadas ligadas, escondidas e filtros).
 */
export function loadTabs(legacy: () => Omit<MapTab, "id" | "title">): TabsState {
  try {
    const saved = JSON.parse(localStorage.getItem(TABS_KEY) ?? "null") as TabsState | null;
    if (saved?.tabs?.length) {
      const current = saved.tabs.some((t) => t.id === saved.current) ? saved.current : saved.tabs[0]!.id;
      return { tabs: saved.tabs, current };
    }
  } catch {
    // Salvo corrompido ou bloqueado: recomeça.
  }
  const first = createTab([], legacy());
  return { tabs: [first], current: first.id };
}

export function saveTabs(state: TabsState): void {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(state));
  } catch {
    // Modo privado: segue sem lembrar.
  }
}
