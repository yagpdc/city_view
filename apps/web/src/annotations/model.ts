/**
 * Anotações: o que a pessoa desenha, escreve, pinta e cola sobre o mapa para montar uma estratégia (traço, área,
 * rua ou prédio pintado, texto, alfinete com nota e foto, imagem sobreposta). São dados do usuário: ficam no
 * navegador, com a aba (ADR 0002), e vão no link (as fotos não: ficam só neste navegador).
 * Cada ferramenta é "operada" por um personagem da turma (docs/DESIGN.md · Personagens).
 */
import type { AgentKind } from "../components/Agents";

/** Ferramentas da barra. "off" = sem desenhar (anotações só à mostra). */
export type AnnotationTool = "off" | "select" | "freehand" | "line" | "polygon" | "rectangle" | "circle" | "paint" | "text" | "pin" | "image";

/** Modo do Terra Draw de cada ferramenta. Pintar é do app (clique na rua ou no prédio); imagem entra pronta. */
export const TOOL_MODE: Record<Exclude<AnnotationTool, "off">, string> = {
  select: "select",
  freehand: "freehand-linestring",
  line: "linestring",
  polygon: "polygon",
  rectangle: "rectangle",
  circle: "circle",
  paint: "static",
  text: "point",
  pin: "point",
  image: "select",
};

/** Ferramentas em que arrastar desenha (o mapa para de se mover enquanto estão na mão). */
export const DRAG_TOOLS: AnnotationTool[] = ["freehand", "line", "polygon", "rectangle", "circle", "text", "pin"];

/** Modo do Terra Draw da imagem sobreposta: quatro cantos arrastáveis, sem pontos novos. */
export const IMAGE_MODE = "image-quad";

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

type ToolDef = { tool: "freehand" | "polygon" | "paint" | "text" | "pin"; agent: AgentKind; label: string; hint: string; color: string };

/** Ferramentas da turma, na ordem da doca: quem opera, nome, dica e a cor inicial do que ela faz. */
export const TOOLS: ToolDef[] = [
  { tool: "freehand", agent: "bolha", label: "Traço", hint: "desenha à mão (segure e arraste) ou reto, ponto a ponto (duplo clique termina).", color: "#ee7a37" },
  { tool: "polygon", agent: "hexa", label: "Área", hint: "marca áreas e já conta o que tem dentro. Livre: clique ponto a ponto; retângulo e círculo: arraste.", color: "#2fae76" },
  { tool: "paint", agent: "quadra", label: "Pintar", hint: "pinta ruas e prédios: clique numa rua (pinta ela inteira, no que está na tela) ou num prédio.", color: "#e45d93" },
  { tool: "text", agent: "lume", label: "Texto", hint: "escreve no mapa: clique onde quer o texto.", color: "#1d1e24" },
  { tool: "pin", agent: "pinny", label: "Alfinete", hint: "marca um lugar com nota e foto.", color: "#8b7cf6" },
];

/** A que ferramenta da doca pertence cada ferramenta (traço reto é da Bolha; retângulo e círculo, da Hexa). */
export function toolGroup(tool: AnnotationTool): ToolDef | undefined {
  const group = tool === "line" ? "freehand" : tool === "rectangle" || tool === "circle" ? "polygon" : tool;
  return TOOLS.find((t) => t.tool === group);
}

/** Formatos do Traço. */
export const LINE_SHAPES: { tool: "freehand" | "line"; label: string }[] = [
  { tool: "freehand", label: "À mão" },
  { tool: "line", label: "Reto" },
];

/** Formatos da Área. */
export const AREA_SHAPES: { tool: "polygon" | "rectangle" | "circle"; label: string }[] = [
  { tool: "polygon", label: "Livre" },
  { tool: "rectangle", label: "Retângulo" },
  { tool: "circle", label: "Círculo" },
];

export interface AnnotationProps {
  /** Modo do Terra Draw que criou a feição (obrigatório para ele editar); "paint" = rua/prédio pintado. */
  mode: string;
  color: string;
  /** Texto (ferramenta Texto) ou título (alfinete, área, traço, rua). */
  label?: string;
  /** Nota do alfinete. */
  note?: string;
  /** Ponto que é texto ou alfinete; rua/prédio pintado; imagem sobreposta. */
  kind?: "text" | "pin" | "paint" | "image";
  /** Rua ou prédio (pintar). */
  paint?: "road" | "building";
  /** Altura do prédio pintado, em metros. */
  height?: number;
  /** Foto do alfinete ou imagem sobreposta (id no armazenamento deste navegador). */
  photo?: string;
  /** Opacidade da imagem sobreposta (0–1, em texto). */
  opacity?: string;
  /** Ferramenta que criou (para reabrir com o mesmo personagem). */
  tool?: AnnotationTool;
  [key: string]: unknown;
}

export type AnnotationGeometry = GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon | GeoJSON.MultiLineString | GeoJSON.MultiPolygon;
export type AnnotationFeature = GeoJSON.Feature<AnnotationGeometry, AnnotationProps> & { id: string | number };

/** Feito pelo app, não pelo editor de desenho (rua e prédio pintados). */
export const isPainted = (f: AnnotationFeature) => f.properties.kind === "paint";
export const isImage = (f: AnnotationFeature) => f.properties.kind === "image";

/** Área que calcula o que tem dentro (polígono, retângulo, círculo). */
export const isArea = (f: AnnotationFeature) => f.geometry.type === "Polygon" && !f.properties.kind;

/** Personagem de uma anotação já feita. */
export function agentOf(f: AnnotationFeature): AgentKind {
  const k = f.properties.kind;
  if (k === "text") return "lume";
  if (k === "pin" || k === "image") return "pinny";
  if (k === "paint") return "quadra";
  if (f.geometry.type === "Polygon") return "hexa";
  return "bolha";
}

/** Nome do tipo de anotação, para cartões e listas. */
export function kindLabel(f: AnnotationFeature): string {
  const k = f.properties.kind;
  if (k === "text") return "Texto";
  if (k === "pin") return "Alfinete";
  if (k === "image") return "Imagem";
  if (k === "paint") return f.properties.paint === "building" ? "Prédio pintado" : "Rua pintada";
  if (f.properties.mode === "circle") return "Círculo";
  if (f.properties.mode === "rectangle") return "Retângulo";
  if (f.geometry.type === "Polygon") return "Área";
  return f.properties.mode === "freehand-linestring" ? "Traço à mão" : "Traço reto";
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
