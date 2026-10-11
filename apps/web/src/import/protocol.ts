import type { ColumnInfo, ImportMapping, ImportSummary, LocationGuess, Row } from "@cityview/importer";

/** Limite do processamento no navegador; acima disso o arquivo precisa do motor local (Rust). */
export const MAX_BROWSER_ROWS = 2_000_000;

export type Delimiter = "," | ";" | "\t" | "|";
export type Encoding = "utf-8" | "windows-1252";

/** Acima disso, com o servidor local de pé, o arquivo vai para o motor em Rust. */
export const SERVER_THRESHOLD_BYTES = 20e6;
/** Linhas lidas no navegador quando o processamento é no servidor (só para detectar colunas). */
export const SAMPLE_ROWS = 5000;

export interface OpenOptions {
  delimiter?: Delimiter;
  encoding?: Encoding;
  /** Lê só as primeiras N linhas (modo servidor). */
  previewRows?: number;
}

export interface OpenedFile {
  headers: string[];
  preview: Row[];
  rowCount: number;
  delimiter: Delimiter;
  encoding: Encoding;
  columns: ColumnInfo[];
  location: LocationGuess | null;
  style: { colorBy?: string; title?: string };
  /** `true` quando só uma amostra foi lida. */
  sampled: boolean;
}

/**
 * Resultado da validação. As feições não trafegam aqui: só são montadas no "export",
 * dentro do worker, e saem como Blob (copiar meio milhão de objetos custa segundos).
 */
export type BuildSummary = ImportSummary;

export type WorkerRequest =
  | { type: "open"; file: File; options: OpenOptions }
  | { type: "build"; mapping: ImportMapping; colorBy?: string }
  | { type: "export" };

export type WorkerResponse =
  | { type: "progress"; loaded: number; total: number }
  | { type: "opened"; file: OpenedFile }
  | { type: "built"; summary: BuildSummary }
  | { type: "exported"; blob: Blob }
  | { type: "error"; message: string };
