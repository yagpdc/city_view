import { parseCoordinate, splitLatLon } from "./coords";
import { isEmpty, looksBrazilian, normalizeName, parseDate, parseNumber, type NumberLocale } from "./values";

export type ColumnType = "number" | "category" | "date" | "text";

export interface ColumnInfo {
  name: string;
  type: ColumnType;
  /** Fração de linhas vazias na amostra. */
  emptyRate: number;
  /** Valores distintos na amostra (limitado). */
  distinct: number;
  examples: string[];
  min?: number;
  max?: number;
  /** Formato dos números (só para colunas numéricas). */
  locale?: NumberLocale;
}

export type Row = Record<string, string>;

const MAX_CATEGORIES = 50;
const MAX_DISTINCT_TRACKED = 1000;

/** Infere o tipo de cada coluna a partir de uma amostra de linhas. */
export function detectColumns(headers: string[], sample: Row[]): ColumnInfo[] {
  return headers.map((name) => {
    const values = sample.map((r) => r[name]).filter((v): v is string => !isEmpty(v));
    const locale: NumberLocale = values.some(looksBrazilian) ? "br" : "intl";
    const distinct = new Set<string>();
    let numbers = 0;
    let dates = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      if (distinct.size < MAX_DISTINCT_TRACKED) distinct.add(v);
      const n = parseNumber(v, locale);
      if (n !== null) {
        numbers++;
        min = Math.min(min, n);
        max = Math.max(max, n);
      } else if (parseDate(v) !== null) {
        dates++;
      }
    }
    const total = values.length || 1;
    const examples = [...distinct].slice(0, 3);
    const base = { name, emptyRate: 1 - values.length / Math.max(sample.length, 1), distinct: distinct.size, examples };

    if (numbers / total >= 0.95) {
      // Código numérico com poucos valores (ex.: UF, setor 1..9) tende a ser categoria.
      const looksLikeCode = distinct.size <= 12 && values.every((v) => /^\d+$/.test(v.trim()));
      return { ...base, type: looksLikeCode ? "category" : "number", min, max, locale };
    }
    if (dates / total >= 0.95) return { ...base, type: "date" };
    const categoryLimit = Math.min(MAX_CATEGORIES, Math.max(5, Math.floor(values.length * 0.2)));
    if (distinct.size <= categoryLimit) return { ...base, type: "category" };
    return { ...base, type: "text" };
  });
}

const LAT_NAMES = ["lat", "latitude", "y", "lat_dd", "nu_latitude", "latitude_dd", "coord_y", "geo_lat"];
const LON_NAMES = ["lon", "lng", "long", "longitude", "x", "lon_dd", "nu_longitude", "longitude_dd", "coord_x", "geo_lon", "geo_lng"];

export interface LocationGuess {
  lat: string;
  lon: string;
  /** Como chegamos ao palpite: pelo nome das colunas ou pelos valores. */
  reason: "names" | "values";
  /** As duas numa coluna só (então `lat`/`lon` ficam vazios). */
  latlon?: string;
}

const inRange = (c: ColumnInfo, lo: number, hi: number) =>
  c.type === "number" && c.min !== undefined && c.max !== undefined && c.min >= lo && c.max <= hi;

/** Procura as colunas de latitude e longitude, primeiro pelo nome, depois pelos valores. */
export function guessLocation(columns: ColumnInfo[]): LocationGuess | null {
  const byName = (names: string[]) =>
    columns.find((c) => names.includes(normalizeName(c.name)) && c.type === "number") ??
    columns.find((c) => names.some((n) => normalizeName(c.name).endsWith(`_${n}`)) && c.type === "number");
  const lat = byName(LAT_NAMES);
  const lon = byName(LON_NAMES);
  if (lat && lon && lat !== lon) return { lat: lat.name, lon: lon.name, reason: "names" };

  // Pelos valores: no Brasil, latitude ∈ [-34, 6] e longitude ∈ [-74, -34].
  const latCandidate = columns.find((c) => inRange(c, -34, 6) && !inRange(c, -74, -34.5));
  const lonCandidate = columns.find((c) => inRange(c, -74, -34) && c !== latCandidate);
  if (latCandidate && lonCandidate) return { lat: latCandidate.name, lon: lonCandidate.name, reason: "values" };
  return null;
}

/** Melhor coluna para colorir (categoria com poucos valores) e para título (texto). */
export function guessStyleColumns(columns: ColumnInfo[], exclude: string[]): { colorBy?: string; title?: string } {
  const usable = columns.filter((c) => !exclude.includes(c.name) && c.emptyRate < 0.5);
  const colorBy = usable
    .filter((c) => c.type === "category" && c.distinct >= 2 && c.distinct <= 12)
    .sort((a, b) => a.distinct - b.distinct)[0]?.name;
  // Título: nomes/razão social primeiro; códigos e IDs por último.
  const titleWords = ["nome", "name", "razao_social", "fantasia", "titulo", "title", "descricao", "loja", "empresa"];
  const isCode = (n: string) => /^(cod|codigo|id|cnpj|cpf|cep)(_|$)/.test(n);
  const textual = usable.filter((c) => c.type === "text" || c.type === "category");
  const title =
    textual.find((c) => titleWords.some((w) => normalizeName(c.name).includes(w)) && !isCode(normalizeName(c.name)))?.name ??
    textual.find((c) => c.type === "text" && !isCode(normalizeName(c.name)))?.name ??
    textual.find((c) => c.type === "text")?.name;
  return { colorBy, title };
}

/**
 * Quando os nomes e os números não bastam: coordenadas em texto (graus/minutos, com hemisfério) nas colunas
 * com nome de lat/lon, ou as duas numa coluna só ("-23.5, -46.6", WKT). Olha a amostra.
 */
export function guessLocationFromSample(columns: ColumnInfo[], sample: Row[]): (LocationGuess & { latlon?: string }) | null {
  const rows = sample.slice(0, 200);
  const share = (name: string, ok: (v: string) => boolean) => {
    const vals = rows.map((r) => r[name]).filter((v): v is string => !isEmpty(v));
    return vals.length ? vals.filter(ok).length / vals.length : 0;
  };
  const named = (names: string[]) =>
    columns.find((c) => names.includes(normalizeName(c.name)) || names.some((n) => normalizeName(c.name).endsWith(`_${n}`)));
  const lat = named(LAT_NAMES);
  const lon = named(LON_NAMES);
  if (lat && lon && lat !== lon && share(lat.name, (v) => parseCoordinate(v) !== null) > 0.8 && share(lon.name, (v) => parseCoordinate(v) !== null) > 0.8) {
    return { lat: lat.name, lon: lon.name, reason: "names" };
  }
  const single = columns.find((c) => c.type !== "number" && share(c.name, (v) => splitLatLon(v) !== null) > 0.8);
  if (single) return { lat: "", lon: "", latlon: single.name, reason: "values" };
  return null;
}
