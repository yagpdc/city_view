import { useRef, type ReactNode } from "react";
import { Icon } from "./Icon";

/** Posição e tamanho de um widget sobre o mapa (px, relativo à área do mapa). */
export interface WidgetRect {
  x: number;
  y: number;
  w: number;
  h: number;
  minimized?: boolean;
}

const MIN_W = 240;
const MIN_H = 140;
const HEAD_H = 44;

/**
 * Janela de widget solta sobre o mapa: arrasta pelo título, redimensiona pelo canto, minimiza (só o título) e
 * fecha. Fica dentro da área do mapa.
 */
export function FloatingWidget({
  title,
  icon = "chart",
  rect,
  onRect,
  onClose,
  children,
}: {
  title: string;
  icon?: "chart";
  rect: WidgetRect;
  onRect: (r: WidgetRect) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);

  /** Limites da área do mapa (o pai do widget). */
  const bounds = () => {
    const parent = ref.current?.parentElement;
    return { w: parent?.clientWidth ?? window.innerWidth, h: parent?.clientHeight ?? window.innerHeight };
  };
  const clamp = (r: WidgetRect): WidgetRect => {
    const b = bounds();
    const w = Math.min(Math.max(MIN_W, r.w), b.w - 16);
    const h = Math.min(Math.max(MIN_H, r.h), b.h - 16);
    const shownH = r.minimized ? HEAD_H : h;
    return { ...r, w, h, x: Math.min(Math.max(8, r.x), b.w - w - 8), y: Math.min(Math.max(8, r.y), b.h - shownH - 8) };
  };

  /** Arrasto genérico: mover (pelo título) ou redimensionar (pelo canto). */
  const drag = (e: React.PointerEvent, mode: "move" | "resize") => {
    if (e.button !== 0) return;
    if (mode === "move" && (e.target as Element).closest("button")) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, r: rect };
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      onRect(clamp(mode === "move" ? { ...start.r, x: start.r.x + dx, y: start.r.y + dy } : { ...start.r, w: start.r.w + dx, h: start.r.h + dy }));
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  return (
    <section
      ref={ref}
      className={`floating-widget ${rect.minimized ? "is-min" : ""}`}
      aria-label={title}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.minimized ? undefined : rect.h }}
    >
      <header className="floating-widget-head" onPointerDown={(e) => drag(e, "move")} title="Arraste para mover">
        <Icon name={icon} size={16} />
        <h3>{title}</h3>
        <button
          type="button"
          className="icon-button sm"
          onClick={() => onRect(clamp({ ...rect, minimized: !rect.minimized }))}
          aria-label={rect.minimized ? `Abrir ${title}` : `Minimizar ${title}`}
          title={rect.minimized ? "Abrir" : "Minimizar"}
        >
          <Icon name={rect.minimized ? "chevronDown" : "chevronUp"} size={16} />
        </button>
        <button type="button" className="icon-button sm" onClick={onClose} aria-label={`Fechar ${title}`} title="Fechar">
          <Icon name="close" size={16} />
        </button>
      </header>
      {!rect.minimized && (
        <>
          <div className="floating-widget-body">{children}</div>
          <span className="floating-widget-resize" onPointerDown={(e) => drag(e, "resize")} aria-hidden="true" title="Arraste para redimensionar" />
        </>
      )}
    </section>
  );
}
