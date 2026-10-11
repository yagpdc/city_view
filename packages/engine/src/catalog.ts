import type {
  ExpressionSpecification,
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
  sizeProperty?: string;
  /** [valor, raio, valor, raio, ...] */
  sizeStops?: number[];
}

export interface DatapackField {
  key: string;
  label: string;
  format?: "int" | "decimal";
  unit?: string;
}

export interface CatalogPick {
  datapack: DatapackManifest;
  properties: Record<string, unknown>;
}

/** Camada de catálogo (GeoJSON) desenhada a partir do manifesto. */
export class CatalogLayer {
  private visible = true;
  private readonly sourceId: string;

  constructor(
    private readonly map: MapLibreMap,
    readonly manifest: DatapackManifest,
    private readonly dataUrl: string,
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
      data: this.dataUrl,
      attribution: this.manifest.attribution,
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
    return feature ? { datapack: this.manifest, properties: feature.properties } : null;
  }

  private applyVisibility(): void {
    for (const id of this.layerIds) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, "visibility", this.visible ? "visible" : "none");
    }
  }

  private layers(): LayerSpecification[] {
    const render = this.manifest.render;
    if (render.type === "choropleth") {
      const stops = render.breaks.flatMap((b, i) => [b, render.colors[i + 1] ?? render.colors.at(-1)!]);
      const color = ["step", ["coalesce", ["get", render.property], 0], render.colors[0]!, ...stops] as unknown as ExpressionSpecification;
      return [
        {
          id: `${this.sourceId}-fill`,
          type: "fill",
          source: this.sourceId,
          paint: { "fill-color": color, "fill-opacity": render.opacity ?? 0.6 },
        },
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
        : 4;
    return [
      {
        id: `${this.sourceId}-points`,
        type: "circle",
        source: this.sourceId,
        paint: {
          "circle-color": render.color,
          "circle-radius": radius,
          "circle-opacity": 0.8,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 0.5,
        },
      },
    ];
  }
}
