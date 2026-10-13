import type { ColumnProfile, ImportMapping, JoinStats, RecipeStep } from "@cityview/importer";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BuildSummary, Delimiter, Encoding, OpenOptions, OpenedFile, SourceInfo, WorkerRequest, WorkerResponse } from "./protocol";
import type { TileReport } from "./tiles";

/** Um worker por wizard: guarda as linhas do arquivo e responde a "open" e "build". */
export function useImportWorker() {
  const workerRef = useRef<Worker | null>(null);
  /** Pedidos em andamento, por número: o builder pede perfil enquanto a receita ainda está sendo aplicada. */
  const pending = useRef(new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>());
  const nextId = useRef(1);
  const [progress, setProgress] = useState<number | null>(null);
  /** Andamento do motor de tiles (WASM). */
  const [tiling, setTiling] = useState<{ stage: string; fraction: number } | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL("./import.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<WorkerResponse & { id?: number }>) => {
      const msg = e.data;
      if (msg.type === "progress") return setProgress(msg.total ? msg.loaded / msg.total : null);
      if (msg.type === "tiling") return setTiling({ stage: msg.stage, fraction: msg.fraction });
      const p = msg.id !== undefined ? pending.current.get(msg.id) : undefined;
      if (msg.id !== undefined) pending.current.delete(msg.id);
      setProgress(null);
      if (!p) return;
      if (msg.type === "error") p.reject(new Error(msg.message));
      else if (msg.type === "opened") p.resolve(msg.file as never);
      else if (msg.type === "built") p.resolve(msg.summary as never);
      else if (msg.type === "exported") p.resolve(msg.blob as never);
      else if (msg.type === "tiled") p.resolve({ blob: msg.blob, report: msg.report } as never);
      else if (msg.type === "profiled") p.resolve(msg.profile as never);
      else if (msg.type === "failedRows") p.resolve({ blob: msg.blob, count: msg.count } as never);
      else if (msg.type === "source") p.resolve(msg.source as never);
      else if (msg.type === "joinStats") p.resolve(msg.stats as never);
    };
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  const request = useCallback(<T,>(msg: WorkerRequest) => {
    return new Promise<T>((resolve, reject) => {
      const id = nextId.current++;
      pending.current.set(id, { resolve: resolve as (v: never) => void, reject });
      workerRef.current!.postMessage({ ...msg, id });
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

  /** Troca a receita do builder; devolve a nova vista (colunas, prévia, tipos). */
  const setRecipe = useCallback((steps: RecipeStep[]) => request<OpenedFile>({ type: "recipe", steps }), [request]);
  /** Perfil de uma coluna (depois da receita), com problemas e correções sugeridas. */
  const profile = useCallback((column: string) => request<ColumnProfile>({ type: "profile", column }), [request]);
  /** CSV das linhas que ficam de fora, com o motivo. */
  const failedRows = useCallback(() => request<{ blob: Blob; count: number }>({ type: "failed" }), [request]);

  /** PMTiles gerado no navegador (motor em Rust/WASM) com hexágonos e pontos. */
  const tiles = useCallback(
    async (options: { name: string; colorBy?: string; title?: string; regions?: import("./tiles").RegionSource[]; file?: { file: File; delimiter: Delimiter; encoding: Encoding } }) => {
      setTiling({ stage: options.file ? "reading" : "indexing", fraction: 0 });
      const { file, ...rest } = options;
      try {
        return await request<{ blob: Blob; report: TileReport }>(file ? { type: "tilesFile", ...rest, ...file } : { type: "tiles", ...rest });
      } finally {
        setTiling(null);
      }
    },
    [request],
  );

  /** Outra planilha para juntar ou acrescentar. */
  const addSource = useCallback((file: File, id?: string) => {
    setProgress(0);
    return request<SourceInfo>({ type: "addSource", file, ...(id ? { sourceId: id } : {}) });
  }, [request]);
  const joinStats = useCallback(
    (source: string, key: string, otherKey: string) => request<JoinStats>({ type: "joinStats", source, key, otherKey }),
    [request],
  );

  return { open, build, exportBlob, tiles, setRecipe, profile, failedRows, addSource, joinStats, progress, tiling };
}
