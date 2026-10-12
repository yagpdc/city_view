/**
 * Valores "sujos" comuns em planilhas brasileiras: moeda e porcentagem, "1,2 mil", números entre
 * parênteses, CEP sem zero à esquerda, sim/não, datas do Excel, cabeçalho fora da primeira linha.
 */
import { isEmpty, parseDate, parseNumber, type NumberLocale } from "./values";

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
export function uniqueHeaders(raw: unknown[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    const base = (h === null || h === undefined ? "" : String(h)).replace(/^﻿/, "").trim() || `coluna_${i + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
}
