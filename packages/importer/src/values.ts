/** Normaliza nomes de coluna para comparação: minúsculas, sem acento, só letras/dígitos/_. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const DECIMAL_COMMA = /^[+-]?\d+,\d+$/;
const THOUSANDS_DOT_DECIMAL_COMMA = /^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/;
const THOUSANDS_COMMA_DECIMAL_DOT = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/;
// Number() aceitaria "0x1F", "Infinity" e espaços; esses casos vão pelo caminho completo.
const FAST_PATH_BLOCKERS = /[^0-9.eE+-]/;

/**
 * Formato numérico de uma coluna. Em "br" o ponto é separador de milhar ("1.500" = 1500);
 * em "intl" o ponto é decimal ("1.500" = 1,5). Detectado por coluna em `detectColumns`.
 */
export type NumberLocale = "br" | "intl";

/**
 * O valor usa vírgula como separador decimal? Só a vírgula é evidência: "-34.882" casaria
 * com "milhar com ponto" mas é uma coordenada com 3 casas — ponto sozinho é ambíguo.
 */
export function looksBrazilian(raw: string): boolean {
  const s = raw.trim().replace(/^R\$\s*/i, "").replace(/%$/, "").replace(/\s/g, "");
  return s.includes(",") && (DECIMAL_COMMA.test(s) || THOUSANDS_DOT_DECIMAL_COMMA.test(s));
}

/**
 * Converte texto em número aceitando os formatos comuns no Brasil e no exterior:
 * "-23.55", "-23,55", "1.234,56", "1,234.56", "R$ 10", "15%". Retorna null se não for número.
 */
export function parseNumber(raw: unknown, locale: NumberLocale = "intl"): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  // Atalho para o caso comum ("-23.55", "1500"): sem vírgula, moeda, %, espaço ou sinal unicode.
  if (!FAST_PATH_BLOCKERS.test(raw) && (locale === "intl" || !raw.includes("."))) {
    const n = raw === "" ? NaN : Number(raw);
    if (Number.isFinite(n)) return n;
  }
  let s = raw.trim().replace(/^R\$\s*/i, "").replace(/%$/, "").replace(/\s/g, "").replace("−", "-");
  if (s === "") return null;
  if (locale === "br" && THOUSANDS_DOT_DECIMAL_COMMA.test(s)) return Number(s.replace(/\./g, "").replace(",", "."));
  if (PLAIN_NUMBER.test(s)) return Number(s);
  if (DECIMAL_COMMA.test(s)) return Number(s.replace(",", "."));
  if (THOUSANDS_DOT_DECIMAL_COMMA.test(s)) return Number(s.replace(/\./g, "").replace(",", "."));
  if (THOUSANDS_COMMA_DECIMAL_DOT.test(s)) {
    s = s.replace(/,/g, "");
    return Number(s);
  }
  return null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/;
const BR_DATE = /^(\d{2})\/(\d{2})\/(\d{4})/;

/** Converte "2024-03-01", "2024-03-01T10:00" ou "01/03/2024" em timestamp (ms). */
export function parseDate(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (ISO_DATE.test(s)) {
    const t = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s);
    return Number.isNaN(t) ? null : t;
  }
  const br = BR_DATE.exec(s);
  if (br) {
    const [, d, m, y] = br;
    const t = Date.UTC(Number(y), Number(m) - 1, Number(d));
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

export function isEmpty(raw: unknown): boolean {
  return raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "");
}
