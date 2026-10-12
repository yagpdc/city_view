/* tslint:disable */
/* eslint-disable */
/**
 * Mensagem do último pânico do motor (o wasm só mostra "unreachable"); limpa ao ler.
 * @returns {string | undefined}
 */
export function last_panic(): string | undefined;
/**
 * Um processamento: preencha as colunas e chame `build`.
 */
export class TileJob {
  free(): void;
  /**
   * @param {string} name
   * @param {Float64Array} values
   */
  add_number(name: string, values: Float64Array): void;
  /**
   * Coordenadas em graus (`NaN` = sem coordenada; a linha sai).
   * @param {Float64Array} lat
   * @param {Float64Array} lon
   */
  set_points(lat: Float64Array, lon: Float64Array): void;
  /**
   * Valores unidos por `SEP` (um por linha).
   * @param {string} name
   * @param {string} values
   */
  add_category(name: string, values: string): void;
  /**
   * Coluna de cor compacta: índice por linha no dicionário (`u32::MAX` = sem); dicionário unido por `SEP`.
   * @param {string} column
   * @param {Uint32Array} ids
   * @param {string} dict
   */
  set_color_ids(column: string, ids: Uint32Array, dict: string): void;
  /**
   * Categoria compacta: índice por linha no dicionário (`u32::MAX` = vazio); dicionário unido por `SEP`.
   * @param {string} name
   * @param {Uint32Array} ids
   * @param {string} dict
   */
  add_category_ids(name: string, ids: Uint32Array, dict: string): void;
  /**
   * @param {string} name
   */
  constructor(name: string);
  /**
   * Gera o PMTiles. `progress(etapa, fração)` é chamado durante o processo.
   * @param {Function} progress
   * @returns {Uint8Array}
   */
  build(progress: Function): Uint8Array;
  /**
   * Relatório do último `build` (JSON): registros, inválidos, categorias, tempos.
   * @returns {string | undefined}
   */
  report(): string | undefined;
  /**
   * Valores unidos por `SEP` (um por linha).
   * @param {string} name
   * @param {string} values
   */
  add_text(name: string, values: string): void;
  /**
   * Coluna que colore o mapa: rótulo de cada linha (vazio = sem), unidos por `SEP`.
   * @param {string} column
   * @param {string} labels
   */
  set_color(column: string, labels: string): void;
  /**
   * Coluna de título (nome do lugar), mostrada nos rótulos e na busca.
   * @param {string} column
   */
  set_title(column: string): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_tilejob_free: (a: number, b: number) => void;
  readonly last_panic: () => Array;
  readonly tilejob_add_category: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly tilejob_add_category_ids: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
  readonly tilejob_add_number: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly tilejob_add_text: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly tilejob_build: (a: number, b: number) => Array;
  readonly tilejob_new: (a: number, b: number) => number;
  readonly tilejob_report: (a: number) => Array;
  readonly tilejob_set_color: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly tilejob_set_color_ids: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
  readonly tilejob_set_points: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly tilejob_set_title: (a: number, b: number, c: number) => void;
  readonly __wbindgen_export_0: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
