/** Cliente do servidor local (services/api). Em dev, o Vite repassa /api para 127.0.0.1:8787. */

export type ServerStatus = "queued" | "processing" | "ready" | "error";

export interface ImportSpec {
  name: string;
  lat: string;
  lon: string;
  latLocale?: "br" | "intl";
  lonLocale?: "br" | "intl";
  columns: { name: string; type: "number" | "category" | "date" | "text"; locale?: "br" | "intl" }[];
  colorBy?: string;
  title?: string;
  delimiter?: string;
  encoding?: string;
}

export interface ServerReport {
  records: number;
  stats: {
    rows: number;
    invalid: number;
    semCoordenadas: number;
    coordenadaInvalida: number;
    foraDoMundo: number;
    outsideBrazil: number;
  };
  bounds: [number, number, number, number];
  categories: string[];
  tilesBytes: number;
}

export interface ServerDataset {
  id: string;
  name: string;
  fileName: string;
  fileBytes: number;
  createdAt: number;
  status: ServerStatus;
  stage: "reading" | "indexing" | "tiling" | "writing" | null;
  progress: number;
  error: string | null;
  spec: ImportSpec;
  report: ServerReport | null;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `erro ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const serverApi = {
  async health(): Promise<boolean> {
    try {
      const res = await fetch("/api/health", { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  },

  list: () => fetch("/api/datasets").then((r) => json<ServerDataset[]>(r)),

  rename: (id: string, name: string) =>
    fetch(`/api/datasets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((r) => json<ServerDataset>(r)),

  async remove(id: string): Promise<void> {
    const res = await fetch(`/api/datasets/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) await json(res);
  },

  /** Envia o arquivo inteiro com o mapeamento. XHR para ter o progresso do envio. */
  upload(file: File, spec: ImportSpec, onProgress: (fraction: number) => void): Promise<ServerDataset> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append("spec", JSON.stringify(spec));
      form.append("file", file, file.name);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/datasets");
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText) as ServerDataset & { error?: string };
          if (xhr.status >= 200 && xhr.status < 300) resolve(body);
          else reject(new Error(body.error ?? `erro ${xhr.status}`));
        } catch {
          reject(new Error(`resposta inválida do servidor (${xhr.status})`));
        }
      };
      xhr.onerror = () => reject(new Error("não foi possível falar com o servidor local"));
      xhr.send(form);
    });
  },

  tilesUrl: (id: string) => `${location.origin}/api/datasets/${id}/tiles.pmtiles`,
  rowUrl: (id: string) => `/api/datasets/${id}/rows/{rowId}`,
};
