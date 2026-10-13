/**
 * Juntar planilhas: chave tolerante, índice por coluna, sugestão de qual coluna casa com qual e o
 * balanço (quantas linhas casaram). Usado pelos passos "join" e "append" da receita.
 */
import type { Row } from "./detect";
import { isEmpty, normalizeName } from "./values";

/**
 * Chave de junção: sem acentos, caixa, espaços e pontuação; só dígitos → sem zeros à esquerda (o Excel costuma
 * comer os zeros de CNPJ, CEP e códigos).
 */
export function joinKey(v: string | undefined): string {
  if (isEmpty(v)) return "";
  const k = normalizeName(v!).replace(/_/g, "");
  return /^\d+$/.test(k) ? k.replace(/^0+(?=\d)/, "") : k;
}

const indexes = new WeakMap<Row[], Map<string, Map<string, Row[]>>>();

/** Índice chave → linhas de uma coluna da outra planilha (montado uma vez por tabela e coluna). */
export function joinIndex(rows: Row[], column: string): Map<string, Row[]> {
  let byColumn = indexes.get(rows);
  if (!byColumn) indexes.set(rows, (byColumn = new Map()));
  let index = byColumn.get(column);
  if (!index) {
    index = new Map();
    for (const r of rows) {
      const k = joinKey(r[column]);
      if (!k) continue;
      const list = index.get(k);
      if (list) list.push(r);
      else index.set(k, [r]);
    }
    byColumn.set(column, index);
  }
  return index;
}

export interface JoinStats {
  total: number;
  /** Linhas desta planilha que acharam par na outra. */
  matched: number;
  /** Das que acharam, quantas acharam mais de uma linha. */
  multiple: number;
  /** Sem valor na coluna-chave. */
  emptyKey: number;
  /** Exemplos de chaves que não acharam par (para a pessoa entender por quê). */
  missingExamples: string[];
}

export function joinStats(rows: Row[], key: string, other: Row[], otherKey: string): JoinStats {
  const index = joinIndex(other, otherKey);
  const stats: JoinStats = { total: rows.length, matched: 0, multiple: 0, emptyKey: 0, missingExamples: [] };
  for (const r of rows) {
    const k = joinKey(r[key]);
    if (!k) {
      stats.emptyKey++;
      continue;
    }
    const hits = index.get(k);
    if (hits) {
      stats.matched++;
      if (hits.length > 1) stats.multiple++;
    } else if (stats.missingExamples.length < 5) stats.missingExamples.push(r[key]!.trim());
  }
  return stats;
}

/**
 * Qual coluna desta casa com qual da outra: a dupla em que mais valores desta aparecem na outra (na amostra).
 * Ignora colunas com poucos valores diferentes (sim/não, UF), que casariam por acaso.
 */
export function suggestJoinKeys(
  rows: Row[],
  headers: string[],
  other: Row[],
  otherHeaders: string[],
): { key: string; otherKey: string; score: number } | null {
  const sample = rows.slice(0, 2000);
  const otherSample = other.slice(0, 20000);
  const keysOf = (list: Row[], col: string) => {
    const set = new Set<string>();
    for (const r of list) {
      const k = joinKey(r[col]);
      if (k) set.add(k);
    }
    return set;
  };
  const enough = (set: Set<string>, n: number) => set.size >= Math.min(20, n * 0.5);
  const otherSets = otherHeaders.map((h) => ({ h, set: keysOf(otherSample, h) })).filter((o) => enough(o.set, otherSample.length));
  let best: { key: string; otherKey: string; score: number } | null = null;
  for (const h of headers) {
    const mine = keysOf(sample, h);
    if (!enough(mine, sample.length)) continue;
    for (const o of otherSets) {
      let hit = 0;
      for (const k of mine) if (o.set.has(k)) hit++;
      // Mesmo nome de coluna desempata.
      const score = hit / mine.size + (normalizeName(h) === normalizeName(o.h) ? 0.05 : 0);
      if (hit > 0 && (!best || score > best.score)) best = { key: h, otherKey: o.h, score };
    }
  }
  return best && best.score >= 0.1 ? best : null;
}

const ALIASES: string[][] = [
  ["latitude", "lat", "y"],
  ["longitude", "lon", "lng", "long", "x"],
  ["nome", "name", "razao_social", "titulo"],
  ["endereco", "logradouro", "address", "rua"],
  ["cidade", "municipio", "city"],
  ["uf", "estado", "state"],
  ["cep", "codigo_postal", "zip"],
];

/**
 * Coluna da outra planilha → coluna desta, pelo nome (com sinônimos comuns). Sem par, vira coluna nova com o
 * mesmo nome (as linhas desta ficam vazias nela).
 */
export function suggestAppendMap(headers: string[], otherHeaders: string[]): Record<string, string> {
  const byName = new Map(headers.map((h) => [normalizeName(h), h]));
  const map: Record<string, string> = {};
  for (const o of otherHeaders) {
    const n = normalizeName(o);
    let target = byName.get(n);
    if (!target) target = ALIASES.find((g) => g.includes(n))?.map((a) => byName.get(a)).find(Boolean);
    map[o] = target ?? o;
  }
  return map;
}
