import { layers, namedFlavor } from "@protomaps/basemaps";
import type {
  FillExtrusionLayerSpecification,
  HillshadeLayerSpecification,
  LayerSpecification,
  StyleSpecification,
} from "maplibre-gl";

export type Theme = "light" | "dark";

/**
 * "data": fundo neutro feito para os dados brilharem (padrão da plataforma).
 * "classic": mapa de referência colorido.
 */
export type BasemapLook = "data" | "classic";

export interface StyleOptions {
  /** URL do arquivo PMTiles do mapa base (Protomaps). */
  basemapUrl: string;
  /**
   * Relevo (Terrarium) em PMTiles local. Sem isso, usa os tiles públicos da AWS
   * (Terrain Tiles / Mapzen, gratuitos e sem chave).
   */
  terrainUrl?: string;
  theme?: Theme;
  look?: BasemapLook;
  /** Relevo sombreado sutil sob as estradas e rótulos. */
  hillshade?: boolean;
  /** Globo 3D na visão continental (vira plano ao aproximar). */
  globe?: boolean;
  /** Idioma dos rótulos. */
  lang?: string;
}

export const BASEMAP_SOURCE = "basemap";
export const TERRAIN_SOURCE = "terrain";
export const HILLSHADE_LAYER = "hillshade";
export const BUILDINGS_3D_LAYER = "buildings-3d";

/** Terrain Tiles públicos (AWS Open Data, encoding Terrarium). */
export const PUBLIC_DEM_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

// TODO(fase 0): servir glyphs e sprites localmente para funcionar 100% offline.
const ASSETS_URL = "https://protomaps.github.io/basemaps-assets";

const FLAVOR: Record<BasemapLook, Record<Theme, string>> = {
  data: { light: "white", dark: "black" },
  classic: { light: "light", dark: "dark" },
};

const BUILDING_COLORS: Record<Theme, string> = { light: "#d9d6d0", dark: "#2c2f36" };

/** Céu, horizonte e atmosfera do globo, por tema. */
const SKY: Record<Theme, Record<string, unknown>> = {
  light: {
    "sky-color": "#bcd4ec",
    "horizon-color": "#eef2f6",
    "fog-color": "#f4f5f7",
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.7,
    "fog-ground-blend": 0.35,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 6, 0.6, 9, 0],
  },
  dark: {
    "sky-color": "#0b1020",
    "horizon-color": "#1b2440",
    "fog-color": "#0d1018",
    "sky-horizon-blend": 0.5,
    "horizon-fog-blend": 0.6,
    "fog-ground-blend": 0.4,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 6, 0.7, 9, 0],
  },
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
      "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0, 15, 0.85],
    },
  };
}

function hillshadeLayer(theme: Theme): HillshadeLayerSpecification {
  return {
    id: HILLSHADE_LAYER,
    type: "hillshade",
    source: TERRAIN_SOURCE,
    paint: {
      "hillshade-method": "multidirectional",
      "hillshade-exaggeration": theme === "dark" ? 0.45 : 0.35,
      "hillshade-shadow-color": theme === "dark" ? "#000000" : "#5d6470",
      "hillshade-highlight-color": theme === "dark" ? "#3b4252" : "#ffffff",
      "hillshade-accent-color": theme === "dark" ? "#000000" : "#7a808a",
    },
  } as HillshadeLayerSpecification;
}

/** Monta o estilo MapLibre. Função pura (testável). */
export function buildStyle({
  basemapUrl,
  terrainUrl,
  theme = "light",
  look = "data",
  hillshade = true,
  globe = true,
  lang = "pt",
}: StyleOptions): StyleSpecification {
  const baseLayers = layers(BASEMAP_SOURCE, namedFlavor(FLAVOR[look][theme]), { lang }) as LayerSpecification[];

  // Prédios 2D viram extrusão 3D, inserida antes dos rótulos.
  const result = baseLayers.filter((l) => l.id !== "buildings");
  const firstSymbol = result.findIndex((l) => l.type === "symbol");
  result.splice(firstSymbol === -1 ? result.length : firstSymbol, 0, buildingsLayer(theme));

  // Relevo sombreado acima do solo e da vegetação, abaixo da água, estradas e rótulos.
  if (hillshade) {
    const water = result.findIndex((l) => l.id === "water");
    result.splice(water === -1 ? 1 : water, 0, hillshadeLayer(theme));
  }

  return {
    version: 8,
    glyphs: `${ASSETS_URL}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${ASSETS_URL}/sprites/v4/${theme}`,
    ...(globe ? { projection: { type: "globe" } } : {}),
    sky: SKY[theme],
    light: { anchor: "viewport", color: "#ffffff", intensity: 0.35, position: [1.2, 210, 35] },
    sources: {
      [BASEMAP_SOURCE]: {
        type: "vector",
        url: `pmtiles://${basemapUrl}`,
        attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      },
      [TERRAIN_SOURCE]: terrainUrl
        ? { type: "raster-dem", url: `pmtiles://${terrainUrl}`, encoding: "terrarium", tileSize: 256, attribution: "Relevo: Mapzen / AWS Open Data" }
        : {
            type: "raster-dem",
            tiles: [PUBLIC_DEM_TILES],
            encoding: "terrarium",
            tileSize: 256,
            maxzoom: 15,
            attribution: '<a href="https://registry.opendata.aws/terrain-tiles/">Relevo: Mapzen / AWS Terrain Tiles</a>',
          },
    },
    layers: result,
  } as StyleSpecification;
}
