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

/** Recortes que sabemos desenhar no mapa (malhas do IBGE geradas por datapacks/build.py). */
export type MapLevel = "municipio" | "uf";

export const MAP_LEVELS: Record<MapLevel, { name: string; datapack: string }> = {
  municipio: { name: "Municípios", datapack: "municipios-populacao" },
  uf: { name: "Estados", datapack: "estados-populacao" },
};

export interface MapVariable {
  id: string;
  name: string;
  unit: string;
  /** Código IBGE do território (7 dígitos p/ município, 2 p/ UF) → valor. */
  values: Map<string, number>;
}

export interface MapData {
  title: string;
  period: string;
  level: MapLevel;
  variables: MapVariable[];
}

/** Opções de um item: períodos (mais recente primeiro), recortes e variáveis. */
export interface ItemOptions {
  periods: { id: string; label: string }[];
  levels: { code: string; name: string }[];
  variables: { id: string; name: string; unit: string }[];
  /** Recortes que dá para pôr no mapa, do mais detalhado ao menos. */
  mapLevels: MapLevel[];
  /** Classificações (sexo, idade, atividade…); sem escolha = total. */
  classifications?: Classification[];
}

export interface Classification {
  id: string;
  name: string;
  /** `level` 0 = total; maior = mais detalhado (para indentar). */
  categories: { id: string; name: string; level: number }[];
}

/** Escolhas do usuário; campos ausentes = padrão (mais recente, mais detalhado, todas). */
export interface ItemChoice {
  period?: string;
  level?: string;
  variable?: string;
  /** Recorte do mapa (padrão: o mais detalhado disponível). */
  mapLevel?: MapLevel;
  /** Classificação → categoria escolhida; ausente = total. */
  categories?: Record<string, string>;
}

/** O que cada fonte sabe fazer, direto do navegador para a fonte oficial. */
export interface LibraryAdapter {
  options?(item: LibraryItem): Promise<ItemOptions>;
  download(item: LibraryItem, choice?: ItemChoice): Promise<DownloadResult>;
  /** Valores por território (recorte e período escolhidos ou os padrões), para o mapa. */
  mapData?(item: LibraryItem, choice?: ItemChoice): Promise<MapData>;
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
