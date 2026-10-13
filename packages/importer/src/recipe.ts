/**
 * Receita: a lista de passos que o usuário monta no builder, aplicada em ordem sobre as linhas.
 * Serializável (JSON), sem efeitos colaterais; roda na amostra (interface) e no arquivo inteiro (worker).
 * O arquivo original nunca é alterado (docs/IMPORT.md).
 */
import { normalizeCep, parseLooseDate, parseLooseNumber } from "./clean";
import type { Row } from "./detect";
import { joinIndex, joinKey } from "./join";
import { isEmpty, normalizeName } from "./values";

export type Condition =
  | { column: string; op: "=" | "!="; value: string }
  | { column: string; op: "contains" | "starts"; value: string }
  | { column: string; op: ">" | ">=" | "<" | "<="; value: number }
  | { column: string; op: "empty" | "filled" }
  | { column: string; op: "in"; values: string[] };

export type RecipeStep =
  | { op: "rename"; column: string; to: string }
  | { op: "drop"; column: string }
  | { op: "trim"; column: string }
  | { op: "case"; column: string; to: "upper" | "lower" | "title" }
  | { op: "accents"; column: string }
  | { op: "fillEmpty"; column: string; value: string }
  | { op: "replace"; column: string; map: Record<string, string> }
  | { op: "toNumber"; column: string }
  | { op: "cep"; column: string }
  | { op: "date"; column: string; part?: "date" | "year" | "month" | "weekday"; to?: string }
  | { op: "split"; column: string; separator: string; into: string[] }
  | { op: "concat"; columns: string[]; separator: string; to: string }
  | { op: "round"; column: string; decimals?: number; multiple?: number }
  | { op: "bucket"; column: string; edges: number[]; to?: string; labels?: string[] }
  | { op: "compute"; to: string; a: string; operator: "+" | "-" | "*" | "/"; b: string | number }
  | { op: "rules"; to: string; rules: { when: Condition[]; match: "all" | "any"; value: string }[]; otherwise?: string }
  | { op: "filter"; keep: boolean; when: Condition[]; match: "all" | "any" }
  /**
   * Completa cada linha com colunas de outra planilha, casando `key` (desta) com `otherKey` (da outra).
   * Chave tolerante: sem acentos, caixa, pontuação e zeros à esquerda ("00.360.305/0001-04" = "360305000104").
   * Várias linhas da outra para a mesma chave: a primeira, ou a soma dos números.
   */
  | {
      op: "join";
      source: string;
      label: string;
      key: string;
      otherKey: string;
      columns: { from: string; to: string }[];
      multiple?: "first" | "sum";
      /** Coluna nova com quantas linhas da outra planilha casaram. */
      countAs?: string;
    }
  /** Acrescenta as linhas de outra planilha (coluna da outra → coluna desta); os passos seguintes valem para elas. */
  | { op: "append"; source: string; label: string; map: Record<string, string> };

/** Outras planilhas usadas por "juntar" e "acrescentar" (id → linhas como vieram do arquivo). */
export interface RecipeContext {
  tables: Record<string, Row[]>;
}

const fmt = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 1e9) / 1e9) : "");
const num = (v: string | undefined) => (isEmpty(v) ? null : parseLooseNumber(v!) ?? parseLooseNumber(v!, "br"));
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function test(row: Row, c: Condition): boolean {
  const v = row[c.column] ?? "";
  switch (c.op) {
    case "=":
      return v.trim() === c.value;
    case "!=":
      return v.trim() !== c.value;
    case "contains":
      return normalizeName(v).includes(normalizeName(c.value));
    case "starts":
      return normalizeName(v).startsWith(normalizeName(c.value));
    case "empty":
      return isEmpty(v);
    case "filled":
      return !isEmpty(v);
    case "in":
      return c.values.includes(v.trim());
    default: {
      const n = num(v);
      if (n === null) return false;
      return c.op === ">" ? n > c.value : c.op === ">=" ? n >= c.value : c.op === "<" ? n < c.value : n <= c.value;
    }
  }
}

export const matches = (row: Row, when: Condition[], match: "all" | "any") =>
  when.length === 0 || (match === "all" ? when.every((c) => test(row, c)) : when.some((c) => test(row, c)));

/** Rótulo de faixa: "10–20", "até 10", "100 ou mais". */
function bucketLabel(edges: number[], i: number): string {
  const f = (n: number) => n.toLocaleString("pt-BR");
  if (i === 0) return `até ${f(edges[0]!)}`;
  if (i === edges.length) return `${f(edges.at(-1)!)} ou mais`;
  return `${f(edges[i - 1]!)}–${f(edges[i]!)}`;
}

