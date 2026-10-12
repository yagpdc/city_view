import type { ImportMapping } from "@cityview/importer";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BuildSummary, OpenOptions, OpenedFile, WorkerRequest, WorkerResponse } from "./protocol";
import type { TileReport } from "./tiles";

/** Um worker por wizard: guarda as linhas do arquivo e responde a "open" e "build". */
export function useImportWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pending = useRef<{ resolve: (v: never) => void; reject: (e: Error) => void } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  /** Andamento do motor de tiles (WASM). */
  const [tiling, setTiling] = useState<{ stage: string; fraction: number } | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL("./import.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === "progress") return setProgress(msg.total ? msg.loaded / msg.total : null);
      if (msg.type === "tiling") return setTiling({ stage: msg.stage, fraction: msg.fraction });
      const p = pending.current;
      pending.current = null;
      setProgress(null);
      if (!p) return;
      if (msg.type === "error") p.reject(new Error(msg.message));
      else if (msg.type === "opened") p.resolve(msg.file as never);
      else if (msg.type === "built") p.resolve(msg.summary as never);
      else if (msg.type === "exported") p.resolve(msg.blob as never);
      else if (msg.type === "tiled") p.resolve({ blob: msg.blob, report: msg.report } as never);
    };
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  const request = useCallback(<T,>(msg: WorkerRequest) => {
    return new Promise<T>((resolve, reject) => {
      pending.current = { resolve: resolve as (v: never) => void, reject };
      workerRef.current!.postMessage(msg);
    });
  }, []);

  const open = useCallback((file: File, options: OpenOptions = {}) => {
    setProgress(0);
    return request<OpenedFile>({ type: "open", file, options });
  }, [request]);

  const build = useCallback(
    (mapping: ImportMapping, colorBy?: string) => request<BuildSummary>({ type: "build", mapping, colorBy }),
    [request],
  );

  /** Feições validadas como GeoJSON num Blob (lido direto pelo worker do MapLibre). */
  const exportBlob = useCallback(() => request<Blob>({ type: "export" }), [request]);

  /** PMTiles gerado no navegador (motor em Rust/WASM) com hexágonos e pontos. */
  const tiles = useCallback(
    async (options: { name: string; colorBy?: string; title?: string }) => {
      setTiling({ stage: "indexing", fraction: 0 });
      try {
        return await request<{ blob: Blob; report: TileReport }>({ type: "tiles", ...options });
      } finally {
        setTiling(null);
      }
    },
    [request],
  );

  return { open, build, exportBlob, tiles, progress, tiling };
}
