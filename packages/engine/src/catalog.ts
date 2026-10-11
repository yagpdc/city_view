import type { AreaGeometry } from "./geo";
import type {
  ExpressionSpecification,
  GeoJSONSource,
  GeoJSONSourceSpecification,
  LayerSpecification,
  Map as MapLibreMap,
  PointLike,
} from "maplibre-gl";

/** Manifesto de um datapack (datapacks/<id>/manifest.json). */
export interface DatapackManifest {
  id: string;
  name: string;
  description: string;
  category: string;
  geometry: "point" | "polygon";
  source: { name: string; url: string };
  license: { name: string; url: string; commercial: boolean };
  attribution: string;
  refresh: string;
  /** Idade máxima aceitável dos dados antes de avisar que estão desatualizados. */
  maxAgeHours?: number;
  render: ChoroplethRender | PointsRender;
  fields: DatapackField[];
}

export interface ChoroplethRender {
  type: "choropleth";
  property: string;
  breaks: number[];
  /** Uma cor a mais que o número de quebras. */
  colors: string[];
  opacity?: number;
}

export interface PointsRender {
  type: "points";
  color: string;
  /** Colore por uma coluna de categoria; valores fora da lista usam `color`. */
  colorBy?: { property: string; categories: string[]; colors: string[] };
  sizeProperty?: string;
  /** [valor, raio, valor, raio, ...] */
  sizeStops?: number[];
}

export interface DatapackField {
  key: string;
  label: string;
  format?: "int" | "decimal" | "date";
  unit?: string;
}

export interface CatalogPick {
  datapack: DatapackManifest;
  /** Id da feição (ex.: código IBGE do município), para buscar a geometria completa. */
  featureId?: string | number;
  properties: Record<string, unknown>;
}

/** URL de um GeoJSON ou a coleção já em memória (ex.: arquivo enviado pelo usuário). */
export type LayerData = GeoJSONSourceSpecification["data"];

/** Camada GeoJSON desenhada a partir de um manifesto (catálogo ou arquivo do usuário). */
export class CatalogLayer {
  private visible = true;
  private extruded = false;
  private readonly sourceId: string;

  constructor(
    private readonly map: MapLibreMap,
    readonly manifest: DatapackManifest,
    private readonly data: LayerData,
  ) {
    this.sourceId = `cat-${manifest.id}`;
  }

  get layerIds(): string[] {
    return this.manifest.render.type === "choropleth"
      ? [`${this.sourceId}-fill`, `${this.sourceId}-line`]
      : [`${this.sourceId}-points`];
  }

  attach(beforeId?: string): void {
    if (this.map.getSource(this.sourceId)) return;
    this.map.addSource(this.sourceId, {
      type: "geojson",
      data: this.data,
      ...(this.manifest.attribution ? { attribution: this.manifest.attribution } : {}),
    });
    for (const layer of this.layers()) this.map.addLayer(layer, beforeId);
    this.applyVisibility();
  }

  detach(): void {
    for (const id of this.layerIds) if (this.map.getLayer(id)) this.map.removeLayer(id);
    if (this.map.getSource(this.sourceId)) this.map.removeSource(this.sourceId);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.applyVisibility();
  }

  isVisible(): boolean {
    return this.visible;
  }

  pick(point: PointLike): CatalogPick | null {
    if (!this.visible) return null;
    const layers = this.layerIds.filter((id) => this.map.getLayer(id));
    const [feature] = this.map.queryRenderedFeatures(point, { layers });
    return feature ? { datapack: this.manifest, featureId: feature.id, properties: feature.properties } : null;
  }

  /** Polígonos como prismas 3D (altura pela mesma propriedade da cor). */
  setExtruded(on: boolean): void {
    if (on === this.extruded || this.manifest.render.type !== "choropleth") return;
    this.extruded = on;
    const fillId = `${this.sourceId}-fill`;
    if (!this.map.getLayer(fillId)) return;
    const before = this.map.getStyle().layers.findIndex((l) => l.id === fillId);
    const next = this.map.getStyle().layers[before + 1]?.id;
    this.map.removeLayer(fillId);
    this.map.addLayer(this.fillLayer(), next);
    this.applyVisibility();
  }

  isExtruded(): boolean {
    return this.extruded;
  }

  /** Geometria completa de uma feição (a do clique vem recortada pelos tiles). */
  async getGeometry(featureId: string | number): Promise<AreaGeometry | null> {
    const source = this.map.getSource<GeoJSONSource>(this.sourceId);
    if (!source) return null;
    const data = (await source.getData()) as { features?: { id?: string | number; geometry: AreaGeometry }[] };
    const found = data.features?.find((f) => f.id === featureId || String(f.id) === String(featureId));
    return found && (found.geometry.type === "Polygon" || found.geometry.type === "MultiPolygon") ? found.geometry : null;
  }

  private applyVisibility(): void {
    for (const id of this.layerIds) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, "visibility", this.visible ? "visible" : "none");
    }
  }

  private fillLayer(): LayerSpecification {
    const render = this.manifest.render as ChoroplethRender;
    const value = ["coalesce", ["get", render.property], 0];
    const stops = render.breaks.flatMap((b, i) => [b, render.colors[i + 1] ?? render.colors.at(-1)!]);
    const color = ["step", value, render.colors[0]!, ...stops] as unknown as ExpressionSpecification;
    if (!this.extruded) {
      return {
        id: `${this.sourceId}-fill`,
        type: "fill",
        source: this.sourceId,
        paint: { "fill-color": color, "fill-opacity": render.opacity ?? 0.6 },
      };
    }
    // Altura pelo log do valor; encolhe ao aproximar para não virar um paredão.
    const base = ["*", ["ln", ["+", 1, value]], 3500];
    const height = ["interpolate", ["linear"], ["zoom"], 3, base, 7, ["*", base, 0.3], 11, ["*", base, 0.04]];
    return {
      id: `${this.sourceId}-fill`,
      type: "fill-extrusion",
      source: this.sourceId,
      paint: {
        "fill-extrusion-color": color,
        "fill-extrusion-height": height as unknown as ExpressionSpecification,
        "fill-extrusion-opacity": 0.88,
        "fill-extrusion-vertical-gradient": true,
      },
    };
  }

  private layers(): LayerSpecification[] {
    const render = this.manifest.render;
    if (render.type === "choropleth") {
      return [
        this.fillLayer(),
        {
          id: `${this.sourceId}-line`,
          type: "line",
          source: this.sourceId,
          minzoom: 5,
          paint: { "line-color": "rgba(40,60,90,0.35)", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.3, 10, 1] },
        },
      ];
    }
    const radius: ExpressionSpecification | number =
      render.sizeProperty && render.sizeStops
        ? (["interpolate", ["linear"], ["coalesce", ["get", render.sizeProperty], 0], ...render.sizeStops] as unknown as ExpressionSpecification)
        : (["interpolate", ["linear"], ["zoom"], 3, 2.5, 10, 4.5, 15, 7] as unknown as ExpressionSpecification);
    const color: ExpressionSpecification | string = render.colorBy
      ? (["match", ["to-string", ["get", render.colorBy.property]],
          ...render.colorBy.categories.flatMap((c, i) => [c, render.colorBy!.colors[i] ?? render.color]),
          render.color] as unknown as ExpressionSpecification)
      : render.color;
    return [
      {
        id: `${this.sourceId}-points`,
        type: "circle",
        source: this.sourceId,
        paint: {
          "circle-color": color,
          "circle-radius": radius,
          "circle-opacity": 0.8,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 0.5,
        },
      },
    ];
  }
}
