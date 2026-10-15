/**
 * Pintar ruas e prédios: acha o que está sob o clique no mapa base e devolve a anotação pronta. Prédio = a forma
 * dele (com a altura, para pintar a extrusão 3D); rua = todos os trechos com o mesmo nome visíveis na tela.
 */
import type { CityMap } from "@cityview/engine";
import type { AnnotationFeature } from "./model";

type NativeMap = CityMap["native"];

/** Camadas de prédios que dá para pintar (mapa base e os do cliente). */
const BUILDING_LAYERS = ["buildings-3d", "client-buildings"];
/** Folga em volta do clique para acertar uma rua fina (px). */
const ROAD_TOLERANCE = 7;

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `a${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

function roadLayers(map: NativeMap): string[] {
  return map
    .getStyle()
    .layers.filter((l) => l.type === "line" && (l as { "source-layer"?: string })["source-layer"] === "roads" && !/casing|rail|runway|pier/.test(l.id))
    .map((l) => l.id);
}

export function paintAt(map: NativeMap, point: { x: number; y: number }, color: string): AnnotationFeature | null {
  const buildings = BUILDING_LAYERS.filter((id) => map.getLayer(id));
  const building = buildings.length ? map.queryRenderedFeatures([point.x, point.y], { layers: buildings })[0] : undefined;
  if (building && (building.geometry.type === "Polygon" || building.geometry.type === "MultiPolygon")) {
    const height = Number(building.properties.height ?? building.properties.render_height ?? 6);
    return {
      type: "Feature",
      id: newId(),
      geometry: building.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
      properties: { mode: "paint", kind: "paint", paint: "building", color, height: Number.isFinite(height) && height > 0 ? height : 6 },
    };
  }

  const roads = roadLayers(map);
  if (roads.length === 0) return null;
  const t = ROAD_TOLERANCE;
  const hits = map.queryRenderedFeatures(
    [
      [point.x - t, point.y - t],
      [point.x + t, point.y + t],
    ],
    { layers: roads },
  );
  const hit = hits.find((f) => f.geometry.type === "LineString" || f.geometry.type === "MultiLineString");
  if (!hit) return null;
  const name = typeof hit.properties.name === "string" && hit.properties.name.trim() ? hit.properties.name : null;
  // Rua com nome: todos os trechos dela que estão na tela (vêm cortados por tile e por cruzamento).
  const segments = name ? map.queryRenderedFeatures({ layers: roads }).filter((f) => f.properties.name === name) : [hit];
  const lines: GeoJSON.Position[][] = [];
  const seen = new Set<string>();
  for (const f of segments) {
    const parts = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [];
    for (const line of parts) {
      const key = JSON.stringify(line);
      if (line.length < 2 || seen.has(key)) continue;
      seen.add(key);
      lines.push(line.map(([x, y]) => [x!, y!]));
    }
  }
  if (lines.length === 0) return null;
  return {
    type: "Feature",
    id: newId(),
    geometry: { type: "MultiLineString", coordinates: lines },
    properties: { mode: "paint", kind: "paint", paint: "road", color, ...(name ? { label: name } : {}) },
  };
}
