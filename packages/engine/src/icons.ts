/** Lado do ícone na tela, em pixels (rasterizado em 2× para telas densas). */
const ICON_PX = 16;
export const ICON_PIXEL_RATIO = 2;

/**
 * Rasteriza um SVG de traço (ex.: Lucide) em branco, para desenhar por cima do círculo colorido do ponto.
 * Devolve null se o SVG não carregar.
 */
export async function rasterizeIcon(svg: string): Promise<ImageData | null> {
  const size = ICON_PX * ICON_PIXEL_RATIO;
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName !== "svg") return null;
  root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  root.setAttribute("width", String(size));
  root.setAttribute("height", String(size));
  // Traço branco, qualquer que seja a cor de origem (Lucide usa currentColor).
  root.setAttribute("color", "#ffffff");
  root.setAttribute("stroke", "#ffffff");
  root.setAttribute("stroke-width", "2.25");
  const img = new Image(size, size);
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
  ctx.drawImage(img, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size);
}
