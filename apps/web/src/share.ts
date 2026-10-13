/**
 * Links compartilháveis: o estado vai no hash, ao lado da câmera do MapLibre (`#map=z/lat/lon…`).
 * Nada passa por servidor; camadas da biblioteca vão como "receita" e são buscadas de novo na fonte.
 */
import type { BasemapLook, DatasetFilter, Theme } from "@cityview/engine";
import type { ItemChoice } from "./library/types";

/** Como refazer uma camada da biblioteca: fonte, item, escolhas e a variável. */
export interface LibraryRecipe {
  s: string;
  i: string;
  v: string;
  c: ItemChoice;
}

export interface SharedState {
  layers?: string[];
  lib?: LibraryRecipe[];
  theme?: Theme;
  look?: BasemapLook;
  /** Filtros das camadas (id no mapa → categorias e condições por coluna). */
  f?: Record<string, DatasetFilter>;
  /** Nome da aba de mapa (abre com esse título). */
  n?: string;
  /** Maquete aberta: centro [lon, lat], raio (m) e título. */
  maquete?: { c: [number, number]; r: number; t?: string };
}

/** Parâmetro do hash usado pela câmera (MapLibre `hash: "map"`). */
export const CAMERA_PARAM = "map";

function encode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode<T>(text: string): T {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))) as T;
}

const hashParams = () => new URLSearchParams(location.hash.slice(1));

/** Estado vindo de um link compartilhado (ou null se o link só tem a câmera). */
export function readShared(): SharedState | null {
  const p = hashParams();
  if (!p.has("s")) return null;
  try {
    return decode<SharedState>(p.get("s")!);
  } catch {
    console.warn("[share] link com estado inválido; ignorando");
    return null;
  }
}

/** Depois de aplicado, o estado sai do hash (a câmera continua sendo atualizada pelo mapa). */
export function clearShared(): void {
  const p = hashParams();
  if (!p.has("s")) return;
  p.delete("s");
  history.replaceState(null, "", `${location.pathname}${location.search}#${decodeURIComponent(p.toString())}`);
}

export function shareUrl(state: SharedState): string {
  const p = hashParams();
  const camera = p.get(CAMERA_PARAM);
  const hash = `${camera ? `${CAMERA_PARAM}=${camera}&` : ""}s=${encode(state)}`;
  return `${location.origin}${location.pathname}#${hash}`;
}
