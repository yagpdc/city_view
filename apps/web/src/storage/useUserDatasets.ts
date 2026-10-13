import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteDataset,
  listDatasets,
  saveDataset,
  storageUsage,
  updateManifest,
  type StorageUsage,
  type StoredDataset,
} from "./datasets";

export interface UserDataset extends StoredDataset {
  /** URL blob: do GeoJSON, válida enquanto a página estiver aberta. */
  dataUrl: string;
  /** Gravado no IndexedDB? `false` enquanto grava ou se a gravação falhou. */
  saved: boolean;
}

const withUrl = (d: StoredDataset, saved: boolean): UserDataset => ({ ...d, dataUrl: URL.createObjectURL(d.data), saved });

/** Datasets importados pelo usuário: carregados do navegador ao abrir e salvos ao importar. */
export function useUserDatasets() {
  const [datasets, setDatasets] = useState<UserDataset[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const urls = useRef(new Set<string>());

  const track = (d: UserDataset) => {
    urls.current.add(d.dataUrl);
    return d;
  };

  const refreshUsage = useCallback(() => void storageUsage().then(setUsage), []);

  useEffect(() => {
    let cancelled = false;
    listDatasets()
      .then((stored) => {
        if (!cancelled) setDatasets(stored.map((d) => track(withUrl(d, true))));
      })
      .catch((e: Error) => !cancelled && setError(`Não foi possível ler os dados salvos: ${e.message}`))
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    refreshUsage();
    const owned = urls.current;
    return () => {
      cancelled = true;
      owned.forEach((u) => URL.revokeObjectURL(u));
      owned.clear();
    };
  }, [refreshUsage]);

  const add = useCallback(
    async (stored: StoredDataset) => {
      const dataset = track(withUrl(stored, false));
      // Mesmo id = substituição (editar / atualizar): fica no mesmo lugar da lista.
      setDatasets((list) => {
        const old = list.find((d) => d.id === stored.id);
        if (!old) return [...list, dataset];
        URL.revokeObjectURL(old.dataUrl);
        urls.current.delete(old.dataUrl);
        return list.map((d) => (d.id === stored.id ? dataset : d));
      });
      try {
        await saveDataset(stored);
        setDatasets((list) => list.map((d) => (d.id === stored.id ? { ...d, saved: true } : d)));
      } catch (e) {
        // Sem espaço para o arquivo original: guarda a camada sem ele (para editar, pedimos o arquivo de novo).
        if (stored.source?.file) {
          try {
            const { file: _, ...source } = stored.source;
            await saveDataset({ ...stored, source });
            setDatasets((list) => list.map((d) => (d.id === stored.id ? { ...d, source, saved: true } : d)));
            setError(`"${stored.manifest.name}" foi salvo sem o arquivo original (falta espaço neste navegador). Para editar, escolha o arquivo de novo.`);
            refreshUsage();
            return dataset;
          } catch {
            // cai no erro abaixo
          }
        }
        setError(`"${stored.manifest.name}" está no mapa, mas não foi salvo neste navegador: ${(e as Error).message}`);
      }
      refreshUsage();
      return dataset;
    },
    [refreshUsage],
  );

  const remove = useCallback(
    async (id: string) => {
      setDatasets((list) => {
        const target = list.find((d) => d.id === id);
        if (target) {
          URL.revokeObjectURL(target.dataUrl);
          urls.current.delete(target.dataUrl);
        }
        return list.filter((d) => d.id !== id);
      });
      try {
        await deleteDataset(id);
      } catch (e) {
        setError(`Não foi possível apagar o dado salvo: ${(e as Error).message}`);
      }
      refreshUsage();
    },
    [refreshUsage],
  );

  const rename = useCallback(async (id: string, name: string) => {
    setDatasets((list) => list.map((d) => (d.id === id ? { ...d, manifest: { ...d.manifest, name } } : d)));
    await updateManifest(id, (m) => ({ ...m, name })).catch((e: Error) =>
      setError(`O nome mudou no mapa, mas não foi salvo: ${e.message}`),
    );
  }, []);

  return { datasets, loaded, error, clearError: () => setError(null), usage, add, remove, rename };
}
