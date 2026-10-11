/**
 * Hexágonos de uma área no maior detalhe que couber, lidos direto do PMTiles.
 *
 * O mapa carrega tiles conforme o zoom da câmera — para uma cidade inteira na tela isso dá
 * poucos hexágonos grandes. Na maquete queremos o relevo pintado com detalhe e uma soma
 * exata, então buscamos os tiles de um zoom bem mais alto só para o retângulo da área.
 */
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import type { PMTiles } from "pmtiles";
import { areaBounds, pointInArea, ringCentroid, type AreaGeometry, type Bounds } from "./geo";

export interface HexFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
  properties: Record<string, number>;
}

/** Limite de tiles buscados por área (todos pequenos; vêm por Range do mesmo arquivo). */
const MAX_TILES = 144;

const lonToTile = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
function latToTile(lat: number, z: number): number {
  const r = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z);
}

function tileRange([w, s, e, n]: Bounds, z: number) {
  return { x0: lonToTile(w, z), x1: lonToTile(e, z), y0: latToTile(n, z), y1: latToTile(s, z) };
}

/** Zoom mais alto (≤ maxZoom) em que a área cabe em até MAX_TILES tiles. */
export function pickZoom(bounds: Bounds, maxZoom: number): number {
  for (let z = maxZoom; z > 0; z--) {
    const r = tileRange(bounds, z);
    if ((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) <= MAX_TILES) return z;
  }
  return 0;
}

export async function loadAreaHexes(
  pmtiles: PMTiles,
  area: AreaGeometry,
  maxZoom: number,
): Promise<{ zoom: number; features: HexFeature[] }> {
  const bounds = areaBounds(area);
  const zoom = pickZoom(bounds, maxZoom);
  const { x0, x1, y0, y1 } = tileRange(bounds, zoom);
  const jobs: Promise<HexFeature[]>[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      jobs.push(
        pmtiles.getZxy(zoom, x, y).then((res) => {
          if (!res) return [];
          const layer = new VectorTile(new PbfReader(new Uint8Array(res.data))).layers.hex;
          if (!layer) return [];
          const out: HexFeature[] = [];
          for (let i = 0; i < layer.length; i++) {
            const g = layer.feature(i).toGeoJSON(x, y, zoom) as unknown as HexFeature;
            if (g.geometry.type !== "Polygon") continue;
            // Objetos simples (o worker do MapLibre não aceita as instâncias do decodificador).
            out.push({
              type: "Feature",
              geometry: { type: "Polygon", coordinates: g.geometry.coordinates.map((r) => r.map(([lon, lat]) => [lon, lat])) },
              properties: { ...g.properties },
            });
          }
          return out;
        }),
      );
    }
  }
  // Hexágonos na borda de tiles aparecem repetidos: um por centro. Só os de dentro da área.
  const unique = new Map<string, HexFeature>();
  for (const f of (await Promise.all(jobs)).flat()) {
    const c = ringCentroid(f.geometry.coordinates[0]!);
    const key = `${c[0].toFixed(5)},${c[1].toFixed(5)}`;
    if (!unique.has(key) && pointInArea(c, area)) unique.set(key, f);
  }
  return { zoom, features: [...unique.values()] };
}
