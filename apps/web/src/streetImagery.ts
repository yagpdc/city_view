/**
 * Fotos de rua da Mapillary (Meta): a imagem mais próxima de um ponto, direto do navegador.
 * Imagens sob CC BY-SA 4.0 — exibir sempre autor, licença e link para a imagem na Mapillary.
 * Termos comerciais (seção 12): proibido reidentificar/desborrar pessoas e placas.
 * Chave: token de cliente gratuito em VITE_MAPILLARY_TOKEN (apps/web/.env.local, fora do git).
 */

import type { MapOverlay } from "@cityview/engine";

const TOKEN = import.meta.env.VITE_MAPILLARY_TOKEN as string | undefined;
const API = "https://graph.mapillary.com/images";
/** Raio da busca (~60 m) em graus de latitude; a longitude é corrigida pela latitude. */
const SEARCH_DEG = 0.00055;

export const streetImageryEnabled = Boolean(TOKEN);

export interface StreetImage {
  id: string;
  thumbUrl: string;
  /** Versão grande (2048 px), para a foto ampliada; cai na de 1024 se não houver. */
  largeUrl: string;
  capturedAt: Date | null;
  author: string | null;
  /** Distância até o ponto pedido, em metros (haversine; só para ordenar e exibir). */
  distanceM: number;
  pageUrl: string;
}

interface ApiImage {
  id: string;
  thumb_1024_url?: string;
  thumb_2048_url?: string;
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

/**
 * A busca por área da Mapillary às vezes volta vazia ou incompleta para a mesma consulta;
 * tenta até 3 vezes e junta o que vier.
 */
async function searchImages(params: URLSearchParams): Promise<ApiImage[]> {
  // As tentativas vão juntas (antes, uma depois da outra: em rua com pouca foto eram três esperas seguidas).
  const attempt = async () => {
    const res = await fetch(`${API}?${params}`, { headers: { Authorization: `OAuth ${TOKEN}` } });
    if (!res.ok) throw new Error(`Mapillary respondeu ${res.status}`);
    return ((await res.json()) as { data: ApiImage[] }).data;
  };
  const results = await Promise.allSettled([attempt(), attempt()]);
  const ok = results.filter((r): r is PromiseFulfilledResult<ApiImage[]> => r.status === "fulfilled");
  if (ok.length === 0) throw (results[0] as PromiseRejectedResult).reason;
  const found = new Map<string, ApiImage>();
  for (const r of ok) for (const img of r.value) found.set(img.id, img);
  return [...found.values()];
}

/** Posições de fotos já carregadas no mapa (tiles da camada "Fotos de rua"): id e onde. */
type LocalImages = (lngLat: [number, number]) => { id: string; lngLat: [number, number] }[];
let localImages: LocalImages | null = null;

/** O app informa onde ler as fotos já carregadas no mapa (busca instantânea, sem esperar a API). */
export function setLocalStreetImages(fn: LocalImages | null): void {
  localImages = fn;
}

const MAX_DISTANCE_M = 60;

/** Uma foto pelo id (consulta rápida, ao contrário da busca por área). */
async function imageById(id: string): Promise<ApiImage | null> {
  const res = await fetch(`https://graph.mapillary.com/${id}?fields=id,thumb_1024_url,thumb_2048_url,captured_at,creator,geometry`, {
    headers: { Authorization: `OAuth ${TOKEN}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as ApiImage;
}

function toStreetImage(img: ApiImage, d: number): StreetImage {
  return {
    id: img.id,
    thumbUrl: img.thumb_1024_url!,
    largeUrl: img.thumb_2048_url ?? img.thumb_1024_url!,
    capturedAt: img.captured_at ? new Date(img.captured_at) : null,
    author: img.creator?.username ?? null,
    distanceM: d,
    pageUrl: `https://www.mapillary.com/app/?pKey=${img.id}`,
  };
}

/**
 * Foto mais próxima entre as já carregadas no mapa: só pede à API aquela foto (rápido). null = não há posição
 * carregada por perto (camada desligada ou fora da área) e quem chama usa a busca por área.
 */
async function nearestLocal([lon, lat]: [number, number]): Promise<StreetImage | null> {
  if (!localImages) return null;
  const best = localImages([lon, lat])
    .map((c) => ({ c, d: haversineM([lon, lat], c.lngLat) }))
    .filter((x) => x.d <= MAX_DISTANCE_M)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  for (const { c, d } of best) {
    const img = await imageById(c.id).catch(() => null);
    if (img?.thumb_1024_url) return toStreetImage(img, d);
  }
  return null;
}

/** Foto de rua mais próxima (até ~60 m), ou null se não houver cobertura. */
export function nearestStreetImage([lon, lat]: [number, number]): Promise<StreetImage | null> {
  if (!TOKEN) return Promise.resolve(null);
  const key = `${lon.toFixed(5)},${lat.toFixed(5)}`;
  let pending = cache.get(key);
  if (!pending) {
    const dLon = SEARCH_DEG / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    const params = new URLSearchParams({
      fields: "id,thumb_1024_url,thumb_2048_url,captured_at,creator,geometry",
      bbox: [lon - dLon, lat - SEARCH_DEG, lon + dLon, lat + SEARCH_DEG].map((v) => v.toFixed(6)).join(","),
      limit: "50",
    });
    // Primeiro nas posições já carregadas no mapa (rápido); sem elas, a busca por área (lenta: 4–6 s na API).
    pending = nearestLocal([lon, lat]).then(
      (local) =>
        local ??
        searchImages(params).then((data) => {
          const best = data
            .filter((img) => img.thumb_1024_url && img.geometry)
            .map((img) => ({ img, d: haversineM([lon, lat], img.geometry!.coordinates) }))
            .sort((a, b) => a.d - b.d)[0];
          return best ? toStreetImage(best.img, best.d) : null;
        }),
    );
    // "Sem foto" não fica em cache: a busca da Mapillary oscila e outra tentativa pode achar.
    pending.then((r) => r === null && cache.delete(key), () => {});
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return pending;
}

/** Token para o visualizador (MapillaryJS) e para a camada de cobertura. */
export const MAPILLARY_TOKEN = TOKEN ?? "";

const COVERAGE_COLOR = "#05cb63";

/** Camada "onde há foto de rua": linhas das sequências e pontos das fotos (tiles vetoriais da Mapillary). */
export function coverageOverlay(): MapOverlay {
  const source = "mapillary";
  return {
    id: source,
    source: {
      type: "vector",
      tiles: [`https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token=${TOKEN}`],
      minzoom: 0,
      maxzoom: 14,
      attribution: '<a href="https://www.mapillary.com">Fotos de rua: © Mapillary (CC BY-SA)</a>',
    },
    layers: [
      {
        id: "mapillary-overview",
        type: "circle",
        source,
        "source-layer": "overview",
        maxzoom: 6,
        paint: { "circle-radius": 2, "circle-color": COVERAGE_COLOR, "circle-opacity": 0.6 },
      },
      {
        id: "mapillary-sequences",
        type: "line",
        source,
        "source-layer": "sequence",
        minzoom: 6,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": COVERAGE_COLOR,
          // Camada ligada por padrão: discreta, para não brigar com os dados.
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 14, 1.2, 18, 2],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 15, 0.45],
        },
      },
      {
        id: "mapillary-images",
        type: "circle",
        source,
        "source-layer": "image",
        minzoom: 17,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 17, 1.5, 19, 3],
          "circle-color": COVERAGE_COLOR,
          "circle-opacity": 0.6,
        },
      },
    ],
  };
}
