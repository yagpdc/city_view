/**
 * Anotações: o que a pessoa desenha e escreve sobre o mapa para montar uma estratégia (traço livre, linha, área,
 * texto, alfinete com nota). São dados do usuário: ficam no navegador, com a aba (ADR 0002), e vão no link.
 * Cada ferramenta é "operada" por um personagem da turma (docs/DESIGN.md · Personagens).
 */
import type { AgentKind } from "../components/Agents";

/** Ferramentas da barra. "off" = sem desenhar (anotações só à mostra). */
export type AnnotationTool = "off" | "select" | "freehand" | "line" | "polygon" | "rectangle" | "circle" | "text" | "pin";

/** Modo do Terra Draw de cada ferramenta de desenho. */
export const TOOL_MODE: Record<Exclude<AnnotationTool, "off">, string> = {
  select: "select",
  freehand: "freehand-linestring",
  line: "linestring",
  polygon: "polygon",
  rectangle: "rectangle",
  circle: "circle",
  text: "point",
  pin: "point",
};

/** Cores das anotações: as dos personagens, num tom que lê bem sobre o mapa, e a tinta. */
export const ANNOTATION_COLORS: { id: string; label: string; hex: string }[] = [
  { id: "lilac", label: "Lilás", hex: "#8b7cf6" },
  { id: "sky", label: "Céu", hex: "#3d8fe0" },
  { id: "mint", label: "Menta", hex: "#2fae76" },
  { id: "peach", label: "Pêssego", hex: "#ee7a37" },
  { id: "lemon", label: "Limão", hex: "#d9a70b" },
  { id: "pink", label: "Rosa", hex: "#e45d93" },
  { id: "ink", label: "Tinta", hex: "#1d1e24" },
];

/** Ferramentas na ordem da barra: quem opera, nome, dica e a cor inicial do que ela desenha. */
export const TOOLS: { tool: Exclude<AnnotationTool, "off" | "select" | "rectangle" | "circle">; agent: AgentKind; label: string; hint: string; color: string }[] = [
  { tool: "freehand", agent: "bolha", label: "Traço livre", hint: "desenha à mão: segure e arraste, ou clique para começar e clique para terminar.", color: "#ee7a37" },
  { tool: "line", agent: "hexa", label: "Linha", hint: "traça rotas: clique ponto a ponto, duplo clique para terminar.", color: "#2fae76" },
  { tool: "polygon", agent: "quadra", label: "Área", hint: "marca áreas e já conta o que tem dentro. Livre: clique ponto a ponto; retângulo e círculo: arraste.", color: "#3d8fe0" },
  { tool: "text", agent: "lume", label: "Texto", hint: "escreve no mapa: clique onde quer o texto.", color: "#1d1e24" },
  { tool: "pin", agent: "pino", label: "Alfinete", hint: "marca um lugar com uma nota.", color: "#8b7cf6" },
];

/** Formatos da ferramenta Área. */
export const AREA_SHAPES: { tool: "polygon" | "rectangle" | "circle"; label: string }[] = [
  { tool: "polygon", label: "Livre" },
  { tool: "rectangle", label: "Retângulo" },
  { tool: "circle", label: "Círculo" },
];

export interface AnnotationProps {
  /** Modo do Terra Draw que criou a feição (obrigatório para ele editar). */
  mode: string;
  color: string;
  /** Texto (ferramenta Texto) ou título (alfinete, área, linha). */
  label?: string;
  /** Nota do alfinete. */
  note?: string;
  /** Ponto que é texto ou alfinete. */
  kind?: "text" | "pin";
  /** Ferramenta que criou (para reabrir com o mesmo personagem). */
  tool?: AnnotationTool;
  [key: string]: unknown;
}

export type AnnotationGeometry = GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon;
export type AnnotationFeature = GeoJSON.Feature<AnnotationGeometry, AnnotationProps> & { id: string | number };

/** Uma área (polígono, retângulo, círculo) calcula o que tem dentro. */
export const isArea = (f: AnnotationFeature) => f.geometry.type === "Polygon";

/** Personagem de uma anotação já desenhada. */
export function agentOf(f: AnnotationFeature): AgentKind {
  if (f.properties.kind === "text") return "lume";
  if (f.properties.kind === "pin") return "pino";
  if (f.geometry.type === "Polygon") return "quadra";
  return f.properties.mode === "freehand-linestring" ? "bolha" : "hexa";
}

/** Nome do tipo de anotação, para cartões e listas. */
export function kindLabel(f: AnnotationFeature): string {
  if (f.properties.kind === "text") return "Texto";
  if (f.properties.kind === "pin") return "Alfinete";
  if (f.properties.mode === "circle") return "Círculo";
  if (f.properties.mode === "rectangle") return "Retângulo";
  if (f.geometry.type === "Polygon") return "Área";
  return f.properties.mode === "freehand-linestring" ? "Traço livre" : "Linha";
}

/** Tira o que é do editor e não da pessoa (alças de seleção, pontos do meio) de uma lista de feições. */
export function cleanAnnotations<T extends { properties: Record<string, unknown> | null }>(features: T[]): T[] {
  return features.filter((f) => {
    const p = f.properties;
    if (!p || p.mode === "select" || p.selectionPoint || p.midPoint) return false;
    // Ponto só é anotação quando é alfinete ou texto (modo "point"); os outros são marcadores internos do editor
    // (início do traço livre, ponto em edição).
    const geometry = (f as { geometry?: { type?: string } }).geometry;
    return geometry?.type !== "Point" || p.mode === "point";
  });
}
