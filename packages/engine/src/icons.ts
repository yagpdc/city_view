/** Diâmetro do marcador na tela, em pixels (rasterizado em 2× para telas densas). */
const MARKER_PX = 24;
export const ICON_PIXEL_RATIO = 2;

/**
 * Marcador de ponto: círculo da cor da categoria, anel branco e um ícone de traço (ex.: Lucide) em branco.
 * Devolve null se o SVG não carregar.
 */
export async function rasterizeMarker(svg: string, color: string): Promise<ImageData | null> {
  const size = MARKER_PX * ICON_PIXEL_RATIO;
  const glyph = Math.round(size * 0.56);
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName !== "svg") return null;
  root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  root.setAttribute("width", String(glyph));
  root.setAttribute("height", String(glyph));
  // Traço branco, qualquer que seja a cor de origem (Lucide usa currentColor).
  root.setAttribute("color", "#ffffff");
  root.setAttribute("stroke", "#ffffff");
  root.setAttribute("stroke-width", "2.25");
  const img = new Image(glyph, glyph);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const c = size / 2;
  const ring = 2 * ICON_PIXEL_RATIO;
  // Sombra leve separa o marcador do mapa e dos vizinhos.
  ctx.shadowColor = "rgba(20, 24, 33, 0.28)";
  ctx.shadowBlur = 2 * ICON_PIXEL_RATIO;
  ctx.shadowOffsetY = 0.5 * ICON_PIXEL_RATIO;
  ctx.beginPath();
  ctx.arc(c, c, c - ring, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.beginPath();
  ctx.arc(c, c, c - ring * 1.75, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.drawImage(img, c - glyph / 2, c - glyph / 2, glyph, glyph);
  return ctx.getImageData(0, 0, size, size);
}
