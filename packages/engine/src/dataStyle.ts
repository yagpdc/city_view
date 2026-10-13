/**
 * Estilo de uma camada de dados, escolhido no editor de estilo: a forma (pontos, círculos ou quadrados com
 * tamanho real no chão, mancha de calor, hexágonos, regiões), a cor, o tamanho e o resto. Serializável (JSON):
 * fica na aba do app e pode ser baixado e aplicado em outra camada.
 */

export type DataShape = "points" | "circles" | "squares" | "heatmap" | "hex" | "regions";

export type DataColor =
  | { mode: "category" }
  | { mode: "single"; value: string }
  /** Degradê pelo valor de uma coluna de número. */
  | { mode: "value"; column: string; palette: PaletteName }
  /** Faixas de valor ("até 50 mil", "50 a 200 mil"…): quebras guardadas no estilo (a legenda não muda sozinha). */
  | { mode: "classes"; column: string; palette: PaletteName; method: ClassMethod; breaks: number[] };

export type ClassMethod = "quantile" | "equal" | "manual";

export interface DataStyle {
  version: 1;
  shape: DataShape;
  /**
   * Pontos: raio em px (no zoom de rua). Círculos: raio em metros. Quadrados: lado em metros.
   * Mancha de calor: raio em px. Hexágonos e regiões: não usa.
   */
  size: number;
  /** Tamanho proporcional a uma coluna de número (de metade ao dobro do tamanho). */
  sizeBy?: string | null;
  color: DataColor;
  /** 0–1. */
  opacity: number;
  /** Contorno claro em volta (separa vizinhos). */
  stroke: boolean;
  /** Nomes e marcadores ao aproximar. */
  labels: boolean;
  /** Categorias em destaque (índices); as outras ficam cinza e apagadas. Vazio/ausente = todas normais. */
  highlight?: number[] | null;
}

export const DEFAULT_DATA_STYLE: DataStyle = { version: 1, shape: "points", size: 4.5, color: { mode: "category" }, opacity: 1, stroke: true, labels: true };

/** Tamanho inicial de cada forma quando a pessoa troca de forma no editor. */
export const SHAPE_DEFAULT_SIZE: Record<DataShape, number> = { points: 4.5, circles: 250, squares: 300, heatmap: 18, hex: 0, regions: 0 };

export const PALETTES = {
  densidade: ["#fff3bf", "#ffd43b", "#fd7e14", "#e8590c", "#d6336c", "#ae3ec9", "#5f3dc4"],
  azul: ["#e7f0ff", "#a5c8ff", "#5c9cff", "#2f6fd6", "#1d4fa8", "#13357a"],
  verde: ["#ecfdf3", "#a7f3c5", "#4fd18b", "#1f9d5c", "#11743f", "#0b4f2b"],
  calor: ["#fff7bc", "#fec44f", "#fe9929", "#ec7014", "#cc4c02", "#8c2d04"],
  divergente: ["#b2182b", "#ef8a62", "#fddbc7", "#f7f7f7", "#d1e5f0", "#67a9cf", "#2166ac"],
} as const;
export type PaletteName = keyof typeof PALETTES;
export const PALETTE_LABELS: Record<PaletteName, string> = { densidade: "Densidade", azul: "Azul", verde: "Verde", calor: "Calor", divergente: "Divergente" };

/** `n` cores tiradas da paleta (espaçadas), para `n` faixas. */
export function classColors(palette: PaletteName, n: number): string[] {
  const pal = PALETTES[palette];
  if (n <= 1) return [pal[Math.floor(pal.length / 2)]!];
  return Array.from({ length: n }, (_, i) => pal[Math.round((i * (pal.length - 1)) / (n - 1))]!);
}

/** Quebras entre faixas: `classes - 1` valores. Quantis precisam dos valores; intervalos iguais, só do mínimo e do máximo. */
export function classBreaks(method: ClassMethod, classes: number, range: { min: number; max: number }, values: number[] = []): number[] {
  const nice = (v: number) => {
    const mag = 10 ** Math.max(0, Math.floor(Math.log10(Math.abs(v) || 1)) - 1);
    return Math.round(v / mag) * mag;
  };
  let out: number[];
  if (method === "quantile" && values.length >= classes) {
    const sorted = [...values].sort((a, b) => a - b);
    out = Array.from({ length: classes - 1 }, (_, i) => sorted[Math.floor(((i + 1) * sorted.length) / classes)]!);
  } else {
    out = Array.from({ length: classes - 1 }, (_, i) => range.min + ((range.max - range.min) * (i + 1)) / classes);
  }
  return [...new Set(out.map(nice))].sort((a, b) => a - b);
}

/** Metros por pixel no zoom 0 (tiles de 512 px) na latitude dada. */
export function metersPerPixelAtZoom0(lat: number): number {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 512;
}

/** Cópia validada (estilo vindo de arquivo ou de versão antiga). */
export function normalizeDataStyle(raw: unknown): DataStyle {
  const s = (raw ?? {}) as Partial<DataStyle>;
  const shapes: DataShape[] = ["points", "circles", "squares", "heatmap", "hex", "regions"];
  const shape = shapes.includes(s.shape as DataShape) ? (s.shape as DataShape) : "points";
  const palette = (p: unknown): PaletteName => (typeof p === "string" && p in PALETTES ? (p as PaletteName) : "densidade");
  const c = s.color as Partial<Record<string, unknown>> | undefined;
  const color: DataColor =
    c?.mode === "single" && typeof c.value === "string"
      ? { mode: "single", value: c.value }
      : c?.mode === "value" && typeof c.column === "string"
        ? { mode: "value", column: c.column, palette: palette(c.palette) }
        : c?.mode === "classes" && typeof c.column === "string" && Array.isArray(c.breaks)
          ? {
              mode: "classes",
              column: c.column,
              palette: palette(c.palette),
              method: c.method === "equal" || c.method === "manual" ? c.method : "quantile",
              breaks: (c.breaks as unknown[]).filter((b): b is number => typeof b === "number" && Number.isFinite(b)).sort((a, b) => a - b),
            }
          : { mode: "category" };
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    version: 1,
    shape,
    size: Math.max(0, num(s.size, SHAPE_DEFAULT_SIZE[shape])),
    sizeBy: typeof s.sizeBy === "string" ? s.sizeBy : null,
    color,
    opacity: Math.min(1, Math.max(0.05, num(s.opacity, 1))),
    stroke: s.stroke !== false,
    labels: s.labels !== false,
    ...(Array.isArray(s.highlight) && s.highlight.length ? { highlight: s.highlight.filter((i) => Number.isInteger(i)) } : {}),
  };
}
