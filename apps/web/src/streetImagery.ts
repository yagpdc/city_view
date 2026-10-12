/**
 * Fotos de rua da Mapillary (Meta): a imagem mais próxima de um ponto, direto do navegador.
 * Imagens sob CC BY-SA 4.0 — exibir sempre autor, licença e link para a imagem na Mapillary.
 * Termos comerciais (seção 12): proibido reidentificar/desborrar pessoas e placas.
 * Chave: token de cliente gratuito em VITE_MAPILLARY_TOKEN (apps/web/.env.local, fora do git).
 */

const TOKEN = import.meta.env.VITE_MAPILLARY_TOKEN as string | undefined;
const API = "https://graph.mapillary.com/images";
/** Raio da busca (~60 m) em graus de latitude; a longitude é corrigida pela latitude. */
const SEARCH_DEG = 0.00055;

export const streetImageryEnabled = Boolean(TOKEN);

export interface StreetImage {
  id: string;
  thumbUrl: string;
  capturedAt: Date | null;
  author: string | null;
  /** Distância até o ponto pedido, em metros (haversine; só para ordenar e exibir). */
  distanceM: number;
  pageUrl: string;
}

interface ApiImage {
  id: string;
  thumb_1024_url?: string;
  captured_at?: number;
  creator?: { username?: string };
  geometry?: { coordinates: [number, number] };
}

function haversineM([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(a));
}

const cache = new Map<string, Promise<StreetImage | null>>();

/** Foto de rua mais próxima (até ~60 m), ou null se não houver cobertura. */
export function nearestStreetImage([lon, lat]: [number, number]): Promise<StreetImage | null> {
  if (!TOKEN) return Promise.resolve(null);
  const key = `${lon.toFixed(5)},${lat.toFixed(5)}`;
  let pending = cache.get(key);
  if (!pending) {
    const dLon = SEARCH_DEG / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    const params = new URLSearchParams({
      fields: "id,thumb_1024_url,captured_at,creator,geometry",
      bbox: [lon - dLon, lat - SEARCH_DEG, lon + dLon, lat + SEARCH_DEG].map((v) => v.toFixed(6)).join(","),
      limit: "50",
    });
    pending = fetch(`${API}?${params}`, { headers: { Authorization: `OAuth ${TOKEN}` } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Mapillary respondeu ${res.status}`);
        const { data } = (await res.json()) as { data: ApiImage[] };
        const best = data
          .filter((img) => img.thumb_1024_url && img.geometry)
          .map((img) => ({ img, d: haversineM([lon, lat], img.geometry!.coordinates) }))
          .sort((a, b) => a.d - b.d)[0];
        if (!best) return null;
        return {
          id: best.img.id,
          thumbUrl: best.img.thumb_1024_url!,
          capturedAt: best.img.captured_at ? new Date(best.img.captured_at) : null,
          author: best.img.creator?.username ?? null,
          distanceM: best.d,
          pageUrl: `https://www.mapillary.com/app/?pKey=${best.img.id}`,
        };
      });
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return pending;
}
