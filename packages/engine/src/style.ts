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

/**
 * "Para dados" no claro, na paleta da marca (docs/DESIGN.md · ADR 0005): chão creme, ruas brancas, água e verde
 * em pastel bem leve. Discreto de propósito: quem tem cor no mapa são os dados.
 */
const BRAND_DATA_LIGHT: Record<string, string> = {
  background: "#f4f2ec",
  earth: "#f4f2ec",
  park_a: "#e3efdc",
  park_b: "#e3efdc",
  wood_a: "#e6f0df",
  wood_b: "#e6f0df",
  scrub_a: "#ecf1e4",
  scrub_b: "#ecf1e4",
  hospital: "#f6ece9",
  school: "#f3eee2",
  industrial: "#eeebe4",
  pedestrian: "#f7f5f0",
  zoo: "#e9f0df",
  sand: "#f4eedd",
  beach: "#f6efdc",
  aerodrome: "#efece6",
  military: "#efece6",
  glacier: "#f7f8fa",
  water: "#d6e8f4",
  pier: "#ebe7df",
  buildings: "#e9e5dc",
  other: "#ffffff",
  minor_service: "#ffffff",
  minor_a: "#ffffff",
  minor_b: "#ffffff",
  link: "#ffffff",
  major: "#ffffff",
  highway: "#ffffff",
  bridges_other: "#ffffff",
  bridges_minor: "#ffffff",
  bridges_link: "#ffffff",
  bridges_major: "#ffffff",
  bridges_highway: "#ffffff",
  minor_service_casing: "#e9e5dc",
  minor_casing: "#e9e5dc",
  link_casing: "#e4e0d6",
  major_casing_early: "#e4e0d6",
  major_casing_late: "#e4e0d6",
  highway_casing_early: "#ddd8cd",
  highway_casing_late: "#ddd8cd",
  railway: "#d9d4ca",
  boundaries: "#b9b4aa",
  roads_label_minor: "#a29e95",
  roads_label_minor_halo: "#f4f2ec",
  roads_label_major: "#8f8b82",
  roads_label_major_halo: "#f4f2ec",
  ocean_label: "#8fb3cc",
  subplace_label: "#8a867d",
  subplace_label_halo: "#f4f2ec",
  city_label: "#55524b",
  city_label_halo: "#f4f2ec",
  state_label: "#aca79d",
  state_label_halo: "#f4f2ec",
  country_label: "#a7a296",
  address_label: "#a29e95",
  address_label_halo: "#f4f2ec",
};

function flavorFor(look: BasemapLook, theme: Theme) {
  const base = namedFlavor(FLAVOR[look][theme]);
  return look === "data" && theme === "light" ? { ...base, ...BRAND_DATA_LIGHT } : base;
}

const BUILDING_COLORS: Record<Theme, string> = { light: "#e2ded5", dark: "#2c2f36" };

/** Céu, horizonte e atmosfera do globo, por tema. */
const SKY: Record<Theme, Record<string, unknown>> = {
  light: {
    "sky-color": "#bcd4ec",
    "horizon-color": "#f1efe9",
    "fog-color": "#f4f2ec",
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
  const baseLayers = layers(BASEMAP_SOURCE, flavorFor(look, theme), { lang }) as LayerSpecification[];

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
    : { grid: "rgba(21,26,36,0.05)", building: BUILDING_COLORS.light, buildingEdge: "#a9a59d", footprint: "rgba(21,26,36,0.06)", slabSide: "#e7e5e1", slabBottom: "#d5d3cf", ring: "#d6d2c8", accent: "#8b7cf6", viewBackground: "#f6f5f1" };
  const ground =
    look === "classic"
      ? dark
        ? { ground: "#1f1f1f", park: "#1c2421", water: "#31353f", road: "#474747", roadCasing: "#2a2a2a", path: "#3d3d3d" }
        : { ground: "#e2dfda", park: "#cfddd5", water: "#80deea", road: "#ffffff", roadCasing: "#d0ccc5", path: "#ebebeb" }
      : dark
        ? { ground: "#141414", park: "#181d1a", water: "#333333", road: "#2e2e2e", roadCasing: "#1c1c1c", path: "#262626" }
        : { ground: "#f4f2ec", park: "#e3efdc", water: "#d6e8f4", road: "#ffffff", roadCasing: "#e4e0d6", path: "#ece8e0" };
  return { ...shared, ...ground, dark };
}
