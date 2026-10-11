import type { ColumnType, Row } from "./detect";
import { isEmpty, parseDate, parseNumber, type NumberLocale } from "./values";

export interface ImportMapping {
  lat: string;
  lon: string;
  /** Formato numérico das colunas de coordenada. */
  latLocale?: NumberLocale;
  lonLocale?: NumberLocale;
  /** Colunas incluídas e seus tipos finais (o usuário pode corrigir o detectado). */
  columns: { name: string; type: ColumnType; locale?: NumberLocale }[];
}

export type InvalidReason = "sem-coordenadas" | "coordenada-invalida" | "fora-do-mundo";

export interface InvalidRow {
  line: number;
  reason: InvalidReason;
}

export interface PointFeature {
  type: "Feature";
  id: number;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: Record<string, string | number | null>;
}

export interface ImportSummary {
  /** Linhas que viram ponto. */
  count: number;
  invalidCount: number;
  /** Amostra das linhas rejeitadas (para mostrar ao usuário). */
  invalidSample: InvalidRow[];
  reasons: Record<InvalidReason, number>;
  /** [oeste, sul, leste, norte] */
  bounds: [number, number, number, number] | null;
  /** Linhas fora do Brasil (válidas, mas vale avisar). */
  outsideBrazil: number;
  /** Contagem por valor da coluna de cor, em ordem decrescente (vazio sem `colorBy`). */
  categories: [string, number][];
}

export interface BuildResult extends ImportSummary {
  features: PointFeature[];
}

const INVALID_SAMPLE = 20;

function convert(raw: string | undefined, type: ColumnType, locale?: NumberLocale): string | number | null {
  if (isEmpty(raw)) return null;
  if (type === "number") return parseNumber(raw, locale);
  if (type === "date") {
    const t = parseDate(raw);
    return t === null ? null : new Date(t).toISOString().slice(0, 10);
  }
  return raw!.trim();
}

/**
 * Valida as coordenadas de cada linha e acumula as estatísticas; chama `onValid` para as
 * linhas aproveitáveis. `firstLine` é o número da primeira linha de dados no arquivo
 * (para relatar erros no número que o usuário vê na planilha).
 */
function scan(
  rows: Row[],
  mapping: ImportMapping,
  firstLine: number,
  colorBy: string | undefined,
  onValid?: (row: Row, lon: number, lat: number) => void,
): ImportSummary {
  const invalidSample: InvalidRow[] = [];
  const reasons: Record<InvalidReason, number> = { "sem-coordenadas": 0, "coordenada-invalida": 0, "fora-do-mundo": 0 };
  const counts = new Map<string, number>();
  let count = 0;
  let invalidCount = 0;
  let outsideBrazil = 0;
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];

  const reject = (line: number, reason: InvalidReason) => {
    invalidCount++;
    reasons[reason]++;
    if (invalidSample.length < INVALID_SAMPLE) invalidSample.push({ line, reason });
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const line = firstLine + i;
    const rawLat = row[mapping.lat];
    const rawLon = row[mapping.lon];
    if (isEmpty(rawLat) || isEmpty(rawLon)) {
      reject(line, "sem-coordenadas");
      continue;
    }
    const lat = parseNumber(rawLat, mapping.latLocale);
    const lon = parseNumber(rawLon, mapping.lonLocale);
    if (lat === null || lon === null) {
      reject(line, "coordenada-invalida");
      continue;
    }
    if (Math.abs(lat) > 85 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) {
      reject(line, "fora-do-mundo");
      continue;
    }

    count++;
    if (lat < -34 || lat > 6 || lon < -74 || lon > -34) outsideBrazil++;
    if (lon < w) w = lon;
    if (lat < s) s = lat;
    if (lon > e) e = lon;
    if (lat > n) n = lat;
    if (colorBy) {
      const v = row[colorBy];
      if (!isEmpty(v)) {
        const key = v!.trim();
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    onValid?.(row, lon, lat);
  }

  return {
    count,
    invalidCount,
    invalidSample,
    reasons,
    bounds: count ? [w, s, e, n] : null,
    outsideBrazil,
    categories: [...counts.entries()].sort((a, b) => b[1] - a[1]),
  };
}

/** Só valida e resume (rápido: não cria objetos por linha). Usado na revisão do wizard. */
export function summarize(rows: Row[], mapping: ImportMapping, colorBy?: string, firstLine = 2): ImportSummary {
  return scan(rows, mapping, firstLine, colorBy);
}

/** Converte as linhas válidas em feições de ponto, com as colunas escolhidas. */
export function buildFeatures(rows: Row[], mapping: ImportMapping, colorBy?: string, firstLine = 2): BuildResult {
  const features: PointFeature[] = [];
  const summary = scan(rows, mapping, firstLine, colorBy, (row, lon, lat) => {
    const properties: PointFeature["properties"] = {};
    for (const c of mapping.columns) properties[c.name] = convert(row[c.name], c.type, c.locale);
    features.push({ type: "Feature", id: features.length + 1, geometry: { type: "Point", coordinates: [lon, lat] }, properties });
  });
  return { ...summary, features };
}
