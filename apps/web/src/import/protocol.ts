import type { ColumnInfo, ImportMapping, ImportSummary, LocationGuess, Row } from "@cityview/importer";

/** Limite do processamento no navegador; acima disso o arquivo precisa do motor local (Rust). */
export const MAX_BROWSER_ROWS = 2_000_000;

export type Delimiter = "," | ";" | "\t" | "|";
export type Encoding = "utf-8" | "windows-1252";

export interface OpenOptions {
  delimiter?: Delimiter;
  encoding?: Encoding;
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
