/**
 * Textos das anotações (ferramenta Texto, título do alfinete, rótulo de área e de linha), desenhados por uma
 * camada do app acima de tudo. O editor (Terra Draw) cuida das formas; aqui é só o que se lê.
 */
import type { MapOverlay } from "@pinny/engine";
import type { AnnotationFeature } from "./model";

export const LABELS_OVERLAY = "pn-annot";
/** Camada invisível sobre os alfinetes, para abrir a nota com um clique quando não se está desenhando. */
export const PIN_HIT_LAYER = "pn-annot-pin-hit";
/** Prefixo das miniaturas de foto registradas no mapa (`map.addImage`). */
export const PHOTO_ICON_PREFIX = "annot-photo-";
/** Ruas e prédios pintados (abaixo dos rótulos do mapa base). */
export const PAINT_OVERLAY = "pn-annot-paint";
export const PAINT_HIT_LAYERS = ["pn-annot-paint-road", "pn-annot-paint-building"];

const FONT = ["Noto Sans Medium"];
const HALO = { "text-halo-color": "#ffffff", "text-halo-width": 2.2, "text-halo-blur": 0.4 };

/** Centro aproximado de um polígono (média dos vértices do anel externo): onde vai o rótulo da área. */
function center(ring: GeoJSON.Position[]): GeoJSON.Position {
  const pts = ring.length > 1 ? ring.slice(0, -1) : ring;
  const sum = pts.reduce((acc, [x, y]) => [acc[0]! + x!, acc[1]! + y!], [0, 0]);
  return [sum[0]! / pts.length, sum[1]! / pts.length];
}

export function labelsOverlay(features: AnnotationFeature[]): MapOverlay & { source: { type: "geojson"; data: GeoJSON.FeatureCollection } } {
  const out: GeoJSON.Feature[] = [];
  for (const f of features) {
    const { kind, label, color } = f.properties;
    const text = (label ?? "").trim();
    if (f.geometry.type === "Point") {
      if (kind === "text" && text) out.push({ type: "Feature", geometry: f.geometry, properties: { kind: "text", label: text, color } });
      if (kind === "pin") out.push({ type: "Feature", geometry: f.geometry, properties: { kind: "pin", label: text, id: String(f.id), ...(f.properties.photo ? { photo: f.properties.photo } : {}) } });
    } else if (kind === "paint" || kind === "image") {
      // Rua/prédio pintados têm camada própria (paintOverlay); a imagem não tem rótulo.
    } else if (f.geometry.type === "Polygon" && text) {
      out.push({ type: "Feature", geometry: { type: "Point", coordinates: center(f.geometry.coordinates[0]!) }, properties: { kind: "area", label: text, color } });
    } else if (f.geometry.type === "LineString" && text) {
      out.push({ type: "Feature", geometry: f.geometry, properties: { kind: "line", label: text, color } });
    }
  }
  const is = (kind: string) => ["==", ["get", "kind"], kind] as const;
  return {
    id: LABELS_OVERLAY,
    top: true,
    source: { type: "geojson", data: { type: "FeatureCollection", features: out } },
    layers: [
      {
        id: PIN_HIT_LAYER,
        type: "circle",
        source: LABELS_OVERLAY,
        filter: is("pin") as never,
        paint: { "circle-radius": 13, "circle-opacity": 0 },
      },
      {
        id: "pn-annot-line-label",
        type: "symbol",
        source: LABELS_OVERLAY,
        filter: is("line") as never,
        layout: { "symbol-placement": "line", "text-field": ["get", "label"], "text-font": FONT, "text-size": 13, "text-offset": [0, -0.9], "text-allow-overlap": true },
        paint: { "text-color": ["get", "color"], ...HALO },
      },
      {
        id: "pn-annot-area-label",
        type: "symbol",
        source: LABELS_OVERLAY,
        filter: is("area") as never,
        layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": 14, "text-max-width": 12, "text-allow-overlap": true, "text-ignore-placement": true },
        paint: { "text-color": ["get", "color"], ...HALO },
      },
      {
        // Alfinete com foto: a miniatura redonda acima do ponto (a imagem é registrada sob demanda: photoMarker).
        id: "pn-annot-pin-photo",
        type: "symbol",
        source: LABELS_OVERLAY,
        filter: ["all", is("pin"), ["has", "photo"]] as never,
        layout: {
          "icon-image": ["concat", PHOTO_ICON_PREFIX, ["get", "photo"]],
          "icon-size": 1,
          "icon-anchor": "bottom",
          "icon-offset": [0, -14],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      },
      {
        id: "pn-annot-pin-label",
        type: "symbol",
        source: LABELS_OVERLAY,
        filter: is("pin") as never,
        layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": 12.5, "text-anchor": "top", "text-offset": [0, 0.9], "text-max-width": 12, "text-allow-overlap": true },
        paint: { "text-color": "#1d1e24", ...HALO },
      },
      {
        id: "pn-annot-text",
        type: "symbol",
        source: LABELS_OVERLAY,
        filter: is("text") as never,
        layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": 18, "text-max-width": 16, "text-allow-overlap": true, "text-ignore-placement": true },
        paint: { "text-color": ["get", "color"], ...HALO },
      },
    ],
  };
}

/**
 * Ruas e prédios pintados: a rua ganha um traço largo com borda branca; o prédio, a extrusão pintada um pouco acima
 * da original. A selecionada fica mais grossa.
 */
export function paintOverlay(features: AnnotationFeature[], selectedId: string | null): MapOverlay & { source: { type: "geojson"; data: GeoJSON.FeatureCollection } } {
  const out: GeoJSON.Feature[] = features
    .filter((f) => f.properties.kind === "paint")
    .map((f) => ({
      type: "Feature",
      geometry: f.geometry,
      properties: { id: String(f.id), paint: f.properties.paint, color: f.properties.color, height: f.properties.height ?? 6, selected: String(f.id) === selectedId },
    }));
  const isRoad = ["==", ["get", "paint"], "road"] as const;
  const isBuilding = ["==", ["get", "paint"], "building"] as const;
  const selected = ["==", ["get", "selected"], true] as const;
  return {
    id: PAINT_OVERLAY,
    source: { type: "geojson", data: { type: "FeatureCollection", features: out } },
    layers: [
      {
        id: "pn-annot-paint-road-casing",
        type: "line",
        source: PAINT_OVERLAY,
        filter: isRoad as never,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 6, 16, ["case", selected, 16, 13], 19, 26] as never },
      },
      {
        id: "pn-annot-paint-road",
        type: "line",
        source: PAINT_OVERLAY,
        filter: isRoad as never,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"] as never, "line-opacity": 0.92, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 3, 16, ["case", selected, 11, 8], 19, 18] as never },
      },
      {
        id: "pn-annot-paint-building",
        type: "fill-extrusion",
        source: PAINT_OVERLAY,
        filter: isBuilding as never,
        paint: {
          "fill-extrusion-color": ["get", "color"] as never,
          "fill-extrusion-height": ["+", ["get", "height"], ["case", selected, 1.5, 0.6]] as never,
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.95,
          "fill-extrusion-vertical-gradient": true,
        },
      },
    ],
  };
}
