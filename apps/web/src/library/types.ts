/** Biblioteca de dados: formato decodificado dos índices (ver docs/LIBRARY.md). */

export const FLAG = { MUNICIPAL: 1, REGIONAL: 2, DOWNLOAD: 4 } as const;

export interface LibrarySourceMeta {
  id: string;
  name: string;
  publisher: string;
  country: string;
  description: string;
  homepage: string;
  /** Página do item na fonte (`{id}` é substituído); null quando não existe. */
  itemUrl: string | null;
  license: string;
  adapter: string;
  groupLabel: string;
  updatedAt: string;
}

/** Resumo de cada fonte no index.json. */
export interface LibrarySourceSummary
  extends Pick<LibrarySourceMeta, "id" | "name" | "publisher" | "country" | "description" | "homepage" | "license" | "adapter" | "updatedAt"> {
  items: number;
  municipal: number;
  bytes: number;
}

/** [id, título, grupo, assunto, ano inicial, ano final, flags] */
export type RawItem = [string, string, number, number, number | null, number | null, number];

export interface LibrarySourceIndex {
  schema: number;
  source: LibrarySourceMeta;
  groups: { id: string; name: string }[];
  subjects: string[];
  items: RawItem[];
}

export interface LibraryItem {
  source: LibrarySourceMeta;
  id: string;
  title: string;
  group: string;
  subject: string;
  yearFrom: number | null;
  yearTo: number | null;
  flags: number;
  url: string | null;
}

export interface DownloadResult {
  rows: number;
  /** Ex.: "municípios · 2022". */
  detail: string;
  fileName: string;
}

export interface MunicipalVariable {
  id: string;
  name: string;
  unit: string;
  /** Código IBGE do município (7 dígitos) → valor. */
  values: Map<string, number>;
}

export interface MunicipalData {
  title: string;
  period: string;
  variables: MunicipalVariable[];
}

/** Opções de um item: períodos (mais recente primeiro), recortes e variáveis. */
export interface ItemOptions {
  periods: { id: string; label: string }[];
  levels: { code: string; name: string }[];
  variables: { id: string; name: string; unit: string }[];
  /** Há recorte municipal (dá para pôr no mapa). */
  municipal: boolean;
}

/** Escolhas do usuário; campos ausentes = padrão (mais recente, mais detalhado, todas). */
export interface ItemChoice {
  period?: string;
  level?: string;
  variable?: string;
}

/** O que cada fonte sabe fazer, direto do navegador para a fonte oficial. */
export interface LibraryAdapter {
  options?(item: LibraryItem): Promise<ItemOptions>;
  download(item: LibraryItem, choice?: ItemChoice): Promise<DownloadResult>;
  /** Valores por município (período escolhido ou o mais recente), para o mapa. */
  municipal?(item: LibraryItem, choice?: ItemChoice): Promise<MunicipalData>;
}

export function decodeItem(index: LibrarySourceIndex, raw: RawItem): LibraryItem {
  const [id, title, g, s, yearFrom, yearTo, flags] = raw;
  return {
    source: index.source,
    id,
    title,
    group: index.groups[g]?.name ?? "",
    subject: index.subjects[s] ?? "",
    yearFrom,
    yearTo,
    flags,
    url: index.source.itemUrl ? index.source.itemUrl.replace("{id}", encodeURIComponent(id)) : null,
  };
}
