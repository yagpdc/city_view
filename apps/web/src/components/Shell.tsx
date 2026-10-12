import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/** Painéis do trilho à esquerda: uma tarefa por vez (docs/DESIGN.md · Estrutura). */
export type PanelId = "layers" | "add" | "explore" | "details" | "settings";

const RAIL: { id: PanelId; label: string; icon: IconName }[] = [
  { id: "layers", label: "Camadas", icon: "layers" },
  { id: "add", label: "Adicionar", icon: "addCircle" },
  { id: "explore", label: "Explorar", icon: "compass" },
  { id: "details", label: "Detalhes", icon: "info" },
  { id: "settings", label: "Ajustes", icon: "sliders" },
];

export function Rail({ panel, onPanel, badges }: { panel: PanelId | null; onPanel: (id: PanelId | null) => void; badges?: Partial<Record<PanelId, number>> }) {
  return (
    <nav className="rail" aria-label="Ferramentas">
      {RAIL.map((r) => {
        const on = panel === r.id;
        return (
          <button
            key={r.id}
            type="button"
            className={`rail-item ${on ? "is-active" : ""}`}
            aria-pressed={on}
            aria-controls="panel"
            onClick={() => onPanel(on ? null : r.id)}
          >
            <span className="rail-icon">
              <Icon name={r.icon} />
              {badges?.[r.id] ? <span className="rail-badge">{badges[r.id]}</span> : null}
            </span>
            <span className="rail-label">{r.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** Painel lateral: título forte, ação opcional, conteúdo rolável sobre fundo cinza e rodapé opcional. */
export function Panel({
  title,
  action,
  footer,
  onClose,
  children,
}: {
  title: string;
  action?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside id="panel" className="panel" aria-label={title}>
      <header className="panel-header">
        <h2>{title}</h2>
        <span className="panel-header-actions">
          {action}
          <button type="button" className="icon-button sm panel-close" onClick={onClose} aria-label="Fechar painel">
            <Icon name="close" size={18} />
          </button>
        </span>
      </header>
      <div className="panel-body">{children}</div>
      {footer && <footer className="panel-footer">{footer}</footer>}
    </aside>
  );
}

/** Bloco de conteúdo dentro de um painel: cartão branco com título legível. */
export function PanelCard({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel-card">
      {(title || aside) && (
        <header className="panel-card-header">
          {title && <h3>{title}</h3>}
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

export interface LayerAction {
  label: string;
  icon: IconName;
  onClick: () => void;
  danger?: boolean;
}

/**
 * Cartão de camada: letra de identificação, nome, fonte/quantidade, olho (mostrar/esconder) e
 * menu ⋯. Visível, mostra a legenda e as opções; escondida, fica apagada.
 */
export function LayerCard({
  badge,
  tone,
  title,
  meta,
  visible,
  onVisible,
  actions,
  status,
  progress,
  children,
}: {
  badge: string;
  tone: string;
  title: string;
  meta: ReactNode;
  visible: boolean;
  onVisible?: (visible: boolean) => void;
  actions?: LayerAction[];
  status?: "working" | "error";
  progress?: number;
  children?: ReactNode;
}) {
  return (
    <article className={`layer-card ${visible ? "" : "is-hidden"}`}>
      <div className="layer-card-head">
        <span className="layer-badge" style={{ background: `color-mix(in srgb, ${tone} 16%, var(--cv-float))`, color: tone }}>
          {badge}
        </span>
        <span className="layer-card-text">
          <b title={title}>{title}</b>
          <span>{meta}</span>
        </span>
        {status === "working" ? (
          <span className="spinner" aria-label="Processando" />
        ) : (
          onVisible && (
            <button
              type="button"
              className="icon-button sm"
              onClick={() => onVisible(!visible)}
              aria-label={visible ? `Esconder ${title}` : `Mostrar ${title}`}
              title={visible ? "Esconder" : "Mostrar"}
            >
              <Icon name={visible ? "eye" : "eyeOff"} size={18} />
            </button>
          )
        )}
        {actions && actions.length > 0 && <LayerMenu title={title} actions={actions} />}
      </div>
      {progress !== undefined && (
        <div className="progress mini layer-progress">
          <div style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      {visible && children && <div className="layer-card-body">{children}</div>}
    </article>
  );
}

function LayerMenu({ title, actions }: { title: string; actions: LayerAction[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="layer-menu" ref={ref}>
      <button type="button" className="icon-button sm" aria-haspopup="menu" aria-expanded={open} aria-label={`Mais opções de ${title}`} onClick={() => setOpen((o) => !o)}>
        <Icon name="more" size={18} />
      </button>
      {open && (
        <div className="layer-menu-list" role="menu">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              className={a.danger ? "is-danger" : ""}
              onClick={() => {
                setOpen(false);
                a.onClick();
              }}
            >
              <Icon name={a.icon} size={16} />
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const int = new Intl.NumberFormat("pt-BR");

/** Legenda de categorias: bolinha da cor do dado, nome e contagem opcional. */
export function CategoryLegend({ items, max = 6 }: { items: { label: string; color: string; count?: number }[]; max?: number }) {
  const shown = items.slice(0, max);
  return (
    <ul className="legend-list">
      {shown.map((it) => (
        <li key={it.label}>
          <i style={{ background: it.color }} />
          <span>{it.label}</span>
          {it.count !== undefined && <span className="num">{int.format(it.count)}</span>}
        </li>
      ))}
      {items.length > max && <li className="muted">+ {items.length - max} categorias</li>}
    </ul>
  );
}

/** Legenda de escala (densidade, coroplético): faixa de cores e extremos em DM Mono. */
export function ScaleLegend({ colors, min, max, unit }: { colors: string[]; min: string; max: string; unit?: string }) {
  return (
    <div className="legend-scale-block">
      <div className="legend-bar">
        {colors.map((c) => (
          <span key={c} style={{ background: c }} />
        ))}
      </div>
      <div className="legend-ends num">
        <span>{min}</span>
        {unit && <span>{unit}</span>}
        <span>{max}</span>
      </div>
    </div>
  );
}
