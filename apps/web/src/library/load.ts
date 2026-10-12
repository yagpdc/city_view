import indexJson from "../../../../datapacks/library/index.json";
import type { LibrarySourceIndex, LibrarySourceSummary } from "./types";

export const LIBRARY_SOURCES = (indexJson as { sources: LibrarySourceSummary[] }).sources;
export const LIBRARY_TOTAL = LIBRARY_SOURCES.reduce((sum, s) => sum + s.items, 0);

/** Índices das fontes: carregados sob demanda (o do SIDRA tem ~2 MB). */
const files = import.meta.glob<LibrarySourceIndex>(["../../../../datapacks/library/*.json", "!**/index.json"], {
  import: "default",
});

const cache = new Map<string, Promise<LibrarySourceIndex>>();

export function loadSource(id: string): Promise<LibrarySourceIndex> {
  let pending = cache.get(id);
  if (!pending) {
    const loader = Object.entries(files).find(([path]) => path.endsWith(`/${id}.json`))?.[1];
    if (!loader) return Promise.reject(new Error(`fonte sem índice: ${id}`));
    pending = loader();
    cache.set(id, pending);
  }
  return pending;
}

export const loadAllSources = () => Promise.all(LIBRARY_SOURCES.map((s) => loadSource(s.id)));
