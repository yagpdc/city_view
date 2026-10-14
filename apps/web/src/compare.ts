/** Comparações "seus registros ÷ uma grandeza do lugar" numa escala legível. */

export interface Comparison {
  id: string;
  /** Ex.: "População (IBGE 2022)", "PIB · 2010". */
  label: string;
  /** Unidade da grandeza (ex.: "Pessoas", "Mil Reais"). */
  unit: string;
  value: number;
}

/** O município de um ponto e as grandezas dele (IBGE + camadas da biblioteca no projeto). */
export interface PlaceFacts {
  name: string;
  kind: "municipio" | "raio";
  /** Código IBGE do município (7 dígitos), quando é um. */
  code?: string;
  population?: number;
  areaKm2: number;
  comparisons: Comparison[];
}

export interface Ratio {
  value: number;
  /** Ex.: "por 1.000 pessoas", "por R$ 1 milhão". */
  per: string;
}

const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/** Unidades monetárias "em mil" viram reais para a escala ficar natural. */
function normalize(value: number, unit: string): { value: number; unit: string; money: boolean } {
  const u = unit.toLowerCase();
  if (/mil reais|r\$ ?\(mil\)|reais \(mil\)/.test(u)) return { value: value * 1000, unit: "R$", money: true };
  if (/reais|r\$/.test(u)) return { value, unit: "R$", money: true };
  return { value, unit, money: false };
}

/** Escalas "redondas", do jeito que se fala: por 1, por mil, por milhão… */
const SCALES: { factor: number; label: string }[] = [
  { factor: 1, label: "1" },
  { factor: 1e3, label: int.format(1e3) },
  { factor: 1e6, label: "1 milhão" },
  { factor: 1e9, label: "1 bilhão" },
  { factor: 1e12, label: "1 trilhão" },
];

/**
 * count / value na menor escala redonda que deixa o número ≥ 1.
 * Ex.: 1,9 milhão de registros / 11,4 milhões de pessoas → 168 por 1.000 pessoas.
 */
export function ratio(count: number, comparison: Comparison): Ratio | null {
  const { value, unit, money } = normalize(comparison.value, comparison.unit);
  if (!(value > 0) || count <= 0) return null;
  const raw = count / value;
  const scale = SCALES.find((s) => raw * s.factor >= 1) ?? SCALES.at(-1)!;
  const per = money ? `por R$ ${scale.label}` : `por ${scale.label}${unit ? ` ${unit.toLowerCase()}` : ""}`;
  return { value: raw * scale.factor, per };
}
