import { Icon } from "./Icon";

const int = new Intl.NumberFormat("pt-BR");

export interface ViewportWidget {
  key: string;
  title: string;
  count: number;
  total?: number;
  /** "points": contagem exata do que está na tela; "hex": soma dos hexágonos visíveis (aproximada nas bordas). */
  mode: "points" | "hex";
  bars: { label: string; color: string; n: number }[];
  /** Quantas categorias o filtro do cartão deixa visíveis (ausente = todas). */
  filtered?: number;
}

/** Painel "Na tela" à direita: números do que está visível agora, atualizados ao mover o mapa. */
export function WidgetsPanel({ widgets, onClose }: { widgets: ViewportWidget[]; onClose: () => void }) {
  return (
    <aside className="widgets" aria-label="Na tela">
      <header className="panel-header">
        <h2>Na tela</h2>
        <button type="button" className="icon-button sm" onClick={onClose} aria-label="Fechar painel Na tela">
          <Icon name="close" size={18} />
        </button>
      </header>
      <div className="panel-body">
        {widgets.length === 0 && (
          <section className="panel-card empty-card">
            <span className="empty-icon">
              <Icon name="chart" size={24} />
            </span>
            <b>Nada para contar aqui</b>
            <span className="muted">Ligue uma camada de pontos (seus dados, Lugares) para ver quantos aparecem na tela e de que tipo.</span>
          </section>
        )}
        {widgets.map((w) => {
          const max = Math.max(1, ...w.bars.map((b) => b.n));
          return (
            <section key={w.key} className="panel-card widget">
              <header className="panel-card-header">
                <h3>{w.title}</h3>
                {w.filtered !== undefined && (
                  <span className="widget-filter" title="O filtro do cartão da camada vale aqui">
                    <Icon name="filter" size={16} />
                    filtrado
                  </span>
                )}
              </header>
              {w.count === 0 ? (
                <p className="panel-text">Nada desta camada nesta parte do mapa. Mova ou aproxime o mapa.</p>
              ) : (
                <div className="widget-count">
                  <span className="num">{int.format(w.count)}</span>
                  <span className="muted">{w.mode === "points" ? "na tela agora" : "na tela agora (por região)"}</span>
                </div>
              )}
              {w.bars.length > 0 && (
                <ul className="widget-bars">
                  {w.bars.slice(0, 6).map((b) => (
                    <li key={b.label}>
                      <span className="widget-bar-label">
                        <i style={{ background: b.color }} />
                        <span>{b.label}</span>
                        <span className="num">{int.format(b.n)}</span>
                      </span>
                      <span className="widget-bar-track">
                        <span style={{ width: `${(b.n / max) * 100}%`, background: b.color }} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
