/**
 * Ipeadata (IPEA). A API OData devolve sempre a série inteira (não filtra nível nem data),
 * então baixamos uma vez e reaproveitamos para o CSV e para o mapa.
 */
import type { LibraryAdapter, LibraryItem, MunicipalData } from "../types";
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

export const ipeadataAdapter: LibraryAdapter = {
  async download(item: LibraryItem) {
    const values = await series(item.id);
    if (values.length === 0) throw new Error("a série não tem valores");
    const regional = values.some((v) => v.NIVNOME);
    const header = regional ? ["Data", "Nível territorial", "Código do território", "Valor"] : ["Data", "Valor"];
    const rows = values.map((v) =>
      regional ? [day(v.VALDATA), v.NIVNOME ?? "", v.TERCODIGO ?? "", brNumber(v.VALVALOR)] : [day(v.VALDATA), brNumber(v.VALVALOR)],
    );
    const dates = values.map((v) => v.VALDATA).sort();
    const fileName = `ipeadata-${safeName(item.id)}.csv`;
    saveCsv(fileName, header, rows);
    return { rows: rows.length, detail: `série completa · ${day(dates[0]!).slice(0, 4)}–${day(dates.at(-1)!).slice(0, 4)}`, fileName };
  },

  async municipal(item: LibraryItem): Promise<MunicipalData> {
    const values = (await series(item.id)).filter((v) => v.NIVNOME === "Municípios" && v.TERCODIGO && v.VALVALOR !== null);
    if (values.length === 0) throw new Error("esta série não tem recorte por município");
    const latest = values.reduce((max, v) => (v.VALDATA > max ? v.VALDATA : max), "");
    const map = new Map<string, number>();
    for (const v of values) if (v.VALDATA === latest) map.set(v.TERCODIGO!, v.VALVALOR!);
    const unit = /\(([^()]+)\)$/.exec(item.title)?.[1] ?? "";
    return { title: item.title, period: latest.slice(0, 4), variables: [{ id: item.id, name: item.title, unit, values: map }] };
  },
};
