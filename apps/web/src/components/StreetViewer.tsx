import { CameraControls, Viewer, type SpatialComponent } from "mapillary-js";
import "mapillary-js/dist/mapillary.css";
import { useEffect, useRef, useState } from "react";
import { MAPILLARY_TOKEN } from "../streetImagery";

export type StreetViewMode = "street" | "spatial" | "points";

const MODES: { id: StreetViewMode; label: string; title: string }[] = [
  { id: "street", label: "Rua", title: "Foto de rua, navegando pela sequência" },
  { id: "spatial", label: "Rua + 3D", title: "Foto com a reconstrução 3D (pontos e câmeras) por cima" },
  { id: "points", label: "Nuvem de pontos", title: "Vista de cima da reconstrução 3D da rua" },
];

/**
 * Visualizador da Mapillary (MapillaryJS, MIT) ancorado no canto do mapa.
 * Navega pela rua, avisa posição/direção da câmera (para o marcador no mapa) e mostra o crédito.
 */
export function StreetViewer({
  imageId,
  onCamera,
  onClose,
}: {
  imageId: string;
  onCamera: (camera: { lngLat: [number, number]; bearing: number }) => void;
  onClose: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  /** Foto atual (ou pedida) do visualizador, para não repetir o moveTo. */
  const current = useRef(imageId);
  const onCameraRef = useRef(onCamera);
  onCameraRef.current = onCamera;
  const [mode, setMode] = useState<StreetViewMode>("street");
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cria o visualizador uma vez; troca de foto usa moveTo.
  useEffect(() => {
    if (!container.current) return;
    const v = new Viewer({
      accessToken: MAPILLARY_TOKEN,
      container: container.current,
      imageId,
      component: { cover: false, spatial: { cameraSize: 0.3, pointSize: 0.2, pointsVisible: true, cellsVisible: false } },
    });
    viewer.current = v;
    const report = async () => {
      try {
        const [pos, bearing] = await Promise.all([v.getPosition(), v.getBearing()]);
        onCameraRef.current({ lngLat: [pos.lng, pos.lat], bearing });
      } catch {
        // Visualizador removido no meio da consulta.
      }
    };
    v.on("position", report);
    v.on("bearing", report);
    v.on("image", (e) => {
      current.current = e.image.id;
      void report();
    });
    return () => {
      v.remove();
      viewer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- imageId inicial; os seguintes vão por moveTo
  }, []);

  useEffect(() => {
    const v = viewer.current;
    if (!v || imageId === current.current) return;
    current.current = imageId;
    setError(null);
    const go = () => v.moveTo(imageId).catch((e: Error) => !/aborted/i.test(e.message) && setError(e.message));
    // Logo após criar, o visualizador ainda não aceita navegação: espera ficar navegável.
    if (v.isNavigable) void go();
    else {
      const onNavigable = (e: { navigable: boolean }) => {
        if (!e.navigable) return;
        v.off("navigable", onNavigable);
        void go();
      };
      v.on("navigable", onNavigable);
    }
  }, [imageId]);

  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    if (mode === "street") v.deactivateComponent("spatial");
    else v.activateComponent("spatial");
    v.getComponent<SpatialComponent>("spatial").configure({ pointsVisible: mode !== "street", cellsVisible: mode === "points" });
    v.setCameraControls(mode === "points" ? CameraControls.Earth : CameraControls.Street);
  }, [mode]);

  useEffect(() => {
    viewer.current?.resize();
  }, [expanded]);

  return (
    <section className={`street-viewer ${expanded ? "is-expanded" : ""}`} aria-label="Foto de rua">
      <div ref={container} className="street-viewer-canvas" />
      <div className="street-viewer-bar">
        <div className="segmented" role="radiogroup" aria-label="Modo">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              className={mode === m.id ? "is-active" : ""}
              title={m.title}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="street-viewer-actions">
          <button type="button" className="btn" onClick={() => setExpanded((x) => !x)} title={expanded ? "Reduzir" : "Ampliar"}>
            {expanded ? "⤡" : "⤢"}
          </button>
          <button type="button" className="btn" onClick={onClose} aria-label="Fechar foto de rua">
            ×
          </button>
        </span>
      </div>
      {error && <p className="street-viewer-error">Não deu para abrir esta foto: {error}</p>}
    </section>
  );
}
