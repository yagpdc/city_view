import { useCallback, useEffect, useRef, useState } from "react";
import { serverApi, type ImportSpec, type ServerDataset } from "./api";

export interface PendingUpload {
  key: string;
  name: string;
  fraction: number;
}

const POLL_MS = 1000;
const HEALTH_MS = 10_000;

/** Datasets processados pelo servidor local: disponibilidade, lista, envio e andamento. */
export function useServerDatasets() {
  const [available, setAvailable] = useState(false);
  const [datasets, setDatasets] = useState<ServerDataset[]>([]);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const busy = datasets.some((d) => d.status === "queued" || d.status === "processing");
  const availableRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setDatasets(await serverApi.list());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // Descobre se o servidor está de pé (e volta a checar de tempos em tempos).
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const ok = await serverApi.health();
      if (cancelled) return;
      if (ok && !availableRef.current) void refresh();
      availableRef.current = ok;
      setAvailable(ok);
    };
    void check();
    const timer = window.setInterval(check, HEALTH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refresh]);

  // Enquanto houver processamento, acompanha o progresso.
  useEffect(() => {
    if (!available || !busy) return;
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [available, busy, refresh]);

  const upload = useCallback(
    async (file: File, spec: ImportSpec) => {
      const key = `${file.name}-${Date.now()}`;
      setUploads((u) => [...u, { key, name: spec.name, fraction: 0 }]);
      try {
        const created = await serverApi.upload(file, spec, (fraction) =>
          setUploads((u) => u.map((x) => (x.key === key ? { ...x, fraction } : x))),
        );
        setDatasets((list) => [...list.filter((d) => d.id !== created.id), created]);
        return created;
      } catch (e) {
        setError(`Falha ao enviar "${spec.name}": ${(e as Error).message}`);
        return null;
      } finally {
        setUploads((u) => u.filter((x) => x.key !== key));
      }
    },
    [],
  );

  const remove = useCallback(async (id: string) => {
    try {
      await serverApi.remove(id);
      setDatasets((list) => list.filter((d) => d.id !== id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const rename = useCallback(async (id: string, name: string) => {
    try {
      const updated = await serverApi.rename(id, name);
      setDatasets((list) => list.map((d) => (d.id === id ? updated : d)));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  return { available, datasets, uploads, error, clearError: () => setError(null), upload, remove, rename };
}
