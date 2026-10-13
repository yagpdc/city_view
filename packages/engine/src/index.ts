/// <reference path="./env.d.ts" />
import "maplibre-gl/dist/maplibre-gl.css";

export {
  CatalogLayer,
  type CatalogPick,
  type ChoroplethRender,
  type DatapackField,
  type DatapackManifest,
  type LayerData,
  type PointsRender,
} from "./catalog";
export { geodesicDistanceM } from "./geo";
export { normalizeText } from "./nearby";
export type { NearbyPoint, NearbySummary, SearchHit } from "./nearby";
export { CityMap, type Camera, type CityMapEvent, type CityMapOptions, type MapOverlay, type MapPick, type MeasureMode, type MeasureState } from "./cityMap";
export { formatArea, formatDistance, lineLengthM, polygonMeasure } from "./measure";
export {
  CATEGORY_COLORS,
  DatasetLayer,
  type AreaSummary,
  OTHER_COLOR,
  categoryColor,
  type DatasetFilter,
  type DatasetMeta,
  type DatasetPick,
  type WhereClause,
} from "./dataset";
export { cleanWhere, matchesWhere, whereExpressions, type Where } from "./filter";
// A cena da maquete (three.js) fica em "@cityview/engine/maquete", para carregar só quando abrir.
export type { MaquetePalette, MaqueteSelection, MaqueteView } from "./maquete/scene";
export type { MaqueteData } from "./maquete/extract";
export { pickZoom, type HexFeature } from "./areaHexes";
export { type BuildingPaintResult, type BuildingRecord } from "./buildingPaint";
export { areaBounds, circleArea, pointInArea, type AreaGeometry, type Bounds } from "./geo";
export { buildStyle, type BasemapLook, type StyleOptions, type Theme } from "./style";
export { RegionBoundaries, regionLabel, type RegionLevelSource } from "./regions";
export { DEFAULT_DATA_STYLE, PALETTES, PALETTE_LABELS, SHAPE_DEFAULT_SIZE, classBreaks, classColors, normalizeDataStyle, type ClassMethod, type DataColor, type DataShape, type DataStyle, type PaletteName } from "./dataStyle";
