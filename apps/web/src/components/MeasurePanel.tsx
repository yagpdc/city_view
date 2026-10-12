import { formatArea, formatDistance, type MeasureMode, type MeasureState } from "@cityview/engine";
import { Icon } from "./Icon";

/** Resultado da medição, flutuando no rodapé do mapa enquanto a ferramenta está ligada. */
export function MeasurePanel({
  state,
  mode,
  onMode,
  onUndo,
  onClear,
  onClose,
}: {
  state: MeasureState | null;
  mode: MeasureMode;
  onMode: (mode: MeasureMode) => void;
  onUndo: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const n = state?.points.length ?? 0;
  const area = mode === "area";
  const main = !state || n === 0 ? "—" : area ? (n >= 2 ? formatArea(state.areaM2) : "—") : formatDistance(state.lengthM);
  const hint =
    n === 0
      ? "Clique no mapa para marcar o primeiro ponto."
      : state?.done
        ? "Medição concluída. Clique de novo para começar outra."
        : area && n < 3
          ? "Marque pelo menos 3 pontos. Duplo clique ou Enter conclui."
          : "Duplo clique ou Enter conclui · Backspace desfaz · Esc sai.";
  return (
    <section className="measure-panel" aria-label="Medir">
      <header className="measure-head">
        <span className="measure-title">
          <Icon name="ruler" size={18} />
          Medir
        </span>
        <div className="segmented" role="radiogroup" aria-label="O que medir">
          {(["distance", "area"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? "is-active" : ""} onClick={() => onMode(m)}>
              {m === "distance" ? "Distância" : "Área"}
            </button>
          ))}
        </div>
        <button type="button" className="icon-button sm" onClick={onClose} aria-label="Sair da medição">
          <Icon name="close" size={18} />
        </button>
      </header>
      <div className="measure-value" aria-live="polite">
        <span className="num">{main}</span>
        {area && state && n >= 2 && <span className="muted">perímetro {formatDistance(state.perimeterM)}</span>}
        {!area && n > 1 && <span className="muted">{n - 1} {n - 1 === 1 ? "trecho" : "trechos"}</span>}
      </div>
      <p className="measure-hint muted">{hint}</p>
      <div className="measure-actions">
        <button type="button" className="btn" onClick={onUndo} disabled={n === 0}>
          Desfazer ponto
        </button>
        <button type="button" className="btn" onClick={onClear} disabled={n === 0}>
          Limpar
        </button>
      </div>
      <p className="measure-note muted">Distâncias e áreas no elipsoide WGS84 (GeographicLib).</p>
    </section>
  );
}
