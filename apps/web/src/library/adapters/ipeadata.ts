/**
 * Ipeadata (IPEA). A API OData devolve sempre a série inteira (não filtra nível nem data),
 * então baixamos uma vez e reaproveitamos para as opções, o CSV e o mapa.
 */
import type { ItemChoice, ItemOptions, LibraryAdapter, LibraryItem, MunicipalData } from "../types";
import { brNumber, safeName, saveCsv } from "./csv";

const SERIES = "https://www.ipeadata.gov.br/api/odata4/Metadados('{id}')/Valores";

interface Value {
  VALDATA: string;
  VALVALOR: number | null;
  NIVNOME?: string;
  TERCODIGO?: string;
}

const cache = new Map<string, Promise<Value[]>>();

function series(id: string): Promise<Value[]> {
  let pending = cache.get(id);
  if (!pending) {
    pending = fetch(SERIES.replace("{id}", encodeURIComponent(id))).then(async (res) => {
      if (!res.ok) throw new Error(`o Ipeadata não respondeu (${res.status})`);
      return ((await res.json()) as { value: Value[] }).value;
    });
    pending.catch(() => cache.delete(id));
    cache.set(id, pending);
  }
  return pending;
}

const day = (iso: string) => iso.slice(0, 10);

/** Rótulo do período: só o ano quando a série é anual (todas as datas em 1º de janeiro). */
function periodLabeler(values: Value[]): (iso: string) => string {
  const annual = values.every((v) => day(v.VALDATA).endsWith("-01-01"));
  return (iso) => (annual ? iso.slice(0, 4) : iso.slice(0, 7));
}

export const ipeadataAdapter: LibraryAdapter = {
  async options(item: LibraryItem): Promise<ItemOptions> {
    const values = await series(item.id);
    const label = periodLabeler(values);
    const dates = [...new Set(values.map((v) => day(v.VALDATA)))].sort().reverse();
    const levels = [...new Set(values.map((v) => v.NIVNOME).filter((n): n is string => Boolean(n)))];
    return {
      periods: dates.map((d) => ({ id: d, label: label(d) })),
      levels: levels.map((n) => ({ code: n, name: n })),
      variables: [],
      municipal: levels.includes("Municípios"),
    };
  },

  async download(item: LibraryItem, choice: ItemChoice = {}) {
    const all = await series(item.id);
    const values = all.filter(
      (v) => (!choice.period || day(v.VALDATA) === choice.period) && (!choice.level || v.NIVNOME === choice.level),
    );
    if (values.length === 0) throw new Error("não há valores para essas opções");
    const regional = values.some((v) => v.NIVNOME);
    const header = regional ? ["Data", "Nível territorial", "Código do território", "Valor"] : ["Data", "Valor"];
    const rows = values.map((v) =>
      regional ? [day(v.VALDATA), v.NIVNOME ?? "", v.TERCODIGO ?? "", brNumber(v.VALVALOR)] : [day(v.VALDATA), brNumber(v.VALVALOR)],
    );
    const label = periodLabeler(all);
    const dates = values.map((v) => v.VALDATA).sort();
    const span = choice.period ? label(choice.period) : `${label(dates[0]!)}–${label(dates.at(-1)!)}`;
    const fileName = `ipeadata-${safeName(item.id)}${choice.period ? `-${safeName(span)}` : ""}${choice.level ? `-${safeName(choice.level)}` : ""}.csv`;
    saveCsv(fileName, header, rows);
    return { rows: rows.length, detail: `${choice.level ? `${choice.level.toLowerCase()} · ` : ""}${span}`, fileName };
  },

  async municipal(item: LibraryItem, choice: ItemChoice = {}): Promise<MunicipalData> {
    const all = await series(item.id);
    const values = all.filter((v) => v.NIVNOME === "Municípios" && v.TERCODIGO && v.VALVALOR !== null);
    if (values.length === 0) throw new Error("esta série não tem recorte por município");
    const target = choice.period ?? values.reduce((max, v) => (day(v.VALDATA) > max ? day(v.VALDATA) : max), "");
    const map = new Map<string, number>();
    for (const v of values) if (day(v.VALDATA) === target) map.set(v.TERCODIGO!, v.VALVALOR!);
    if (map.size === 0) throw new Error("não há valores por município nesse período");
    const unit = /\(([^()]+)\)$/.exec(item.title)?.[1] ?? "";
    return { title: item.title, period: periodLabeler(all)(target), variables: [{ id: item.id, name: item.title, unit, values: map }] };
  },
};