/** Aplica um passo a uma linha (devolve a mesma linha alterada, ou `null` se o filtro a remove). */
function applyStep(row: Row, s: RecipeStep, ctx?: RecipeContext): Row | null {
  switch (s.op) {
    case "rename":
      if (s.column in row) {
        row[s.to] = row[s.column]!;
        if (s.to !== s.column) delete row[s.column];
      }
      return row;
    case "drop":
      delete row[s.column];
      return row;
    case "trim":
      if (row[s.column] !== undefined) row[s.column] = row[s.column]!.replace(/\s+/g, " ").trim();
      return row;
    case "case": {
      const v = row[s.column];
      if (v === undefined) return row;
      row[s.column] =
        s.to === "upper" ? v.toLocaleUpperCase("pt-BR") : s.to === "lower" ? v.toLocaleLowerCase("pt-BR") : v.toLocaleLowerCase("pt-BR").replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase("pt-BR"));
      return row;
    }
    case "accents":
      if (row[s.column] !== undefined) row[s.column] = row[s.column]!.normalize("NFD").replace(/[̀-ͯ]/g, "");
      return row;
    case "fillEmpty":
      if (isEmpty(row[s.column])) row[s.column] = s.value;
      return row;
    case "replace": {
      const v = row[s.column];
      if (v !== undefined && s.map[v] !== undefined) row[s.column] = s.map[v]!;
      else if (v !== undefined && s.map[v.trim()] !== undefined) row[s.column] = s.map[v.trim()]!;
      return row;
    }
    case "toNumber": {
      const n = num(row[s.column]);
      row[s.column] = n === null ? "" : fmt(n);
      return row;
    }
    case "cep":
      row[s.column] = normalizeCep(row[s.column]) ?? row[s.column] ?? "";
      return row;
    case "date": {
      const t = parseLooseDate(row[s.column], true);
      const out = s.to ?? s.column;
      if (t === null) {
        row[out] = "";
        return row;
      }
      const d = new Date(t);
      row[out] =
        s.part === "year" ? String(d.getUTCFullYear()) : s.part === "month" ? MONTHS[d.getUTCMonth()]! : s.part === "weekday" ? WEEKDAYS[d.getUTCDay()]! : d.toISOString().slice(0, 10);
      return row;
    }
    case "split": {
      const parts = (row[s.column] ?? "").split(s.separator);
      s.into.forEach((name, i) => (row[name] = (i === s.into.length - 1 ? parts.slice(i).join(s.separator) : parts[i] ?? "").trim()));
      return row;
    }
    case "concat":
      row[s.to] = s.columns.map((c) => (row[c] ?? "").trim()).filter(Boolean).join(s.separator);
      return row;
    case "round": {
      const n = num(row[s.column]);
      if (n === null) return row;
      const r = s.multiple ? Math.round(n / s.multiple) * s.multiple : Number(n.toFixed(s.decimals ?? 0));
      row[s.column] = fmt(r);
      return row;
    }
    case "bucket": {
      const n = num(row[s.column]);
      const out = s.to ?? s.column;
      if (n === null) {
        row[out] = "";
        return row;
      }
      let i = s.edges.findIndex((e) => n < e);
      if (i === -1) i = s.edges.length;
      row[out] = s.labels?.[i] ?? bucketLabel(s.edges, i);
      return row;
    }
    case "compute": {
      const a = num(row[s.a]);
      const b = typeof s.b === "number" ? s.b : num(row[s.b]);
      if (a === null || b === null) row[s.to] = "";
      else row[s.to] = fmt(s.operator === "+" ? a + b : s.operator === "-" ? a - b : s.operator === "*" ? a * b : b === 0 ? NaN : a / b);
      return row;
    }
    case "rules": {
      const hit = s.rules.find((r) => matches(row, r.when, r.match));
      row[s.to] = hit ? hit.value : (s.otherwise ?? "");
      return row;
    }
    case "filter":
      return matches(row, s.when, s.match) === s.keep ? row : null;
    case "join": {
      const table = ctx?.tables[s.source];
      const hits = (table && joinIndex(table, s.otherKey).get(joinKey(row[s.key]))) ?? [];
      for (const c of s.columns) {
        if (hits.length === 0) row[c.to] = "";
        else if (s.multiple === "sum" && hits.length > 1) {
          const nums = hits.map((h) => num(h[c.from]));
          row[c.to] = nums.every((n) => n !== null) ? fmt(nums.reduce<number>((a, b) => a + b!, 0)) : (hits[0]![c.from] ?? "");
        } else row[c.to] = hits[0]![c.from] ?? "";
      }
      if (s.countAs) row[s.countAs] = String(hits.length);
      return row;
    }
    case "append":
      // As linhas novas entram em `applyRecipe`/`appendedRows`; linha a linha não muda nada.
      return row;
  }
}

