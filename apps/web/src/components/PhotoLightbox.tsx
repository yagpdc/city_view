import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { StreetImage } from "../streetImagery";
import { Icon } from "./Icon";

const date = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });

/**
 * Foto de rua ampliada, quase do tamanho do mapa (por cima do mapa e da maquete). Clicar na foto abre o app da
 * Mapillary; Esc, o × ou clicar fora fecham.
 */
export function PhotoLightbox({ image, onClose, onStreetView }: { image: StreetImage; onClose: () => void; onStreetView?: (imageId: string) => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Esc fecha só a foto (não o cartão nem a maquete por baixo).
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [onClose]);

  const host = document.querySelector(".map-area") ?? document.body;
  return createPortal(
    <div className="photo-lightbox" role="dialog" aria-modal="true" aria-label="Foto da rua ampliada" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <figure className="photo-lightbox-frame">
        <a href={image.pageUrl} target="_blank" rel="noreferrer" className="photo-lightbox-open" title="Abrir no app da Mapillary">
          <img src={image.largeUrl} alt="Foto da rua mais próxima, ampliada" />
          <span className="photo-lightbox-hint">
            <Icon name="external" size={16} />
            Abrir no app da Mapillary
          </span>
        </a>
        <figcaption>
          <span>
            a {Math.round(image.distanceM)} m{image.capturedAt ? ` · ${date.format(image.capturedAt)}` : ""}
            {image.author ? ` · foto de ${image.author}` : ""} · Mapillary ·{" "}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.pt-br" target="_blank" rel="noreferrer">
              CC BY-SA
            </a>
          </span>
          {onStreetView && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                onClose();
                onStreetView(image.id);
              }}
            >
              Andar pela rua (3D)
            </button>
          )}
        </figcaption>
        <button type="button" className="photo-lightbox-close" onClick={onClose} aria-label="Fechar foto">
          <Icon name="close" size={20} />
        </button>
      </figure>
    </div>,
    host,
  );
}
