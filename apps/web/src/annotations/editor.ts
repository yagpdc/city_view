/**
 * Editor de anotações sobre o mapa (Terra Draw, MIT). Desenha, seleciona e edita; quem guarda o estado é o app
 * (`onChange` devolve todas as anotações). Textos e rótulos são desenhados por uma camada do próprio app.
 */
import type { CityMap } from "@cityview/engine";
import {
  TerraDraw,
  TerraDrawCircleMode,
  TerraDrawFreehandLineStringMode,
  TerraDrawLineStringMode,
  TerraDrawPointMode,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
  type HexColor,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { TOOL_MODE, cleanAnnotations, type AnnotationFeature, type AnnotationTool } from "./model";

type NativeMap = CityMap["native"];

const FALLBACK = "#8b7cf6" as HexColor;
const colorOf = (f: GeoJSONStoreFeatures) => ((f.properties.color as HexColor | undefined) ?? FALLBACK);
const isText = (f: GeoJSONStoreFeatures) => f.properties.kind === "text";

export interface AnnotationHandlers {
  /** Todas as anotações, depois de qualquer mudança (desenho, edição, remoção). */
  onChange: (features: AnnotationFeature[]) => void;
  /** Anotação escolhida na ferramenta Selecionar (null = nenhuma). */
  onSelect: (id: string | null) => void;
  /** Acabou de desenhar uma: texto e alfinete abrem o campo para escrever. */
  onCreated: (feature: AnnotationFeature) => void;
}

export class AnnotationEditor {
  private draw: TerraDraw | null = null;
  private tool: AnnotationTool = "off";
  private color = FALLBACK as string;
  /** Anotações carregadas (para recriar o editor quando o estilo do mapa é trocado). */
  private features: AnnotationFeature[] = [];
  private emitTimer = 0;
  /** Carregando pelo app: as mudanças não voltam como "mudou". */
  private loading = false;

  constructor(
    private readonly map: NativeMap,
    private readonly handlers: AnnotationHandlers,
  ) {
    this.map.on("style.load", this.restart);
    if (this.map.isStyleLoaded()) this.create();
    else this.map.once("load", () => this.create());
  }

  /** Troca todas as anotações (troca de aba, camada escondida/mostrada, link aberto). */
  load(features: AnnotationFeature[]): void {
    this.features = cleanAnnotations(features);
    features = this.features;
    if (!this.draw) return;
    this.loading = true;
    this.draw.clear();
    if (features.length) this.draw.addFeatures(features as unknown as GeoJSONStoreFeatures[]);
    this.loading = false;
  }

  /** Ferramenta da barra; "off" deixa as anotações só à mostra (o clique volta para o mapa). */
  setTool(tool: AnnotationTool, color?: string): void {
    this.tool = tool;
    if (color) this.color = color;
    if (!this.draw) return;
    this.draw.setMode(tool === "off" ? "static" : TOOL_MODE[tool]);
  }

  setColor(color: string): void {
    this.color = color;
  }

  update(id: string | number, props: Record<string, string | undefined>): void {
    if (!this.draw?.hasFeature(id)) return;
    this.draw.updateFeatureProperties(id, props);
    this.emitSoon();
  }

  remove(id: string | number): void {
    if (!this.draw?.hasFeature(id)) return;
    this.draw.removeFeatures([id]);
    this.handlers.onSelect(null);
    this.emitSoon();
  }

  select(id: string | number): void {
    if (!this.draw?.hasFeature(id)) return;
    if (this.tool !== "select") this.setTool("select");
    this.draw.selectFeature(id);
    // Selecionar pelo código não dispara o evento "select" do editor: avisa o app aqui.
    this.handlers.onSelect(String(id));
  }

  deselectAll(): void {
    const snapshot = this.draw?.getSnapshot() ?? [];
    for (const f of snapshot) if (f.properties.selected && f.id !== undefined) this.draw?.deselectFeature(f.id);
  }

  undo(): void {
    if (this.draw?.canUndo()) {
      this.draw.undo();
      this.emitSoon();
    }
  }

  destroy(): void {
    this.map.off("style.load", this.restart);
    window.clearTimeout(this.emitTimer);
    this.draw?.stop();
    this.draw = null;
  }

  /** O estilo do mapa foi trocado (tema, aparência): as camadas do editor somem; recria com o que havia. */
  private restart = () => {
    if (!this.draw) return;
    this.features = this.snapshot();
    this.draw.stop();
    this.draw = null;
    this.create();
  };

  private snapshot(): AnnotationFeature[] {
    // Só as anotações: sem as alças de edição (cantos e pontos do meio) nem as marcas internas do editor.
    return cleanAnnotations(this.draw?.getSnapshot() ?? []).map((f) => {
      const { selected: _s, edited: _e, ...properties } = f.properties as Record<string, unknown>;
      return { ...f, properties } as unknown as AnnotationFeature;
    });
  }

  private emitSoon(): void {
    window.clearTimeout(this.emitTimer);
    this.emitTimer = window.setTimeout(() => {
      this.features = this.snapshot();
      this.handlers.onChange(this.features);
    }, 200);
  }

  private create(): void {
    const line = { lineStringColor: colorOf, lineStringWidth: 4 };
    const area = { fillColor: colorOf, fillOpacity: 0.16, outlineColor: colorOf, outlineWidth: 2.5 };
    const editable = { feature: { draggable: true, coordinates: { draggable: true, midpoints: true, deletable: true } } };
    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map: this.map, coordinatePrecision: 7, prefixId: "cv-annot-draw" }),
      modes: [
        new TerraDrawSelectMode({
          flags: {
            "freehand-linestring": editable,
            linestring: editable,
            polygon: editable,
            rectangle: { feature: { draggable: true, coordinates: { draggable: true, resizable: "opposite" } } },
            circle: { feature: { draggable: true, coordinates: { draggable: true, resizable: "center-fixed" } } },
            point: { feature: { draggable: true } },
          },
          styles: {
            selectedLineStringColor: colorOf,
            selectedLineStringWidth: 5,
            selectedPolygonColor: colorOf,
            selectedPolygonFillOpacity: 0.26,
            selectedPolygonOutlineColor: colorOf,
            selectedPolygonOutlineWidth: 3.5,
            selectedPointColor: colorOf,
            selectedPointWidth: (f) => (isText(f) ? 5 : 9),
            selectedPointOutlineColor: "#ffffff",
            selectedPointOutlineWidth: 3,
            selectionPointColor: "#ffffff",
            selectionPointOutlineColor: colorOf,
            selectionPointWidth: 5,
            selectionPointOutlineWidth: 2.5,
            midPointColor: "#ffffff",
            midPointOutlineColor: colorOf,
            midPointWidth: 3.5,
            midPointOutlineWidth: 2,
          },
        }),
        // Traço livre: segurar e arrastar (como caneta) ou clicar para começar e clicar para terminar.
        new TerraDrawFreehandLineStringMode({ styles: line, drawInteraction: "click-move-or-drag" }),
        new TerraDrawLineStringMode({ styles: line }),
        new TerraDrawPolygonMode({ styles: { ...area, closingPointColor: "#ffffff", closingPointOutlineColor: colorOf, closingPointWidth: 5, closingPointOutlineWidth: 2.5 } }),
        new TerraDrawRectangleMode({ styles: area }),
        new TerraDrawCircleMode({ styles: area }),
        new TerraDrawPointMode({
          styles: {
            // Texto: o ponto quase some (quem aparece é o texto, desenhado pelo app); alfinete: pastilha com anel.
            pointColor: colorOf,
            pointWidth: (f) => (isText(f) ? 3 : 8),
            pointOpacity: (f) => (isText(f) ? 0.35 : 1),
            pointOutlineColor: "#ffffff",
            pointOutlineWidth: (f) => (isText(f) ? 0 : 3),
          },
        }),
      ],
    });
    draw.start();
    this.draw = draw;
    if (this.features.length) {
      this.loading = true;
      draw.addFeatures(this.features as unknown as GeoJSONStoreFeatures[]);
      this.loading = false;
    }
    draw.setMode(this.tool === "off" ? "static" : TOOL_MODE[this.tool]);

    draw.on("finish", (id, context) => {
      if (context.action === "draw") {
        // Feição nova: a cor e o tipo da ferramenta que a desenhou.
        const props: Record<string, string> = { color: this.color, tool: this.tool };
        if (this.tool === "text") props.kind = "text";
        if (this.tool === "pin") props.kind = "pin";
        draw.updateFeatureProperties(id, props);
        const created = this.snapshot().find((f) => f.id === id);
        if (created) this.handlers.onCreated(created);
      }
      this.emitSoon();
    });
    draw.on("change", (_ids, type) => {
      if (this.loading) return;
      if (type === "delete" || type === "update") this.emitSoon();
    });
    draw.on("select", (id) => this.handlers.onSelect(String(id)));
    draw.on("deselect", () => this.handlers.onSelect(null));
  }
}
