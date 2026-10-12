import type { DatapackManifest } from "@cityview/engine";

/**
 * Datasets importados, salvos no IndexedDB deste navegador (local-first, custo zero).
 * Quando houver servidor local, isto vira cache e o servidor passa a ser a fonte da verdade.
 */
export interface StoredDataset {
  id: string;
  manifest: DatapackManifest;
  /** GeoJSON (FeatureCollection) gerado pelo wizard. */
  data: Blob;
  count: number;
  bounds: [number, number, number, number];
  fileName: string;
  createdAt: number;
}

const DB_NAME = "cityview";
const DB_VERSION = 2;
const STORE = "datasets";
const LIBRARY_STORE = "library-layers";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(LIBRARY_STORE)) db.createObjectStore(LIBRARY_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("Não foi possível abrir o armazenamento local."));
    };
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>, storeName = STORE): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const req = fn(tx.objectStore(storeName));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? req.error);
        tx.onabort = () => reject(tx.error ?? new Error("Gravação cancelada (espaço insuficiente?)."));
      }),
  );
}

export async function listDatasets(): Promise<StoredDataset[]> {
  const all = await run<StoredDataset[]>("readonly", (s) => s.getAll() as IDBRequest<StoredDataset[]>);
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveDataset(dataset: StoredDataset): Promise<void> {
  await run("readwrite", (s) => s.put(dataset));
  // Pede ao navegador para não apagar estes dados quando faltar espaço.
  void navigator.storage?.persist?.();
}

export async function updateManifest(id: string, update: (m: DatapackManifest) => DatapackManifest): Promise<void> {
  const current = await run<StoredDataset | undefined>("readonly", (s) => s.get(id) as IDBRequest<StoredDataset | undefined>);
  if (current) await run("readwrite", (s) => s.put({ ...current, manifest: update(current.manifest) }));
}

export async function deleteDataset(id: string): Promise<void> {
  await run("readwrite", (s) => s.delete(id));
}

// ---------- Camadas da biblioteca ----------

/** Só o necessário para remontar a camada: valores por município (a geometria vem da malha). */
export interface SavedLibraryLayer {
  id: string;
  savedAt: number;
  source: import("../library/types").LibrarySourceMeta;
  item: { id: string; title: string; url: string | null; group: string; subject: string };
  title: string;
  period: string;
  variable: { id: string; name: string; unit: string };
  values: [string, number][];
}

export const listLibraryLayers = () =>
  run<SavedLibraryLayer[]>("readonly", (s) => s.getAll() as IDBRequest<SavedLibraryLayer[]>, LIBRARY_STORE).then((all) =>
    all.sort((a, b) => a.savedAt - b.savedAt),
  );

export async function saveLibraryLayer(layer: SavedLibraryLayer): Promise<void> {
  await run("readwrite", (s) => s.put(layer), LIBRARY_STORE);
  void navigator.storage?.persist?.();
}

export async function deleteLibraryLayer(id: string): Promise<void> {
  await run("readwrite", (s) => s.delete(id), LIBRARY_STORE);
}

export interface StorageUsage {
  usedBytes: number;
  quotaBytes: number;
  persisted: boolean;
}

export async function storageUsage(): Promise<StorageUsage | null> {
  if (!navigator.storage?.estimate) return null;
  const [estimate, persisted] = await Promise.all([
    navigator.storage.estimate(),
    navigator.storage.persisted?.() ?? Promise.resolve(false),
  ]);
  return { usedBytes: estimate.usage ?? 0, quotaBytes: estimate.quota ?? 0, persisted };
}

// ---------- Camadas ligadas (preferência leve, por navegador) ----------

const ACTIVE_KEY = "cityview.active-layers";

export function loadActiveLayers(): Set<string> {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function saveActiveLayers(active: Set<string>): void {
  try {
    localStorage.setItem(ACTIVE_KEY, JSON.stringify([...active]));
  } catch {
    // Modo privado ou armazenamento bloqueado: segue sem lembrar.
  }
}
