import { useEffect, useRef, useState } from "react";
import type { MapTab } from "../mapTabs";
import { Icon } from "./Icon";

/**
 * Barra de abas de mapa (como as do navegador): clicar troca, duplo clique renomeia, botão do meio
 * ou × fecha, arrastar reordena, + abre um mapa zerado, botão direito abre o menu da aba.
 */
export function MapTabs({
  tabs,
  current,
  onSelect,
  onNew,
  onClose,
  onRename,
  onMove,
  onDuplicate,
  onCloseOthers,
}: {
  tabs: MapTab[];
  current: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onMove: (id: string, toIndex: number) => void;
  onDuplicate: (id: string) => void;
  onCloseOthers: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const canClose = tabs.length > 1;
  /** Menu da aba (botão direito ou toque longo): aba e onde abrir. */
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => !menuRef.current?.contains(e.target as Node) && setMenu(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", close);
    menuRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", close);
    };
  }, [menu]);
  const menuTab = menu && tabs.find((t) => t.id === menu.id);
  const menuItems = menuTab
    ? [
        { label: "Duplicar", icon: "duplicate" as const, onClick: () => onDuplicate(menuTab.id) },
        { label: "Renomear", icon: "rename" as const, onClick: () => setEditing(menuTab.id) },
        ...(canClose
          ? [
              { label: "Fechar", icon: "close" as const, onClick: () => onClose(menuTab.id) },
              { label: "Fechar as outras", icon: "close" as const, onClick: () => onCloseOthers(menuTab.id) },
            ]
          : []),
      ]
    : [];

  // A aba atual sempre à vista (muitas abas ou tela estreita).
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>(".map-tab.is-current")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current, tabs.length]);

  return (
    <div className="map-tabs" role="tablist" aria-label="Mapas abertos" ref={strip}>
      {tabs.map((t, i) => {
        const selected = t.id === current;
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={`map-tab ${selected ? "is-current" : ""} ${dragging === t.id ? "is-dragging" : ""}`}
            title={t.title}
            draggable={editing !== t.id}
            onClick={() => onSelect(t.id)}
            onDoubleClick={() => setEditing(t.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              // Pelo teclado (Shift+F10) não há ponteiro: abre embaixo da aba.
              const x = e.clientX || r.left;
              setMenu({ id: t.id, x: Math.min(x, window.innerWidth - 200), y: e.clientY && e.clientY > r.top ? e.clientY : r.bottom });
            }}
            onAuxClick={(e) => {
              if (e.button === 1 && canClose) {
                e.preventDefault();
                onClose(t.id);
              }
            }}
            onKeyDown={(e) => {
              if (editing === t.id) return;
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!;
                onSelect(next.id);
                (e.currentTarget.parentElement?.children[tabs.indexOf(next)] as HTMLElement | undefined)?.focus();
              } else if (e.key === "F2") setEditing(t.id);
              else if (e.key === "Delete" && canClose) onClose(t.id);
            }}
            onDragStart={(e) => {
              setDragging(t.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/x-pinny-tab", t.id);
            }}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => {
              if (!dragging || dragging === t.id) return;
              e.preventDefault();
              onMove(dragging, i);
            }}
            onDrop={(e) => e.preventDefault()}
          >
            <Icon name="map" size={16} />
            {editing === t.id ? (
              <input
                className="map-tab-input"
                defaultValue={t.title}
                autoFocus
                aria-label="Nome do mapa"
                maxLength={60}
                onFocus={(e) => e.currentTarget.select()}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  const title = e.currentTarget.value.trim();
                  if (title && title !== t.title) onRename(t.id, title);
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  else if (e.key === "Escape") {
                    e.currentTarget.value = t.title;
                    e.currentTarget.blur();
                  }
                }}
              />
            ) : (
              <span className="map-tab-title">{t.title}</span>
            )}
            {canClose && (
              <button
                type="button"
                className="map-tab-close"
                aria-label={`Fechar ${t.title}`}
                title="Fechar aba"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(t.id);
                }}
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
        );
      })}
      <button type="button" className="map-tab-new" onClick={onNew} aria-label="Novo mapa" title="Novo mapa">
        <Icon name="plus" size={16} />
      </button>
      {menu && menuTab && (
        <div ref={menuRef} className="layer-menu-list map-tab-menu" role="menu" aria-label={`Opções de ${menuTab.title}`} style={{ left: menu.x, top: menu.y }}>
          {menuItems.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(null);
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
