/**
 * Download direto de uma tabela do SIDRA, do navegador para a API pública do IBGE
 * (CORS liberado). A City View não hospeda nem intermedeia o dado.
 *
 * Padrão "sensato" para caber no limite da API (100 mil valores por consulta):
 * nível territorial mais detalhado disponível, período mais recente, todas as variáveis
 * e o total das classificações.
 */

const METADATA = "https://servicodados.ibge.gov.br/api/v3/agregados/{id}/metadados";
const VALUES = "https://apisidra.ibge.gov.br/values/t/{id}/{level}/all/v/all/p/last";

/** Do mais para o menos detalhado. */
const LEVEL_PREFERENCE: { code: string; name: string }[] = [
  { code: "N6", name: "municípios" },
  { code: "N3", name: "UFs" },
  { code: "N2", name: "grandes regiões" },
  { code: "N1", name: "Brasil" },
];

export interface SidraDownloadResult {
  rows: number;
  levelName: string;
  period: string;
  fileName: string;
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function saveFile(name: string, content: string): void {
  // BOM para o Excel reconhecer UTF-8 (acentos).
  const blob = new Blob(["﻿", content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadSidraTable(id: number): Promise<SidraDownloadResult> {
  const meta = (await fetch(METADATA.replace("{id}", String(id))).then((r) => {
    if (!r.ok) throw new Error(`metadados indisponíveis (${r.status})`);
    return r.json();
  })) as { nivelTerritorial?: { Administrativo?: string[] } };
  const available = meta.nivelTerritorial?.Administrativo ?? [];
  const level = LEVEL_PREFERENCE.find((l) => available.includes(l.code));
  if (!level) throw new Error("esta tabela usa recortes territoriais especiais; baixe pelo site do SIDRA");

  const res = await fetch(VALUES.replace("{id}", String(id)).replace("{level}", level.code.toLowerCase()));
  const text = await res.text();
  let data: Record<string, string>[];
  try {
    data = JSON.parse(text) as Record<string, string>[];
  } catch {
    // A API responde texto puro quando recusa a consulta (ex.: grande demais, exige filtros).
    throw new Error(text.trim().slice(0, 160) || `o IBGE recusou a consulta (${res.status})`);
  }
  if (!Array.isArray(data) || data.length < 2) throw new Error("a consulta não retornou valores");

  // A primeira linha traz os rótulos das colunas.
  const [labels, ...rows] = data;
  const keys = Object.keys(labels!);
  // Coluna de valores com vírgula decimal: o Excel em português leria "7067.127" como 7 milhões.
  const cell = (k: string, v: string | undefined) => csvCell(k === "V" && v && /^-?\d+\.\d+$/.test(v) ? v.replace(".", ",") : v);
  const lines = [keys.map((k) => csvCell(labels![k])).join(";"), ...rows.map((r) => keys.map((k) => cell(k, r[k])).join(";"))];

  const periodKey = keys.find((k) => /^D\dN$/.test(k) && /ano|mês|trimestre|período/i.test(labels![k] ?? ""));
  const period = periodKey ? (rows[0]?.[periodKey] ?? "último") : "último";
  const fileName = `sidra-${id}-${level.code.toLowerCase()}-${period.replace(/[^\w-]+/g, "_")}.csv`;
  saveFile(fileName, lines.join("\r\n"));
  return { rows: rows.length, levelName: level.name, period, fileName };
}
