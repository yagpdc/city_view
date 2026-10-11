import { layers, namedFlavor } from "@protomaps/basemaps";
import type {
  FillExtrusionLayerSpecification,
  LayerSpecification,
  StyleSpecification,
} from "maplibre-gl";

export type Theme = "light" | "dark";

export interface StyleOptions {
  /** URL do arquivo PMTiles do mapa base (Protomaps). */
  basemapUrl: string;
  /** URL do arquivo PMTiles de relevo (encoding Terrarium). */
  terrainUrl?: string;
  theme?: Theme;
  /** Idioma dos rótulos. */
  lang?: string;
}

export const BASEMAP_SOURCE = "basemap";
export const TERRAIN_SOURCE = "terrain";
export const BUILDINGS_3D_LAYER = "buildings-3d";

// TODO(fase 0): servir glyphs e sprites localmente para funcionar 100% offline.
const ASSETS_URL = "https://protomaps.github.io/basemaps-assets";

const BUILDING_COLORS: Record<Theme, string> = {
  light: "#d9d3c9",
  dark: "#3a3d45",
};

function buildingsLayer(theme: Theme): FillExtrusionLayerSpecification {
  return {
    id: BUILDINGS_3D_LAYER,
    type: "fill-extrusion",
    source: BASEMAP_SOURCE,
    "source-layer": "buildings",
    minzoom: 14,
    filter: ["in", ["get", "kind"], ["literal", ["building", "building_part"]]],
    paint: {
      "fill-extrusion-color": BUILDING_COLORS[theme],
      // OSM nem sempre tem altura; assume ~2 andares quando falta.
      "fill-extrusion-height": ["coalesce", ["get", "height"], 6],
      "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0],
      "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0, 15, 0.9],
    },
  };
}

/** Monta o estilo MapLibre a partir dos dados locais. Função pura (testável). */
export function buildStyle({
  basemapUrl,
  terrainUrl,
  theme = "light",
  lang = "pt",
}: StyleOptions): StyleSpecification {
  const baseLayers: LayerSpecification[] = layers(BASEMAP_SOURCE, namedFlavor(theme), {
    lang,
  }) as LayerSpecification[];

  // Prédios 2D viram extrusão 3D, inserida antes dos rótulos.
  const withoutFlatBuildings = baseLayers.filter((l) => l.id !== "buildings");
  const firstSymbol = withoutFlatBuildings.findIndex((l) => l.type === "symbol");
  const insertAt = firstSymbol === -1 ? withoutFlatBuildings.length : firstSymbol;
  withoutFlatBuildings.splice(insertAt, 0, buildingsLayer(theme));

  const style: StyleSpecification = {
    version: 8,
    glyphs: `${ASSETS_URL}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${ASSETS_URL}/sprites/v4/${theme}`,
    sources: {
      [BASEMAP_SOURCE]: {
        type: "vector",
        url: `pmtiles://${basemapUrl}`,
        attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: withoutFlatBuildings,
  };

  if (terrainUrl) {
    style.sources[TERRAIN_SOURCE] = {
      type: "raster-dem",
      url: `pmtiles://${terrainUrl}`,
      encoding: "terrarium",
      tileSize: 256,
      attribution: "Relevo: Mapzen / AWS Open Data",
    };
  }

  return style;
}
