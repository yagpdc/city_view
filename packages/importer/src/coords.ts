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
  /** Metros em UTM (SIRGAS 2000 ≈ WGS84). `swapped` = a coluna de "latitude" tem o Leste (x). */
  | { kind: "utm"; zone: number; south: boolean; swapped: boolean }
  | { kind: "none" };

/** Fusos UTM que cobrem o Brasil (18 a 25, todos no hemisfério sul exceto o extremo norte). */
export const BRAZIL_UTM_ZONES = [18, 19, 20, 21, 22, 23, 24, 25];

/** UTM → [lat, lon] (série de Krüger, elipsoide WGS84/GRS80; erro < 1 mm no fuso). */
export function utmToLatLon(easting: number, northing: number, zone: number, south = true): [number, number] {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const n = f / (2 - f);
  const A = (a / (1 + n)) * (1 + n * n / 4 + n ** 4 / 64);
  const beta = [n / 2 - (2 / 3) * n * n + (37 / 96) * n ** 3, (1 / 48) * n * n + (1 / 15) * n ** 3, (17 / 480) * n ** 3];
  const delta = [2 * n - (2 / 3) * n * n - 2 * n ** 3, (7 / 3) * n * n - (8 / 5) * n ** 3, (56 / 15) * n ** 3];
  const xi = (northing - (south ? 10_000_000 : 0)) / (k0 * A);
  const eta = (easting - 500_000) / (k0 * A);
  let xiP = xi;
  let etaP = eta;
  for (let j = 1; j <= 3; j++) {
    xiP -= beta[j - 1]! * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaP -= beta[j - 1]! * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  let lat = chi;
  for (let j = 1; j <= 3; j++) lat += delta[j - 1]! * Math.sin(2 * j * chi);
  const lon0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const lon = lon0 + Math.atan(Math.sinh(etaP) / Math.cos(xiP));
  return [(lat * 180) / Math.PI, (lon * 180) / Math.PI];
}

/** Par [lat, lon] lido das colunas parece UTM em metros? (Leste 100–900 mil; Norte 6–10,1 milhões no sul.) */
function utmShape(a: number, b: number): "normal" | "swapped" | null {
  const east = (v: number) => v >= 100_000 && v <= 900_000;
  const north = (v: number) => v >= 6_000_000 && v <= 10_100_000;
  if (north(a) && east(b)) return "normal"; // coluna "lat" = Norte (y), "lon" = Leste (x)
  if (east(a) && north(b)) return "swapped";
  return null;
}

/**
 * Olha uma amostra de pares e sugere a correção que mais traz pontos para dentro do Brasil:
 * trocar lat/lon (colunas invertidas) ou dividir por 10^k (número sem o ponto decimal: -2355052 → -23,55052).
 */
export function suggestCoordinateFix(pairs: [number, number][]): CoordinateFix {
  if (pairs.length === 0) return { kind: "none" };
  // UTM em metros: não dá para descobrir o fuso só pelos números — sugerimos 23 (SP/RJ/MG) e a pessoa confirma.
  const shapes = pairs.map(([a, b]) => utmShape(a, b));
  const utmNormal = shapes.filter((x) => x === "normal").length;
  const utmSwapped = shapes.filter((x) => x === "swapped").length;
  if (Math.max(utmNormal, utmSwapped) >= pairs.length * 0.8) return { kind: "utm", zone: 23, south: true, swapped: utmSwapped > utmNormal };
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
  if (fix.kind === "utm") return fix.swapped ? utmToLatLon(lat, lon, fix.zone, fix.south) : utmToLatLon(lon, lat, fix.zone, fix.south);
  if (fix.kind === "scale") return [lat / fix.divisor, lon / fix.divisor];
  return [lat, lon];
}
