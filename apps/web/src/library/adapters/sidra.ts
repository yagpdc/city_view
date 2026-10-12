/**
 * IBGE · SIDRA. Consultas direto do navegador à API pública (CORS liberado).
 * Padrão para caber no limite da API (100 mil valores): recorte mais detalhado disponível,
 * período mais recente, todas as variáveis, total das classificações.
 */
import type { LibraryAdapter, LibraryItem, MunicipalData, MunicipalVariable } from "../types";
import { brNumber, safeName, saveCsv } from "./csv";

const METADATA = "https://servicodados.ibge.gov.br/api/v3/agregados/{id}/metadados";
const VALUES = "https://apisidra.ibge.gov.br/values/t/{id}/{level}/all/v/all/p/last";

const LEVELS = [
  { code: "N6", name: "municípios" },
  { code: "N3", name: "UFs" },
  { code: "N2", name: "grandes regiões" },
  { code: "N1", name: "Brasil" },
];

type Row = Record<string, string>;

async function levelsOf(id: string): Promise<string[]> {
  const res = await fetch(METADATA.replace("{id}", id));
  if (!res.ok) throw new Error(`metadados indisponíveis (${res.status})`);
  const meta = (await res.json()) as { nivelTerritorial?: { Administrativo?: string[] } };
  return meta.nivelTerritorial?.Administrativo ?? [];
}

/** Valores de uma tabela num recorte: [rótulos, ...linhas]. A API responde texto quando recusa. */
async function values(id: string, level: string): Promise<{ labels: Row; rows: Row[] }> {
  const res = await fetch(VALUES.replace("{id}", id).replace("{level}", level.toLowerCase()));
  const text = await res.text();
  let data: Row[];
  try {
    data = JSON.parse(text) as Row[];
  } catch {
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
  async download(item: LibraryItem) {
    const available = await levelsOf(item.id);
    const level = LEVELS.find((l) => available.includes(l.code));
    if (!level) throw new Error("esta tabela usa recortes territoriais especiais; baixe pelo site do SIDRA");
    const { labels, rows } = await values(item.id, level.code);
    const keys = Object.keys(labels);
    const period = periodOf(labels, rows);
    const fileName = `sidra-${item.id}-${level.code.toLowerCase()}-${safeName(period)}.csv`;
    saveCsv(
      fileName,
      keys.map((k) => labels[k] ?? k),
      rows.map((r) => keys.map((k) => (k === "V" ? brNumber(r[k]) : (r[k] ?? "")))),
    );
    return { rows: rows.length, detail: `${level.name} · ${period}`, fileName };
  },

  async municipal(item: LibraryItem): Promise<MunicipalData> {
    const { labels, rows } = await values(item.id, "N6");
    const code = keyByLabel(labels, (l) => /^Município \(Código\)$/i.test(l));
    const varCode = keyByLabel(labels, (l) => /^Variável \(Código\)$/i.test(l));
    const varName = keyByLabel(labels, (l) => /^Variável$/i.test(l));
    if (!code || !varCode || !varName) throw new Error("formato inesperado da tabela (sem município ou variável)");

    const byVariable = new Map<string, MunicipalVariable>();
    for (const r of rows) {
      const v = Number(r.V);
      if (!Number.isFinite(v) || r.V === "" || r.V === undefined) continue; // "-", "...", "X" = sem valor/sigilo
      const id = r[varCode]!;
      let variable = byVariable.get(id);
      if (!variable) byVariable.set(id, (variable = { id, name: r[varName] ?? id, unit: r.MN ?? "", values: new Map() }));
      // Com classificações, a API pode repetir o município; fica o primeiro (total).
      if (!variable.values.has(r[code]!)) variable.values.set(r[code]!, v);
    }
    const variables = [...byVariable.values()].filter((v) => v.values.size > 0);
    if (variables.length === 0) throw new Error("a tabela não tem valores numéricos por município no período mais recente");
    return { title: item.title, period: periodOf(labels, rows), variables };
  },
};
