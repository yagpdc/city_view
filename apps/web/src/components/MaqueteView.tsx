import { MaqueteScene, formatArea, type CityMap, type MaqueteData } from "@cityview/engine";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

const RADII = [150, 300, 500] as const;
const int = new Intl.NumberFormat("pt-BR");
const meters = (m: number) => (m >= 1000 ? `${m / 1000} km` : `${m} m`);

/**
 * Maquete holográfica de um ponto: a área recortada em 3D sobre fundo escuro, com os seus dados como
 * feixes de luz e as vistas técnicas (planta, fachadas). Cobre o mapa até fechar.
 */
export function MaqueteView({
  map,
  center,
  title,
  datasetIds,
  onClose,
}: {
  map: CityMap;
  center: [number, number];
  title?: string;
  datasetIds: string[];
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MaqueteScene | null>(null);
  const [radius, setRadius] = useState<(typeof RADII)[number]>(300);
  const [state, setState] = useState<{ data?: MaqueteData; error?: string; loading: boolean }>({ loading: true });
  const [rotating, setRotating] = useState(true);
  const [views, setViews] = useState(true);
  const [rects, setRects] = useState<ReturnType<MaqueteScene["viewRects"]>>([]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new MaqueteScene(host);
    sceneRef.current = scene;
    const update = () => setRects(scene.viewRects());
    const ro = new ResizeObserver(update);
    ro.observe(host);
    update();
    return () => {
      ro.disconnect();
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  const ids = datasetIds.join(",");
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    map
      .maqueteData(center, radius, ids ? ids.split(",") : [])
      .then((data) => {
        if (cancelled) return;
        sceneRef.current?.setData(data);
        setState({ data, loading: false });
      })
      .catch((e: Error) => !cancelled && setState({ error: e.message, loading: false }));
    return () => {
      cancelled = true;
    };
  }, [map, center[0], center[1], radius, ids]);

  useEffect(() => {
    if (sceneRef.current) sceneRef.current.autoRotate = rotating;
  }, [rotating]);
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.showViews = views;
  }, [views]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const download = () => {
    const url = sceneRef.current?.snapshot();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `maquete-${center[1].toFixed(5)}_${center[0].toFixed(5)}.png`;
    a.click();
  };

  const { data } = state;
  const empty = data && data.stats.buildings === 0;
  return (
    <section className="maquete" aria-label="Maquete 3D">
      <div className="maquete-canvas" ref={hostRef} />

      <header className="maquete-head">
        <div className="maquete-title">
          <span className="maquete-kicker">Maquete · raio de {meters(radius)}</span>
          <h2>{title ?? "Ponto escolhido"}</h2>
          <span className="maquete-coords num">
            {center[1].toFixed(5)}, {center[0].toFixed(5)}
          </span>
        </div>
        <button type="button" className="maquete-close" onClick={onClose} aria-label="Fechar maquete">
          <Icon name="close" size={20} />
        </button>
      </header>

      {data && !empty && (
        <div className="maquete-side">
        <dl className="maquete-stats">
          <div>
            <dt>Prédios</dt>
            <dd className="num">{int.format(data.stats.buildings)}</dd>
          </div>
          <div>
            <dt>Mais alto</dt>
            <dd className="num">{Math.round(data.stats.tallestM)} m</dd>
          </div>
          <div>
            <dt>Altura média</dt>
            <dd className="num">{Math.round(data.stats.averageHeightM)} m</dd>
          </div>
          <div>
            <dt>Área construída</dt>
            <dd className="num">{formatArea(data.stats.builtAreaM2)}</dd>
          </div>
          {datasetIds.length > 0 && (
            <div>
              <dt>Seus pontos</dt>
              <dd className="num">{int.format(data.stats.points)}</dd>
            </div>
          )}
        </dl>
        {data.stats.withHeight < data.stats.buildings && (
          <p className="maquete-note">
            {int.format(data.stats.buildings - data.stats.withHeight)} prédios sem altura no OpenStreetMap aparecem com altura estimada.
          </p>
        )}
        </div>
      )}

      {views &&
        rects.map((r) => (
          <span key={r.id} className="maquete-view-label" style={{ left: r.left + 10, top: r.top + 8 }}>
            {r.label}
          </span>
        ))}

      <div className="maquete-controls">
        <div className="maquete-segmented" role="radiogroup" aria-label="Raio">
          {RADII.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={radius === r} className={radius === r ? "is-active" : ""} onClick={() => setRadius(r)}>
              {meters(r)}
            </button>
          ))}
        </div>
        <button type="button" className={`maquete-btn ${rotating ? "is-on" : ""}`} aria-pressed={rotating} onClick={() => setRotating((v) => !v)}>
          <Icon name="compass" size={16} />
          Girar
        </button>
        <button type="button" className={`maquete-btn ${views ? "is-on" : ""}`} aria-pressed={views} onClick={() => setViews((v) => !v)}>
          <Icon name="frame" size={16} />
          Vistas técnicas
        </button>
        <button type="button" className="maquete-btn" onClick={download} disabled={!data || empty}>
          <Icon name="camera" size={16} />
          Baixar imagem
        </button>
      </div>

      {state.loading && (
        <div className="maquete-status">
          <span className="maquete-spinner" />
          Montando a maquete…
        </div>
      )}
      {!state.loading && (state.error || empty) && (
        <div className="maquete-status">
          {state.error ? `Não deu para montar: ${state.error}` : "Sem prédios em 3D aqui ainda. Por enquanto, a maquete cobre a Grande São Paulo."}
        </div>
      )}
    </section>
  );
}
