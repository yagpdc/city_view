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
  | { mode: "value"; column: string; palette: PaletteName };

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

/** Metros por pixel no zoom 0 (tiles de 512 px) na latitude dada. */
export function metersPerPixelAtZoom0(lat: number): number {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 512;
}

/** Cópia validada (estilo vindo de arquivo ou de versão antiga). */
export function normalizeDataStyle(raw: unknown): DataStyle {
  const s = (raw ?? {}) as Partial<DataStyle>;
  const shapes: DataShape[] = ["points", "circles", "squares", "heatmap", "hex", "regions"];
  const shape = shapes.includes(s.shape as DataShape) ? (s.shape as DataShape) : "points";
  const color: DataColor =
    s.color?.mode === "single" && typeof s.color.value === "string"
      ? { mode: "single", value: s.color.value }
      : s.color?.mode === "value" && typeof s.color.column === "string"
        ? { mode: "value", column: s.color.column, palette: typeof s.color.palette === "string" && s.color.palette in PALETTES ? s.color.palette : "densidade" }
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
  };
}
