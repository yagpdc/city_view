import type { ExpressionSpecification } from "maplibre-gl";

/** Condição sobre uma coluna: lista de valores, faixa numérica e/ou trecho de texto. */
export type WhereClause = { in?: (string | number)[]; gte?: number; lte?: number; contains?: string };

export type Where = Record<string, WhereClause>;

/** Trecho de texto comparável: minúsculo e sem acento. */
const fold = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Condições MapLibre (para um `["all", ...]`) equivalentes ao `where`. */
export function whereExpressions(where: Where | undefined): ExpressionSpecification[] {
  const out: ExpressionSpecification[] = [];
  for (const [column, clause] of Object.entries(where ?? {})) {
    if (clause.in) out.push(["in", ["to-string", ["get", column]], ["literal", clause.in.map(String)]]);
    // Sem valor (ou texto) não entra numa faixa numérica.
    if (clause.gte !== undefined || clause.lte !== undefined) {
      const value: ExpressionSpecification = ["to-number", ["get", column]];
      out.push(["==", ["typeof", ["get", column]], "number"]);
      if (clause.gte !== undefined) out.push([">=", value, clause.gte]);
      if (clause.lte !== undefined) out.push(["<=", value, clause.lte]);
    }
    // O MapLibre não tira acentos: no mapa a busca ignora só maiúsculas/minúsculas.
    if (clause.contains) out.push(["in", clause.contains.toLowerCase(), ["downcase", ["to-string", ["coalesce", ["get", column], ""]]]]);
  }
  return out;
}

/** A mesma regra do `whereExpressions`, para registros fora do mapa (ex.: "Por perto"). */
export function matchesWhere(properties: Record<string, unknown>, where: Where | undefined): boolean {
  for (const [column, clause] of Object.entries(where ?? {})) {
    const v = properties[column];
    if (clause.in && !clause.in.map(String).includes(String(v))) return false;
    if (clause.gte !== undefined || clause.lte !== undefined) {
      if (typeof v !== "number") return false;
      if (clause.gte !== undefined && v < clause.gte) return false;
      if (clause.lte !== undefined && v > clause.lte) return false;
    }
    if (clause.contains && !fold(String(v ?? "")).includes(fold(clause.contains))) return false;
  }
  return true;
}

/** `where` sem condições vazias; null quando não sobra nada. */
export function cleanWhere(where: Where | undefined | null): Where | null {
  const out: Where = {};
  for (const [column, c] of Object.entries(where ?? {})) {
    const clause: WhereClause = {};
    if (c.in?.length) clause.in = c.in;
    if (c.gte !== undefined && Number.isFinite(c.gte)) clause.gte = c.gte;
    if (c.lte !== undefined && Number.isFinite(c.lte)) clause.lte = c.lte;
    if (c.contains?.trim()) clause.contains = c.contains.trim();
    if (Object.keys(clause).length) out[column] = clause;
  }
  return Object.keys(out).length ? out : null;
}
