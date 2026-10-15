import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/** Painéis do trilho à esquerda: uma tarefa por vez (docs/DESIGN.md · Estrutura). */
export type PanelId = "layers" | "add" | "details" | "settings" | "widgets";

/**
 * Cor de cada área. A plataforma tem uma cor só, o lilás da marca (2026-10-15): todas as gavetas usam o mesmo
 * mundo; as outras cores ficam para os personagens. Mantido por área para um dia diferenciar sem mexer no resto.
 */
export const PANEL_WORLD: Record<PanelId, "lilac"> = {
  layers: "lilac",
  add: "lilac",
  details: "lilac",
  widgets: "lilac",
  settings: "lilac",
};

const RAIL: { id: PanelId; label: string; icon: IconName }[] = [
  { id: "layers", label: "Camadas", icon: "layers" },
  { id: "add", label: "Adicionar", icon: "addCircle" },
  { id: "details", label: "Detalhes", icon: "info" },
  { id: "widgets", label: "Widgets", icon: "widgets" },
  { id: "settings", label: "Ajustes", icon: "sliders" },
];

/** Botão redondo que não abre gaveta (ex.: Anotar abre a barra de ferramentas sobre o mapa). */
export interface RailExtra {
  key: string;
  label: string;
  icon: IconName;
  active: boolean;
  onClick: () => void;
}

export function Rail({
  panel,
  onPanel,
  badges,
  extras = [],
}: {
  panel: PanelId | null;
  onPanel: (id: PanelId | null) => void;
  badges?: Partial<Record<PanelId, number>>;
  extras?: RailExtra[];
}) {
  const extraButtons = extras.map((x) => (
    <button key={x.key} type="button" className={`rail-item world-lilac ${x.active ? "is-active" : ""}`} aria-pressed={x.active} aria-label={x.label} title={x.label} onClick={x.onClick}>
      <span className="rail-icon">
        <Icon name={x.icon} />
      </span>
      <span className="rail-label">{x.label}</span>
    </button>
  ));
  return (
    <nav className="rail" aria-label="Ferramentas">
      {RAIL.flatMap((r) => {
        const on = panel === r.id;
        const item = (
          <button
            key={r.id}
            type="button"
            className={`rail-item world-${PANEL_WORLD[r.id]} ${on ? "is-active" : ""}`}
            aria-pressed={on}
            aria-controls="panel"
            aria-label={r.label}
            title={r.label}
            onClick={() => onPanel(on ? null : r.id)}
          >
            <span className="rail-icon">
              <Icon name={r.icon} />
              {badges?.[r.id] ? <span className="rail-badge">{badges[r.id]}</span> : null}
            </span>
            <span className="rail-label">{r.label}</span>
          </button>
        );
        // Os extras vêm logo depois de "Adicionar".
        return r.id === "add" ? [item, ...extraButtons] : [item];
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

const ORIGIN_LABEL = { public: "Público", user: "Seu dado", sample: "Exemplo" } as const;

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
  origin,
  meta,
  visible,
  onVisible,
  onStyle,
  actions,
  status,
  progress,
  children,
}: {
  badge: string;
  tone: string;
  title: string;
  /** De onde vem o dado: o produto visualiza dados públicos e do usuário com o mesmo peso. */
  origin?: "public" | "user" | "sample";
  meta: ReactNode;
  visible: boolean;
  onVisible?: (visible: boolean) => void;
  /** Abre o editor de estilo da camada. */
  onStyle?: () => void;
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
          <span>
            {origin && <span className={`origin-tag origin-${origin}`}>{ORIGIN_LABEL[origin]}</span>}
            <span className="layer-card-meta">{meta}</span>
          </span>
        </span>
        {status === "working" ? (
          <span className="spinner" aria-label="Processando" />
        ) : (
          onVisible && (
            <>
            {onStyle && (
              <button type="button" className="icon-button sm" onClick={onStyle} aria-label={`Editar o estilo de ${title}`} title="Editar estilo">
                <Icon name="palette" size={18} />
              </button>
            )}
            <button
              type="button"
              className="icon-button sm"
              onClick={() => onVisible(!visible)}
              aria-label={visible ? `Esconder ${title}` : `Mostrar ${title}`}
              title={visible ? "Esconder" : "Mostrar"}
            >
              <Icon name={visible ? "eye" : "eyeOff"} size={18} />
            </button>
            </>
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

/**
 * Legenda de categorias: bolinha da cor do dado, nome e contagem opcional.
 * Com `onChange`, vira o filtro da camada: clicar liga/desliga a categoria, "só" isola uma.
 * `selected` são os índices visíveis (null = todas).
 */
export function CategoryLegend({
  items,
  max = 6,
  selected = null,
  onChange,
}: {
  items: { label: string; color: string; count?: number; icon?: ReactNode }[];
  max?: number;
  selected?: number[] | null;
  onChange?: (selected: number[] | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (onChange && items.length > 1) {
    const isOn = (i: number) => !selected || selected.includes(i);
    const shown = expanded ? items : items.slice(0, max);
    const toggleItem = (i: number) => {
      const current = selected ?? items.map((_, k) => k);
      const next = current.includes(i) ? current.filter((k) => k !== i) : [...current, i].sort((a, b) => a - b);
      onChange(next.length === items.length ? null : next);
    };
    const only = (i: number) => onChange(selected?.length === 1 && selected[0] === i ? null : [i]);
    return (
      <div className="legend-filter">
        <div className="legend-filter-head">
          {selected ? (
            <>
              <span className="legend-filter-state">
                <Icon name="filter" size={16} />
                <span>
                  <span className="num">{selected.length}</span> de <span className="num">{items.length}</span> categorias
                </span>
              </span>
              <button type="button" className="link-button" onClick={() => onChange(null)}>
                Mostrar todas
              </button>
            </>
          ) : (
            <span className="muted">Clique numa categoria para filtrar</span>
          )}
        </div>
        <ul className="legend-list is-interactive">
          {shown.map((it, i) => (
            <li key={it.label} className={isOn(i) ? "" : "is-off"}>
              <button type="button" className="legend-item" aria-pressed={isOn(i)} onClick={() => toggleItem(i)} title={isOn(i) ? `Esconder ${it.label}` : `Mostrar ${it.label}`}>
                {it.icon ? (
                  <i className="legend-icon" style={{ background: it.color, borderColor: it.color }}>
                    {it.icon}
                  </i>
                ) : (
                  <i style={{ background: it.color, borderColor: it.color }} />
                )}
                <span>{it.label}</span>
                {it.count !== undefined && <span className="num">{int.format(it.count)}</span>}
              </button>
              <button type="button" className="legend-only" onClick={() => only(i)} aria-label={`Mostrar só ${it.label}`} title={`Só ${it.label}`}>
                só
              </button>
            </li>
          ))}
          {items.length > max && (
            <li>
              <button type="button" className="link-button" onClick={() => setExpanded((e) => !e)}>
                {expanded ? "Mostrar menos" : `+ ${items.length - max} categorias`}
              </button>
            </li>
          )}
        </ul>
      </div>
    );
  }
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
      {/* Unidade em cima, como título da escala; embaixo só o menor e o maior valor. */}
      {unit && <span className="legend-unit">{unit}</span>}
      <div className="legend-bar">
        {colors.map((c) => (
          <span key={c} style={{ background: c }} />
        ))}
      </div>
      <div className="legend-ends num">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
