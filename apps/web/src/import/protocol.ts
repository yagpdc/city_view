import type { ColumnInfo, ColumnProfile, ImportMapping, ImportSummary, JoinStats, JunkFinding, LocationGuess, RecipeStep, Row } from "@cityview/importer";

/** Limite do processamento no navegador; acima disso o arquivo precisa do motor local (Rust). */
export const MAX_BROWSER_ROWS = 2_000_000;
/** Acima disso o assistente lê uma amostra e a importação relê o arquivo em colunas (sem limite de linhas). */
export const LARGE_FILE_BYTES = 20e6;

export type Delimiter = "," | ";" | "\t" | "|";

/** Formatos aceitos no assistente. Excel e GeoJSON viram as mesmas linhas de texto do CSV. */
export type FileFormat = "csv" | "excel" | "geojson" | "parquet";

export const ACCEPTED_EXTENSIONS = ".csv,.tsv,.txt,.xlsx,.geojson,.json,.parquet";

/** O motor em Rust (servidor local) lê CSV e Parquet. */
export const SERVER_FORMATS: FileFormat[] = ["csv", "parquet"];

export function fileFormat(name: string): FileFormat | null {
  if (/\.(csv|tsv|txt)$/i.test(name)) return "csv";
  if (/\.xlsx$/i.test(name)) return "excel";
  if (/\.(geo)?json$/i.test(name)) return "geojson";
  if (/\.parquet$/i.test(name)) return "parquet";
  return null;
}
export type Encoding = "utf-8" | "windows-1252" | "utf-16le" | "utf-16be";

/** Acima disso, com o servidor local de pé, o arquivo vai para o motor em Rust. */
export const SERVER_THRESHOLD_BYTES = 20e6;
/** Linhas lidas no navegador quando o processamento é no servidor (só para detectar colunas). */
export const SAMPLE_ROWS = 5000;

export interface OpenOptions {
  delimiter?: Delimiter;
  encoding?: Encoding;
  /** Lê só as primeiras N linhas (modo servidor). */
  previewRows?: number;
  /** Aba do Excel (padrão: a primeira com dados). */
  sheet?: string;
}

export interface OpenedFile {
  format: FileFormat;
  /** Aviso sobre a conversão (ex.: polígonos que viraram ponto). */
  note?: string;
  headers: string[];
  preview: Row[];
  rowCount: number;
  delimiter: Delimiter;
  encoding: Encoding;
  columns: ColumnInfo[];
  location: (LocationGuess & { latlon?: string }) | null;
  style: { colorBy?: string; title?: string };
  /** `true` quando só uma amostra foi lida. */
  sampled: boolean;
  /** Linha do cabeçalho no arquivo (0 = primeira). */
  headerRow: number;
  /** Linhas que não são registro (total, cabeçalho repetido, rodapé), com o passo que as remove. */
  junk: JunkFinding[];
  /** Abas do Excel (só quando há mais de uma) e a aberta. */
  sheets?: string[];
  sheet?: string;
  /** Colunas como vieram do arquivo (antes da receita): o "acrescentar linhas" alinha com elas. */
  originalHeaders: string[];
}

/** Outra planilha carregada para juntar ou acrescentar (fica só na memória do worker). */
export interface SourceInfo {
  id: string;
  name: string;
  headers: string[];
  rowCount: number;
  preview: Row[];
  /** Coluna desta que mais casa com uma da outra (pelos valores). */
  join: { key: string; otherKey: string; score: number } | null;
  /** Coluna da outra → coluna desta, pelo nome. */
  appendMap: Record<string, string>;
}

/**
 * Resultado da validação. As feições não trafegam aqui: só são montadas no "export",
 * dentro do worker, e saem como Blob (copiar meio milhão de objetos custa segundos).
 */
export type BuildSummary = ImportSummary;

export type WorkerRequest =
  | { type: "open"; file: File; options: OpenOptions }
  | { type: "build"; mapping: ImportMapping; colorBy?: string }
  | { type: "export" }
  /** Troca a receita do builder; responde "opened" com a nova vista. */
  | { type: "recipe"; steps: RecipeStep[] }
  | { type: "profile"; column: string }
  /** Carrega outra planilha (para juntar ou acrescentar). */
  | { type: "addSource"; file: File; options?: OpenOptions; sourceId?: string }
  /** Quantas linhas desta acham par na outra, casando key com otherKey. */
  | { type: "joinStats"; source: string; key: string; otherKey: string }
  /** CSV das linhas que ficam de fora, com o motivo. */
  | { type: "failed" }
  /** Gera o PMTiles no navegador (motor em WASM) com o último mapeamento validado. */
  | { type: "tiles"; name: string; colorBy?: string; title?: string }
  /** Arquivo grande (aberto por amostra): relê inteiro em colunas e gera o PMTiles. */
  | { type: "tilesFile"; file: File; name: string; colorBy?: string; title?: string; delimiter: Delimiter; encoding: Encoding };

export type WorkerResponse =
  | { type: "progress"; loaded: number; total: number }
  | { type: "opened"; file: OpenedFile }
  | { type: "built"; summary: BuildSummary }
  | { type: "exported"; blob: Blob }
  | { type: "profiled"; profile: ColumnProfile }
  | { type: "source"; source: SourceInfo }
  | { type: "joinStats"; stats: JoinStats }
  | { type: "failedRows"; blob: Blob; count: number }
  | { type: "tiling"; stage: string; fraction: number }
  | { type: "tiled"; blob: Blob; report: import("./tiles").TileReport }
  | { type: "error"; message: string };
