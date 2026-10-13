/**
 * Valores "sujos" comuns em planilhas brasileiras: moeda e porcentagem, "1,2 mil", números entre
 * parênteses, CEP sem zero à esquerda, sim/não, datas do Excel, cabeçalho fora da primeira linha.
 */
import type { Row } from "./detect";
import type { RecipeStep } from "./recipe";
import { isEmpty, normalizeName, parseDate, parseNumber, type NumberLocale } from "./values";

const SUFFIX: Record<string, number> = { mil: 1e3, k: 1e3, mi: 1e6, milhao: 1e6, milhoes: 1e6, m: 1e6, bi: 1e9, bilhao: 1e9, bilhoes: 1e9 };

/**
 * Número "de gente": aceita o que `parseNumber` aceita e mais "R$ 1,2 mil", "3,5 mi", "(1.234,00)"
 * (negativo contábil), espaços não separáveis e "12 %".
 */
export function parseLooseNumber(raw: unknown, locale: NumberLocale = "intl"): number | null {
  const direct = parseNumber(raw, locale);
  if (direct !== null) return direct;
  if (typeof raw !== "string") return null;
  let s = raw.replace(/[  ]/g, " ").trim();
  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) [s, negative] = [paren[1]!.trim(), true];
  s = s.replace(/^R\$\s*/i, "").replace(/\s*%$/, "").trim();
  const suffix = /^(.*?)\s*(mil|k|mi|milh[aã]o|milh[oõ]es|m|bi|bilh[aã]o|bilh[oõ]es)\.?$/i.exec(s);
  let factor = 1;
  if (suffix) {
    s = suffix[1]!.trim();
    const key = suffix[2]!.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    factor = SUFFIX[key] ?? 1;
  }
  const n = parseNumber(s, locale) ?? parseNumber(s, locale === "br" ? "intl" : "br");
  if (n === null) return null;
  return (negative ? -n : n) * factor;
}

const TRUE = new Set(["sim", "s", "yes", "y", "true", "verdadeiro", "v", "1", "x", "ok"]);
const FALSE = new Set(["nao", "não", "n", "no", "false", "falso", "f", "0", "-"]);

/** sim/não, S/N, verdadeiro/falso, 1/0 → booleano; `null` se não reconhecer. */
export function parseBoolean(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim().toLowerCase();
  if (TRUE.has(s)) return true;
  if (FALSE.has(s)) return false;
  return null;
}

/** CEP com 8 dígitos e hífen ("1310200" → "01310-200"); `null` se não parecer CEP. */
export function normalizeCep(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 8) return null;
  const d = digits.padStart(8, "0");
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/** Excel guarda datas como dias desde 30/12/1899. Entre 1950 e 2100 = 18264..73051. */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
export function excelSerialToDate(serial: number): number | null {
  if (!(serial >= 18264 && serial <= 73051)) return null;
  return EXCEL_EPOCH + Math.round(serial * 86400000);
}

/**
 * Data em vários formatos: ISO, dd/mm/aaaa, d/m/aa, aaaa/mm/dd, dd-mm-aaaa, dd.mm.aaaa e número de série do
 * Excel (quando `allowSerial`). Devolve timestamp UTC (ms).
 */
export function parseLooseDate(raw: unknown, allowSerial = false): number | null {
  if (typeof raw === "number") return allowSerial ? excelSerialToDate(raw) : null;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  // ISO pelo parser comum; dd/mm/aaaa aqui, validando o dia (31/02 não existe).
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return parseDate(s);
  if (allowSerial && /^\d{5}(\.\d+)?$/.test(s)) return excelSerialToDate(Number(s));
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) - (Number(m[3]) > 50 ? 100 : 0) : Number(m[3]);
    return validDate(y, Number(m[2]), Number(m[1]));
  }
  m = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(s);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

function validDate(y: number, m: number, d: number): number | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, m - 1, d);
  return new Date(t).getUTCDate() === d ? t : null;
}

/**
 * Em que linha está o cabeçalho? Planilhas costumam ter título, data de emissão e linhas em branco acima.
 * Procura nas primeiras linhas a primeira que (1) tem pelo menos metade das células preenchidas, quase todas
 * com texto (não número), (2) é seguida por linhas com quantidade parecida de células preenchidas.
 */
