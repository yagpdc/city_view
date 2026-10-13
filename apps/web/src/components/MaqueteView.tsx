import { formatArea, type CityMap, type MaqueteData, type MaqueteSelection } from "@cityview/engine";
import { MaqueteScene } from "@cityview/engine/maquete";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { MaqueteDetails } from "./MaqueteDetails";
import type { DatasetInfo } from "./PickDetails";
import type { PlaceFacts } from "../compare";

const RADII = [150, 300, 500] as const;
const int = new Intl.NumberFormat("pt-BR");
const meters = (m: number) => (m >= 1000 ? `${m / 1000} km` : `${m} m`);

/**
 * Maquete de um ponto: a área recortada em 3D nas cores do mapa, com os seus dados como alfinetes e as
 * vistas técnicas (planta, fachadas). Fica sobre o mapa, que continua visível atrás, esmaecido.
 */
export function MaqueteView({
  map,
  center,
  title,
  datasetIds,
  theme,
  datasets,
  placeFacts,
  radius: initialRadius = 300,
  onRadius,
  onShare,
  onClose,
}: {
  map: CityMap;
  center: [number, number];
  title?: string;
  datasetIds: string[];
  /** Tema/estilo do app (troca as cores da maquete junto). */
  theme: string;
  /** Rótulos e títulos dos datasets, para os detalhes dos registros. */
  datasets: Record<string, DatasetInfo>;
  /** Município do ponto e grandezas dele (cartão "O lugar"). */
  placeFacts?: (center: [number, number]) => Promise<PlaceFacts>;
  /** Raio (m) inicial; `onRadius` avisa quando muda (para o link de compartilhar). */
  radius?: number;
  onRadius?: (r: number) => void;
  /** Copiar link com esta maquete aberta. */
  onShare?: () => void;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MaqueteScene | null>(null);
  const [radius, setRadius] = useState<(typeof RADII)[number]>(RADII.includes(initialRadius as (typeof RADII)[number]) ? (initialRadius as (typeof RADII)[number]) : 300);
  useEffect(() => onRadius?.(radius), [radius]); // eslint-disable-line react-hooks/exhaustive-deps
  const [state, setState] = useState<{ data?: MaqueteData; error?: string; loading: boolean }>({ loading: true });
  const [rotating, setRotating] = useState(true);
  /** Tela estreita (celular): dados da área recolhidos, vistas técnicas desligadas e detalhe em folha embaixo. */
  const [compact, setCompact] = useState(() => window.innerWidth < 760);
  const [infoOpen, setInfoOpen] = useState(false);
  const [views, setViews] = useState(() => window.innerWidth >= 760);
  const [rects, setRects] = useState<ReturnType<MaqueteScene["viewRects"]>>([]);
  const [selection, setSelection] = useState<MaqueteSelection>(null);
  const [place, setPlace] = useState<PlaceFacts | null>(null);
  useEffect(() => {
    let cancelled = false;
    setPlace(null);
    placeFacts?.(center)
      .then((p) => !cancelled && setPlace(p))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando o ponto muda
  }, [center[0], center[1]]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new MaqueteScene(host, map.maquetePalette());
    sceneRef.current = scene;
    scene.onSelect = setSelection;
    const update = () => {
      setRects(scene.viewRects());
      setCompact(host.clientWidth < 760);
    };
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
        setSelection(null);
        sceneRef.current?.setData(data);
        setState({ data, loading: false });
      })
      .catch((e: Error) => !cancelled && setState({ error: e.message, loading: false }));
    return () => {
      cancelled = true;
    };
  }, [map, center[0], center[1], radius, ids]);

  // Tema mudou: mesmas formas, cores novas.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setPalette(map.maquetePalette());
    if (state.data) scene.setData(state.data);
    scene.select(selection);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando o tema muda
  }, [theme]);
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.autoRotate = rotating;
  }, [rotating]);
  useEffect(() => {
    if (!sceneRef.current) return;
    sceneRef.current.showViews = views;
    setRects(sceneRef.current.viewRects());
  }, [views]);
  const clearSelection = () => {
    sceneRef.current?.select(null);
    setSelection(null);
  };
  useEffect(() => {
    // Esc fecha primeiro o detalhe, depois a maquete.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selection) clearSelection();
      else onClose();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose, selection]);

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
          {compact && data && !empty && !selection && (
            <button type="button" className="maquete-info-toggle" aria-expanded={infoOpen} onClick={() => setInfoOpen((o) => !o)}>
              <Icon name={infoOpen ? "chevronUp" : "chevronDown"} size={16} />
              {infoOpen ? "Esconder dados da área" : "Dados da área"}
            </button>
          )}
        </div>
        <button type="button" className="maquete-close" onClick={onClose} aria-label="Fechar maquete">
          <Icon name="close" size={20} />
        </button>
      </header>

      {data && selection && (
        <div className={compact ? "maquete-sheet" : "maquete-side"}>
          <MaqueteDetails key={`${selection.kind}:${selection.index}`} data={data} selection={selection} datasets={datasets} onClose={clearSelection} />
        </div>
      )}
      {data && !empty && !selection && (!compact || infoOpen) && (
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
        {place && <PlaceCard place={place} />}
        <p className="maquete-note">{compact ? "Toque" : "Clique"} num prédio ou alfinete para ver os dados.</p>
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
        <button type="button" className={`maquete-btn ${rotating ? "is-on" : ""}`} aria-pressed={rotating} onClick={() => setRotating((v) => !v)} aria-label="Girar" title="Girar">
          <Icon name="compass" size={16} />
          <span className="maquete-btn-label">Girar</span>
        </button>
        <button type="button" className={`maquete-btn ${views ? "is-on" : ""}`} aria-pressed={views} onClick={() => setViews((v) => !v)} aria-label="Vistas técnicas" title="Vistas técnicas">
          <Icon name="frame" size={16} />
          <span className="maquete-btn-label">Vistas técnicas</span>
        </button>
        {onShare && (
          <button type="button" className="maquete-btn" onClick={onShare} aria-label="Copiar link" title="Copiar link">
            <Icon name="share" size={16} />
            <span className="maquete-btn-label">Copiar link</span>
          </button>
        )}
        <button type="button" className="maquete-btn" onClick={download} disabled={!data || empty} aria-label="Baixar imagem" title="Baixar imagem">
          <Icon name="camera" size={16} />
          <span className="maquete-btn-label">Baixar imagem</span>
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
          {state.error ? `Não deu para montar: ${state.error}` : "Sem prédios em 3D aqui ainda. Por enquanto, a maquete cobre as principais cidades (capitais e grandes regiões metropolitanas)."}
        </div>
      )}
    </section>
  );
}

const compactNum = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

/** O município do ponto: população, área, densidade e as camadas da biblioteca no projeto. */
function PlaceCard({ place }: { place: PlaceFacts }) {
  const density = place.population && place.areaKm2 > 0 ? place.population / place.areaKm2 : null;
  return (
    <section className="maquete-place" aria-label="O lugar">
      <span className="maquete-place-kicker">{place.kind === "municipio" ? "Município" : "Região"}</span>
      <b>{place.name}</b>
      <dl>
        {place.population !== undefined && (
          <div>
            <dt>População (IBGE 2022)</dt>
            <dd className="num">{int.format(place.population)}</dd>
          </div>
        )}
        <div>
          <dt>Área</dt>
          <dd className="num">{int.format(Math.round(place.areaKm2))} km²</dd>
        </div>
        {density !== null && (
          <div>
            <dt>Densidade</dt>
            <dd className="num">{int.format(Math.round(density))} hab/km²</dd>
          </div>
        )}
        {place.comparisons.map((c) => (
          <div key={c.id}>
            <dt>{c.label}</dt>
            <dd className="num">
              {compactNum.format(c.value)} {c.unit && <span className="muted">{c.unit.toLowerCase()}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
