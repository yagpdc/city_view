/**
 * Perfil de uma coluna para o builder: números, distribuição e os problemas encontrados, cada um com a
 * correção sugerida (um passo de receita pronto para aplicar).
 */
import { normalizeCep, parseLooseNumber } from "./clean";
import type { ColumnInfo, Row } from "./detect";
import type { RecipeStep } from "./recipe";
import { isEmpty, normalizeName, parseNumber } from "./values";

export interface ColumnProblem {
  id: string;
  /** Em português, para o usuário: "37 valores com R$". */
  message: string;
  /** Quantas linhas da amostra. */
  count: number;
  /** Correção sugerida (aplicar = adicionar à receita). */
  fix?: { label: string; step: RecipeStep };
}

export interface ColumnProfile {
  name: string;
  total: number;
  empty: number;
  distinct: number;
  /** Mais comuns (texto/categoria), em ordem. */
  top: [string, number][];
  /** Números: mín, máx, média e histograma em 10 faixas. */
  numeric?: { min: number; max: number; mean: number; bins: { from: number; to: number; count: number }[]; decimals: boolean };
  problems: ColumnProblem[];
}

/** Chave para achar grafias diferentes do mesmo valor: sem acento, caixa, pontuação e espaços extras. */
export const looseKey = (v: string) => normalizeName(v).replace(/_/g, "");

export function profileColumn(column: ColumnInfo, sample: Row[]): ColumnProfile {
  const name = column.name;
  const raw = sample.map((r) => r[name]);
  const values = raw.filter((v): v is string => !isEmpty(v));
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const problems: ColumnProblem[] = [];

  // Espaços sobrando.
  const padded = values.filter((v) => v !== v.trim() || /\s{2,}/.test(v)).length;
  if (padded) problems.push({ id: "espacos", message: `${padded} valores com espaços sobrando`, count: padded, fix: { label: "Tirar espaços", step: { op: "trim", column: name } } });

  let numeric: ColumnProfile["numeric"];
  if (column.type === "number") {
    const nums = values.map((v) => parseLooseNumber(v, column.locale)).filter((n): n is number => n !== null);
    const strict = values.filter((v) => parseNumber(v, column.locale) !== null).length;
    const money = values.filter((v) => /R\$/i.test(v)).length;
    const pct = values.filter((v) => /%\s*$/.test(v)).length;
    if (money) problems.push({ id: "moeda", message: `${money} valores com R$`, count: money, fix: { label: "Converter para número", step: { op: "toNumber", column: name } } });
    if (pct) problems.push({ id: "porcentagem", message: `${pct} valores com %`, count: pct, fix: { label: "Converter para número", step: { op: "toNumber", column: name } } });
    const loose = nums.length - strict;
    if (loose > 0 && !money && !pct) problems.push({ id: "numero-escrito", message: `${loose} números escritos por extenso ("1,2 mil", "(100)")`, count: loose, fix: { label: "Converter para número", step: { op: "toNumber", column: name } } });
    const bad = values.length - nums.length;
    if (bad) problems.push({ id: "nao-numero", message: `${bad} valores que não são número`, count: bad });
    if (nums.length) {
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      for (const n of nums) {
        if (n < min) min = n;
        if (n > max) max = n;
        sum += n;
      }
      const span = max - min || 1;
      const bins = Array.from({ length: 10 }, (_, i) => ({ from: min + (span * i) / 10, to: min + (span * (i + 1)) / 10, count: 0 }));
      for (const n of nums) bins[Math.min(9, Math.floor(((n - min) / span) * 10))]!.count++;
      const decimals = nums.some((n) => !Number.isInteger(n));
      numeric = { min, max, mean: sum / nums.length, bins, decimals };
    }
  } else {
    // Grafias diferentes do mesmo valor ("SP", "sp", "S.P.", "São Paulo " → mesma chave).
    const groups = new Map<string, Map<string, number>>();
    for (const [v, n] of counts) {
      const k = looseKey(v);
      if (!k) continue;
      const g = groups.get(k) ?? new Map<string, number>();
      g.set(v, n);
      groups.set(k, g);
    }
    const variants = [...groups.values()].filter((g) => g.size > 1);
    if (variants.length) {
      const mapping: Record<string, string> = {};
      let affected = 0;
      for (const g of variants) {
        const [canonical] = [...g.entries()].sort((a, b) => b[1] - a[1])[0]!;
        for (const [v, n] of g) if (v !== canonical) [mapping[v], affected] = [canonical, affected + n];
      }
      problems.push({
        id: "grafias",
        message: `${variants.length} ${variants.length === 1 ? "valor escrito" : "valores escritos"} de jeitos diferentes (ex.: ${[...variants[0]!.keys()].slice(0, 3).map((v) => `"${v}"`).join(", ")})`,
        count: affected,
        fix: { label: "Unificar grafias", step: { op: "replace", column: name, map: mapping } },
      });
    }
    // CEP sem zero à esquerda.
    if (/cep/.test(normalizeName(name))) {
      const fixable = values.filter((v) => normalizeCep(v) !== null && normalizeCep(v) !== v.trim()).length;
      if (fixable) problems.push({ id: "cep", message: `${fixable} CEPs fora do padrão 00000-000`, count: fixable, fix: { label: "Padronizar CEP", step: { op: "cep", column: name } } });
    }
  }
  if (column.emptyRate > 0.3) {
    const empty = raw.length - values.length;
    problems.push({ id: "vazios", message: `${Math.round(column.emptyRate * 100)}% vazio`, count: empty, fix: { label: "Preencher vazios", step: { op: "fillEmpty", column: name, value: column.type === "number" ? "0" : "Sem informação" } } });
  }

  return { name, total: raw.length, empty: raw.length - values.length, distinct: counts.size, top, numeric, problems };
}
