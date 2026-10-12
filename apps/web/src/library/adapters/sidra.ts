/**
 * IBGE · SIDRA. Consultas direto do navegador às APIs públicas do IBGE (CORS liberado).
 * Padrão (sem escolhas) para caber no limite de 100 mil valores: recorte mais detalhado,
 * período mais recente, todas as variáveis, total das classificações.
 */
import type { ItemChoice, ItemOptions, LibraryAdapter, LibraryItem, MunicipalData, MunicipalVariable } from "../types";
import { brNumber, safeName, saveCsv } from "./csv";

const API = "https://servicodados.ibge.gov.br/api/v3/agregados/{id}";
const VALUES = "https://apisidra.ibge.gov.br/values/t/{id}/{level}/all/v/{variable}/p/{period}";

const LEVELS = [
  { code: "N6", name: "Municípios" },
  { code: "N3", name: "Unidades da Federação" },
  { code: "N2", name: "Grandes regiões" },
  { code: "N1", name: "Brasil" },
];

type Row = Record<string, string>;

interface Metadata {
  nivelTerritorial?: { Administrativo?: string[] };
  variaveis?: { id: number; nome: string; unidade: string }[];
}

const metaCache = new Map<string, Promise<Metadata>>();
function metadata(id: string): Promise<Metadata> {
  let pending = metaCache.get(id);
  if (!pending) {
    pending = fetch(`${API.replace("{id}", id)}/metadados`).then((r) => {
      if (!r.ok) throw new Error(`metadados indisponíveis (${r.status})`);
      return r.json() as Promise<Metadata>;
    });
    pending.catch(() => metaCache.delete(id));
    metaCache.set(id, pending);
  }
  return pending;
}

async function values(id: string, level: string, period = "last", variable = "all"): Promise<{ labels: Row; rows: Row[] }> {
  const url = VALUES.replace("{id}", id).replace("{level}", level.toLowerCase()).replace("{variable}", variable).replace("{period}", period);
  const res = await fetch(url);
  const text = await res.text();
  let data: Row[];
  try {
    data = JSON.parse(text) as Row[];
  } catch {
    // A API responde texto puro quando recusa a consulta (grande demais, exige filtros…).
    throw new Error(text.trim().slice(0, 160) || `o IBGE recusou a consulta (${res.status})`);
  }
  if (!Array.isArray(data) || data.length < 2) throw new Error("a consulta não retornou valores");
  const [labels, ...rows] = data;
  return { labels: labels!, rows };
}

const keyByLabel = (labels: Row, test: (label: string) => boolean) => Object.keys(labels).find((k) => test(labels[k] ?? ""));

function periodOf(labels: Row, rows: Row[]): string {
  const key = Object.keys(labels).find((k) => /^D\dN$/.test(k) && /ano|mês|trimestre|período/i.test(labels[k] ?? ""));
  return key ? (rows[0]?.[key] ?? "último") : "último";
}

export const sidraAdapter: LibraryAdapter = {
  async options(item: LibraryItem): Promise<ItemOptions> {
    const [meta, periods] = await Promise.all([
      metadata(item.id),
      fetch(`${API.replace("{id}", item.id)}/periodos`).then((r) => (r.ok ? (r.json() as Promise<{ id: string; literals: string[] }[]>) : [])),
    ]);
    const available = meta.nivelTerritorial?.Administrativo ?? [];
    return {
      periods: [...periods].reverse().map((p) => ({ id: p.id, label: p.literals[0] ?? p.id })),
      levels: LEVELS.filter((l) => available.includes(l.code)),
      variables: (meta.variaveis ?? []).map((v) => ({ id: String(v.id), name: v.nome, unit: v.unidade })),
      municipal: available.includes("N6"),
    };
  },

  async download(item: LibraryItem, choice: ItemChoice = {}) {
    const available = (await metadata(item.id)).nivelTerritorial?.Administrativo ?? [];
    const level = LEVELS.find((l) => (choice.level ? l.code === choice.level : available.includes(l.code)));
    if (!level) throw new Error("esta tabela usa recortes territoriais especiais; baixe pelo site do SIDRA");
    const { labels, rows } = await values(item.id, level.code, choice.period, choice.variable);
    const keys = Object.keys(labels);
    const period = periodOf(labels, rows);
    const fileName = `sidra-${item.id}-${level.code.toLowerCase()}-${safeName(period)}.csv`;
    saveCsv(
      fileName,
      keys.map((k) => labels[k] ?? k),
      rows.map((r) => keys.map((k) => (k === "V" ? brNumber(r[k]) : (r[k] ?? "")))),
    );
    return { rows: rows.length, detail: `${level.name.toLowerCase()} · ${period}`, fileName };
  },

  async municipal(item: LibraryItem, choice: ItemChoice = {}): Promise<MunicipalData> {
    const { labels, rows } = await values(item.id, "N6", choice.period, choice.variable);
    const code = keyByLabel(labels, (l) => /^Município \(Código\)$/i.test(l));
    const varCode = keyByLabel(labels, (l) => /^Variável \(Código\)$/i.test(l));
    const varName = keyByLabel(labels, (l) => /^Variável$/i.test(l));
    if (!code || !varCode || !varName) throw new Error("formato inesperado da tabela (sem município ou variável)");

    const byVariable = new Map<string, MunicipalVariable>();
    for (const r of rows) {
      const v = Number(r.V);
      if (r.V === undefined || r.V === "" || !Number.isFinite(v)) continue; // "-", "...", "X" = sem valor/sigilo
      const id = r[varCode]!;
      let variable = byVariable.get(id);
      if (!variable) byVariable.set(id, (variable = { id, name: r[varName] ?? id, unit: r.MN ?? "", values: new Map() }));
      // Com classificações, a API pode repetir o município; fica o primeiro (total).
      if (!variable.values.has(r[code]!)) variable.values.set(r[code]!, v);
    }
    const variables = [...byVariable.values()].filter((v) => v.values.size > 0);
    if (variables.length === 0) throw new Error("a tabela não tem valores numéricos por município nesse período");
    return { title: item.title, period: periodOf(labels, rows), variables };
  },
};
