import { Icon } from "./Icon";

/** Barra superior: marca e ferramentas do mapa (docs/DESIGN.md · Estrutura). */
export function TopBar({
  perspective,
  onPerspective,
  onShare,
  widgetsOpen,
  onToggleWidgets,
}: {
  perspective: "2d" | "3d";
  onPerspective: (mode: "2d" | "3d") => void;
  onShare: () => void;
  widgetsOpen: boolean;
  onToggleWidgets: () => void;
}) {
  return (
    <header className="topbar">
      <span className="brand">
        <span className="brand-mark" aria-hidden="true" />
        City View
      </span>
      <span className="topbar-spacer" />
      <div className="segmented topbar-perspective" role="radiogroup" aria-label="Perspectiva">
        {(["2d", "3d"] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={perspective === m} className={perspective === m ? "is-active" : ""} onClick={() => onPerspective(m)}>
            {m.toUpperCase()}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={`icon-button ${widgetsOpen ? "is-on" : ""}`}
        aria-pressed={widgetsOpen}
        aria-label={widgetsOpen ? "Esconder painel Na tela" : "Mostrar painel Na tela"}
        title="Na tela"
        onClick={onToggleWidgets}
      >
        <Icon name="widgets" />
      </button>
      <button type="button" className="btn btn-primary topbar-share" onClick={onShare}>
        <Icon name="share" size={16} />
        <span>Compartilhar</span>
      </button>
    </header>
  );
}
