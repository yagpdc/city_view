import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * Botão ⓘ com um balão de detalhes (passar o mouse, focar ou tocar abre; Esc ou tocar fora fecha). Para o que é
 * útil mas secundário: crédito e licença de uma foto, de onde veio um dado.
 */
export function InfoTip({
  label,
  children,
  placement = "top-end",
  tone = "light",
}: {
  /** Nome acessível do botão ("Sobre a foto"). */
  label: string;
  children: ReactNode;
  placement?: "top-end" | "top-start" | "bottom-end" | "bottom-start";
  /** "dark": botão escuro translúcido (sobre foto). */
  tone?: "light" | "dark";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc, true);
    };
  }, [open]);
  return (
    <span ref={ref} className={`info-tip is-${placement} tone-${tone}`} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="info-tip-button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => !ref.current?.contains(e.relatedTarget as Node) && setOpen(false)}
      >
        <Icon name="info" size={16} />
      </button>
      {open && (
        <span id={id} role="tooltip" className="info-tip-bubble">
          {children}
        </span>
      )}
    </span>
  );
}
