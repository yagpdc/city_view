/**
 * Textos das anotações (ferramenta Texto, título do alfinete, rótulo de área e de linha), desenhados por uma
 * camada do app acima de tudo. O editor (Terra Draw) cuida das formas; aqui é só o que se lê.
 */
import type { MapOverlay } from "@cityview/engine";
import type { AnnotationFeature } from "./model";

export const LABELS_OVERLAY = "cv-annot";
/** Camada invisível sobre os alfinetes, para abrir a nota com um clique quando não se está desenhando. */
export const PIN_HIT_LAYER = "cv-annot-pin-hit";

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
      if (kind === "pin") out.push({ type: "Feature", geometry: f.geometry, properties: { kind: "pin", label: text, id: String(f.id) } });
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
        id: "cv-annot-line-label",
        type: "symbol",
        source: LABELS_OVERLAY,
        filter: is("line") as never,
        layout: { "symbol-placement": "line", "text-field": ["get", "label"], "text-font": FONT, "text-size": 13, "text-offset": [0, -0.9], "text-allow-overlap": true },
        paint: { "text-color": ["get", "color"], ...HALO },
      },
      {
        id: "cv-annot-area-label",
        type: "symbol",
        source: LABELS_OVERLAY,
        filter: is("area") as never,
        layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": 14, "text-max-width": 12, "text-allow-overlap": true, "text-ignore-placement": true },
        paint: { "text-color": ["get", "color"], ...HALO },
      },
      {
        id: "cv-annot-pin-label",
        type: "symbol",
        source: LABELS_OVERLAY,
        filter: is("pin") as never,
        layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": 12.5, "text-anchor": "top", "text-offset": [0, 0.9], "text-max-width": 12, "text-allow-overlap": true },
        paint: { "text-color": "#1d1e24", ...HALO },
      },
      {
        id: "cv-annot-text",
        type: "symbol",
        source: LABELS_OVERLAY,
        filter: is("text") as never,
        layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": 18, "text-max-width": 16, "text-allow-overlap": true, "text-ignore-placement": true },
        paint: { "text-color": ["get", "color"], ...HALO },
      },
    ],
  };
}