export function detectHeaderRow(lines: unknown[][], maxScan = 30): number {
  const filled = (row: unknown[]) => row.filter((c) => !isEmpty(c)).length;
  const width = Math.max(1, ...lines.slice(0, maxScan + 10).map(filled));
  for (let i = 0; i < Math.min(maxScan, lines.length); i++) {
    const row = lines[i]!;
    const n = filled(row);
    if (n < Math.max(2, width * 0.5)) continue;
    const texts = row.filter((c) => !isEmpty(c) && parseNumber(c) === null).length;
    if (texts < n * 0.8) continue;
    const next = lines.slice(i + 1, i + 6);
    if (next.length === 0) return i;
    const consistent = next.filter((r) => filled(r) >= n * 0.5).length >= Math.ceil(next.length * 0.6);
    if (consistent) return i;
  }
  return 0;
}

/**
 * Nomes de coluna únicos e não vazios: vazios viram "coluna_3", repetidos ganham sufixo ("valor", "valor_2").
 */
/** Nomes usados por dentro dos tiles; uma coluna com esse nome sobrescreveria a categoria interna. */
export const RESERVED_COLUMNS = new Set(["_c"]);

export function uniqueHeaders(raw: unknown[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    let base = (h === null || h === undefined ? "" : String(h)).replace(/^\uFEFF/, "").trim() || `coluna_${i + 1}`; // \uFEFF = BOM
    if (RESERVED_COLUMNS.has(base)) base = `${base}_coluna`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
}

/** Linhas que não são registro: total/subtotal, cabeçalho repetido (relatório paginado), rodapé ("Fonte: …"). */
export interface JunkFinding {
  kind: "total" | "cabecalho-repetido" | "rodape";
  /** Em português, para o usuário. */
  message: string;
  /** Índices (nas linhas lidas) das que batem. */
  rows: number[];
  /** Passo da receita que remove essas linhas (por condição, vale também para a planilha do mês que vem). */
  step: RecipeStep;
}

const TOTAL = /^(total( geral)?|totais|subtotal|sub-total|soma|somat[oó]rio)\b/i;
const FOOTER = /^(fonte|elaborad[oa]|nota|notas|obs\.?|observa[cç][aã]o|gerado|emitido|p[aá]gina|impresso)\b/i;

export function detectJunkRows(headers: string[], rows: Row[]): JunkFinding[] {
  const out: JunkFinding[] = [];
  const filled = (r: Row) => headers.filter((h) => !isEmpty(r[h]));
  // Totais: a primeira célula preenchida começa com "Total", "Subtotal", "Soma"…
  const totals = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const first = filled(r)[0];
    if (first && TOTAL.test(r[first]!.trim())) totals.set(first, [...(totals.get(first) ?? []), i]);
  });
  for (const [column, idx] of totals) {
    const word = rows[idx[0]!]![column]!.trim().split(/\s+/)[0]!;
    out.push({
      kind: "total",
      message: `${idx.length === 1 ? "1 linha parece" : `${idx.length} linhas parecem`} um total ("${rows[idx[0]!]![column]!.trim()}") — viraria um registro com a soma de tudo`,
      rows: idx,
      step: { op: "filter", keep: false, when: [{ column, op: "starts", value: word }], match: "all" },
    });
  }
  // Cabeçalho repetido no meio: a maioria das células igual ao nome da coluna.
  const repeated: number[] = [];
  rows.forEach((r, i) => {
    const same = headers.filter((h) => normalizeName(r[h] ?? "") === normalizeName(h) && normalizeName(h) !== "").length;
    if (same >= Math.max(2, headers.length * 0.6)) repeated.push(i);
  });
  if (repeated.length) {
    out.push({
      kind: "cabecalho-repetido",
      message: `${repeated.length === 1 ? "1 linha repete" : `${repeated.length} linhas repetem`} os nomes das colunas (relatório com várias páginas)`,
      rows: repeated,
      step: { op: "filter", keep: false, when: [{ column: headers[0]!, op: "=", value: headers[0]! }], match: "all" },
    });
  }
  // Rodapé: só uma célula preenchida, começando com "Fonte", "Nota", "Elaborado"…
  const footer = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const f = filled(r);
    if (f.length === 1 && FOOTER.test(r[f[0]!]!.trim())) footer.set(f[0]!, [...(footer.get(f[0]!) ?? []), i]);
  });
  for (const [column, idx] of footer) {
    const word = rows[idx[0]!]![column]!.trim().split(/[\s:]+/)[0]!;
    out.push({
      kind: "rodape",
      message: `${idx.length === 1 ? "1 linha parece" : `${idx.length} linhas parecem`} rodapé ("${rows[idx[0]!]![column]!.trim().slice(0, 40)}")`,
      rows: idx,
      step: { op: "filter", keep: false, when: [{ column, op: "starts", value: word }], match: "all" },
    });
  }
  return out;
}