/** Aplica a receita a uma linha (cópia). `null` = a linha saiu por um filtro. */
export function applyRecipeToRow(row: Row, recipe: RecipeStep[], ctx?: RecipeContext): Row | null {
  let out: Row | null = { ...row };
  for (const step of recipe) {
    out = applyStep(out, step, ctx);
    if (out === null) return null;
  }
  return out;
}

/**
 * Linhas acrescentadas por passos "append", já com os passos seguintes aplicados (na ordem da receita).
 * Quem lê o arquivo principal aos pedaços chama isto no fim.
 */
export function* appendedRows(recipe: RecipeStep[], ctx?: RecipeContext): Generator<Row> {
  for (let i = 0; i < recipe.length; i++) {
    const s = recipe[i]!;
    if (s.op !== "append") continue;
    const rest = recipe.slice(i + 1);
    for (const r of ctx?.tables[s.source] ?? []) {
      const mapped: Row = {};
      for (const [from, to] of Object.entries(s.map)) if (to) mapped[to] = r[from] ?? "";
      const next = applyRecipeToRow(mapped, rest, ctx);
      if (next) yield next;
    }
  }
}

/** Aplica a receita a todas as linhas, descartando as filtradas; as acrescentadas vêm no fim. */
export function applyRecipe(rows: Row[], recipe: RecipeStep[], ctx?: RecipeContext): Row[] {
  if (recipe.length === 0) return rows;
  const out: Row[] = [];
  for (const r of rows) {
    const next = applyRecipeToRow(r, recipe, ctx);
    if (next) out.push(next);
  }
  for (const r of appendedRows(recipe, ctx)) out.push(r);
  return out;
}

/** Colunas depois da receita (para a grade e o mapeamento), na ordem: originais, depois as criadas. */
export function columnsAfter(headers: string[], recipe: RecipeStep[]): string[] {
  let cols = [...headers];
  const add = (c: string) => !cols.includes(c) && cols.push(c);
  for (const s of recipe) {
    if (s.op === "rename") cols = cols.map((c) => (c === s.column ? s.to : c));
    else if (s.op === "drop") cols = cols.filter((c) => c !== s.column);
    else if (s.op === "split") s.into.forEach(add);
    else if (s.op === "concat" || s.op === "compute" || s.op === "rules") add(s.to);
    else if (s.op === "join") {
      s.columns.forEach((c) => add(c.to));
      if (s.countAs) add(s.countAs);
    } else if (s.op === "append") Object.values(s.map).filter(Boolean).forEach(add);
    else if ((s.op === "bucket" || s.op === "date") && s.to) add(s.to);
  }
  return cols;
}

/** Frase curta para a lista de passos ("Arredondar valor para múltiplos de 10"). */
export function describeStep(s: RecipeStep): string {
  switch (s.op) {
    case "rename":
      return `Renomear "${s.column}" para "${s.to}"`;
    case "drop":
      return `Tirar a coluna "${s.column}"`;
    case "trim":
      return `Tirar espaços de "${s.column}"`;
    case "case":
      return `${s.to === "upper" ? "MAIÚSCULAS" : s.to === "lower" ? "minúsculas" : "Primeira Letra Maiúscula"} em "${s.column}"`;
    case "accents":
      return `Tirar acentos de "${s.column}"`;
    case "fillEmpty":
      return `Vazios de "${s.column}" viram "${s.value}"`;
    case "replace":
      return `Trocar ${Object.keys(s.map).length} valores em "${s.column}"`;
    case "toNumber":
      return `"${s.column}" como número`;
    case "cep":
      return `Padronizar CEP em "${s.column}"`;
    case "date":
      return `Data de "${s.column}"${s.part && s.part !== "date" ? ` → ${s.part === "year" ? "ano" : s.part === "month" ? "mês" : "dia da semana"}` : ""}`;
    case "split":
      return `Dividir "${s.column}" em ${s.into.map((c) => `"${c}"`).join(", ")}`;
    case "concat":
      return `Juntar ${s.columns.map((c) => `"${c}"`).join(" + ")} em "${s.to}"`;
    case "round":
      return s.multiple ? `Arredondar "${s.column}" para múltiplos de ${s.multiple}` : `Arredondar "${s.column}" com ${s.decimals ?? 0} casas`;
    case "bucket":
      return `Faixas de "${s.column}"${s.to ? ` em "${s.to}"` : ""}`;
    case "compute":
      return `"${s.to}" = ${s.a} ${s.operator} ${s.b}`;
    case "rules":
      return `Regras → "${s.to}" (${s.rules.length})`;
    case "filter":
      return `${s.keep ? "Manter só" : "Remover"} linhas com ${s.when.length} ${s.when.length === 1 ? "condição" : "condições"}`;
    case "join":
      return `Juntar com "${s.label}" (${s.key} = ${s.otherKey}, +${s.columns.length} ${s.columns.length === 1 ? "coluna" : "colunas"})`;
    case "append":
      return `Acrescentar as linhas de "${s.label}"`;
  }
}
