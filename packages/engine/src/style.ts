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
  /**
   * Mapa base detalhado (PMTiles, zoom 14+) usado só para os prédios 3D — o mapa base
   * principal pode ser mais leve (ex.: Brasil até z12) e não ter prédios.
   */
  buildingsUrl?: string;
  /** Idioma dos rótulos. */
  lang?: string;
  /** Base das fontes (`fonts/`) e ícones (`sprites/v4/`); padrão: GitHub Pages do Protomaps. */
  assetsUrl?: string;
}

export const BASEMAP_SOURCE = "basemap";
export const BUILDINGS_SOURCE = "buildings";
export const TERRAIN_SOURCE = "terrain";
export const HILLSHADE_LAYER = "hillshade";
export const BUILDINGS_3D_LAYER = "buildings-3d";

/** Terrain Tiles públicos (AWS Open Data, encoding Terrarium). */
export const PUBLIC_DEM_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

/** Fontes e ícones do mapa base (Protomaps). Local: `pnpm assets` + `assetsUrl`. */
export const PUBLIC_ASSETS_URL = "https://protomaps.github.io/basemaps-assets";

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

function buildingsLayer(theme: Theme, source: string): FillExtrusionLayerSpecification {
  return {
    id: BUILDINGS_3D_LAYER,
    type: "fill-extrusion",
    source,
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
  buildingsUrl,
  lang = "pt",
  assetsUrl = PUBLIC_ASSETS_URL,
}: StyleOptions): StyleSpecification {
  const baseLayers = layers(BASEMAP_SOURCE, namedFlavor(FLAVOR[look][theme]), { lang }) as LayerSpecification[];

  // Prédios 2D viram extrusão 3D, inserida antes dos rótulos.
  const result = baseLayers.filter((l) => l.id !== "buildings");
  const firstSymbol = result.findIndex((l) => l.type === "symbol");
  result.splice(firstSymbol === -1 ? result.length : firstSymbol, 0, buildingsLayer(theme, buildingsUrl ? BUILDINGS_SOURCE : BASEMAP_SOURCE));

  // Relevo sombreado acima do solo e da vegetação, abaixo da água, estradas e rótulos.
  if (hillshade) {
    const water = result.findIndex((l) => l.id === "water");
    result.splice(water === -1 ? 1 : water, 0, hillshadeLayer(theme));
  }

  return {
    version: 8,
    glyphs: `${assetsUrl}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${assetsUrl}/sprites/v4/${theme}`,
    ...(globe ? { projection: { type: "globe" } } : {}),
    sky: SKY[theme],
    light: { anchor: "viewport", color: "#ffffff", intensity: 0.35, position: [1.2, 210, 35] },
    sources: {
      [BASEMAP_SOURCE]: {
        type: "vector",
        url: `pmtiles://${basemapUrl}`,
        attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      },
      ...(buildingsUrl ? { [BUILDINGS_SOURCE]: { type: "vector", url: `pmtiles://${buildingsUrl}` } } : {}),
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

/**
 * Cores da maquete por tema e estilo: as do mapa base (Protomaps), com um pouco mais de contraste nas
 * ruas para lerem num objeto pequeno. Prédios usam a mesma cor dos prédios 3D do mapa.
 */
export function maquetePalette(theme: Theme, look: BasemapLook) {
  const dark = theme === "dark";
  const shared = dark
    ? { grid: "rgba(255,255,255,0.05)", building: BUILDING_COLORS.dark, buildingEdge: "#4a4f59", footprint: "rgba(255,255,255,0.05)", slabSide: "#22252b", slabBottom: "#101114", ring: "#3d434e", accent: "#7f86f7", viewBackground: "#151a24" }
    : { grid: "rgba(21,26,36,0.05)", building: BUILDING_COLORS.light, buildingEdge: "#a9a59d", footprint: "rgba(21,26,36,0.06)", slabSide: "#e7e5e1", slabBottom: "#d5d3cf", ring: "#b9bec8", accent: "#4a50d6", viewBackground: "#f5f6f8" };
  const ground =
    look === "classic"
      ? dark
        ? { ground: "#1f1f1f", park: "#1c2421", water: "#31353f", road: "#474747", roadCasing: "#2a2a2a", path: "#3d3d3d" }
        : { ground: "#e2dfda", park: "#cfddd5", water: "#80deea", road: "#ffffff", roadCasing: "#d0ccc5", path: "#ebebeb" }
      : dark
        ? { ground: "#141414", park: "#181d1a", water: "#333333", road: "#2e2e2e", roadCasing: "#1c1c1c", path: "#262626" }
        : { ground: "#ffffff", park: "#f1f5ee", water: "#dcdcdc", road: "#ebebeb", roadCasing: "#dadada", path: "#e4e4e4" };
  return { ...shared, ...ground, dark };
}
