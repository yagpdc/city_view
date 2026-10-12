/**
 * Coordenadas como elas chegam nas planilhas de verdade: decimal com vírgula, graus/minutos/segundos,
 * com hemisfério (S/W/O), as duas numa coluna só, em WKT, invertidas ou sem o ponto decimal.
 */
import { parseNumber, type NumberLocale } from "./values";

/** Graus/minutos/segundos ou decimal com hemisfério: "23°33'01.5\"S", "23 33 01 S", "46,65 O", "S23.55". */
const DMS =
  /^([NSLOWE])?\s*([+-]?\d+(?:[.,]\d+)?)\s*(?:°|º|graus|d|\s)\s*(?:(\d+(?:[.,]\d+)?)\s*(?:'|′|min|m|\s)\s*)?(?:(\d+(?:[.,]\d+)?)\s*(?:"|″|'')?\s*)?([NSLOWE])?$/i;
// Sem "s" como marcador de segundos: em "23 33 01 S" o S é o hemisfério.

/**
 * Converte uma coordenada em texto para graus decimais com sinal. Aceita decimal ("-23,55"),
 * graus/minutos/segundos e hemisfério (S e W/O negativos). `null` se não for coordenada.
 */
export function parseCoordinate(raw: unknown, locale: NumberLocale = "intl"): number | null {
  const plain = parseNumber(raw, locale);
  if (plain !== null) return plain;
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/\s+/g, " ");
  // Decimal com hemisfério ("23.55 S", "S 23,55").
  const hemi = /^([NSLOWE])?\s*([+-]?\d+(?:[.,]\d+)?)\s*([NSLOWE])?$/i.exec(s);
  if (hemi && (hemi[1] || hemi[3])) {
    const v = Number(hemi[2]!.replace(",", "."));
    return signed(v, hemi[1] ?? hemi[3]!);
  }
  const m = DMS.exec(s);
  if (!m) return null;
  const [, pre, d, min, sec, post] = m;
  if (min === undefined && sec === undefined && !pre && !post) return null;
  const num = (x: string | undefined) => (x === undefined ? 0 : Number(x.replace(",", ".")));
  const deg = num(d);
  const value = Math.abs(deg) + num(min) / 60 + num(sec) / 3600;
  if (!Number.isFinite(value)) return null;
  const letter = pre ?? post;
  if (letter) return signed(value, letter);
  return deg < 0 || d!.startsWith("-") ? -value : value;
}

function signed(value: number, hemisphere: string): number {
  const h = hemisphere.toUpperCase();
  return h === "S" || h === "W" || h === "O" ? -Math.abs(value) : Math.abs(value);
}

/**
 * As duas coordenadas numa coluna só: "-23.55, -46.63", "(-23,55; -46,63)", "-23.55 -46.63" ou WKT
 * "POINT(-46.63 -23.55)" (WKT é lon lat). Devolve [lat, lon].
 */
export function splitLatLon(raw: unknown): [number, number] | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  const wkt = /^POINT\s*Z?\s*\(\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)/i.exec(s);
  if (wkt) return [Number(wkt[2]), Number(wkt[1])];
  const inner = s.replace(/^[([{]\s*|\s*[)\]}]$/g, "");
  // Separadores: ";" ou "," entre números com ponto decimal, ou espaço.
  const parts = inner.includes(";")
    ? inner.split(";")
    : /^[+-]?\d+(\.\d+)?\s*,\s*[+-]?\d+(\.\d+)?$/.test(inner)
      ? inner.split(",")
      : inner.split(/\s+/);
  if (parts.length !== 2) return null;
  const lat = parseNumber(parts[0]!.trim(), "br") ?? parseNumber(parts[0]!.trim());
  const lon = parseNumber(parts[1]!.trim(), "br") ?? parseNumber(parts[1]!.trim());
  return lat !== null && lon !== null ? [lat, lon] : null;
}

/** Dentro do Brasil (com folga). */
export const inBrazil = (lat: number, lon: number) => lat >= -34.5 && lat <= 6 && lon >= -74.5 && lon <= -28;

export type CoordinateFix =
  | { kind: "swap" }
  | { kind: "scale"; divisor: number }
  | { kind: "none" };

/**
 * Olha uma amostra de pares e sugere a correção que mais traz pontos para dentro do Brasil:
 * trocar lat/lon (colunas invertidas) ou dividir por 10^k (número sem o ponto decimal: -2355052 → -23,55052).
 */
export function suggestCoordinateFix(pairs: [number, number][]): CoordinateFix {
  if (pairs.length === 0) return { kind: "none" };
  const share = (f: (lat: number, lon: number) => [number, number]) =>
    pairs.filter(([la, lo]) => {
      const [a, b] = f(la, lo);
      return inBrazil(a, b);
    }).length / pairs.length;
  const base = share((a, b) => [a, b]);
  if (base >= 0.8) return { kind: "none" };
  const swapped = share((a, b) => [b, a]);
  let best: CoordinateFix = { kind: "none" };
  let bestShare = base;
  if (swapped > bestShare) [best, bestShare] = [{ kind: "swap" }, swapped];
  for (let k = 1; k <= 9; k++) {
    const d = 10 ** k;
    const scaled = share((a, b) => [a / d, b / d]);
    if (scaled > bestShare + 0.1) [best, bestShare] = [{ kind: "scale", divisor: d }, scaled];
  }
  return bestShare >= 0.6 ? best : { kind: "none" };
}

/** Aplica a correção sugerida a um par [lat, lon]. */
export function applyCoordinateFix(fix: CoordinateFix, lat: number, lon: number): [number, number] {
  if (fix.kind === "swap") return [lon, lat];
  if (fix.kind === "scale") return [lat / fix.divisor, lon / fix.divisor];
  return [lat, lon];
}
