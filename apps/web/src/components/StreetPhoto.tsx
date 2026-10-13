import { useEffect, useState } from "react";
import { nearestStreetImage, streetImageryEnabled, type StreetImage } from "../streetImagery";
import { PhotoLightbox } from "./PhotoLightbox";

const date = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric" });

/** Foto de rua mais próxima do ponto clicado (Mapillary), com crédito e licença. */
export function StreetPhoto({
  lngLat,
  onOpen,
  variant = "inline",
}: {
  lngLat: [number, number];
  onOpen?: (imageId: string) => void;
  /** "hero": foto grande no topo do cartão do mapa, clicável para andar pela rua. */
  variant?: "inline" | "hero";
}) {
  const [state, setState] = useState<{ image?: StreetImage | null; error?: string }>({});
  const [zoomed, setZoomed] = useState(false);
  const [lon, lat] = lngLat;

  useEffect(() => {
    if (!streetImageryEnabled) return;
    let cancelled = false;
    setState({});
    nearestStreetImage([lon, lat])
      .then((image) => !cancelled && setState({ image }))
      .catch((e: Error) => !cancelled && setState({ error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [lon, lat]);

  if (!streetImageryEnabled) return null;
  const hero = variant === "hero";
  if (state.error) return <p className="muted street-photo-note">Foto da rua indisponível: {state.error}</p>;
  if (state.image === undefined)
    return hero ? <div className="street-photo-hero is-loading" aria-label="Procurando foto da rua" /> : <p className="muted street-photo-note">Procurando foto da rua…</p>;
  if (state.image === null) return <p className="muted street-photo-note">Sem foto de rua num raio de ~60 m.</p>;

  const img = state.image;
  if (hero) {
    return (
      <figure className="street-photo-hero">
        <button type="button" className="street-photo-open" onClick={() => setZoomed(true)} title="Ampliar a foto">
          <img src={img.thumbUrl} alt="Foto da rua mais próxima" />
          <span className="street-photo-cta">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
            Ampliar
          </span>
        </button>
        {zoomed && <PhotoLightbox image={img} onClose={() => setZoomed(false)} onStreetView={onOpen} />}
        <figcaption>
          a {Math.round(img.distanceM)} m{img.capturedAt ? ` · ${date.format(img.capturedAt)}` : ""} ·{" "}
          <a href={img.pageUrl} target="_blank" rel="noreferrer">
            Mapillary
          </a>
          {img.author ? `, ${img.author}` : ""} ·{" "}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.pt-br" target="_blank" rel="noreferrer">
            CC BY-SA
          </a>
        </figcaption>
      </figure>
    );
  }
  return (
    <figure className="street-photo">
      <a href={img.pageUrl} target="_blank" rel="noreferrer" title="Abrir na Mapillary">
        <img src={img.thumbUrl} alt="Foto da rua mais próxima" loading="lazy" />
      </a>
      <figcaption>
        a {Math.round(img.distanceM)} m{img.capturedAt ? ` · ${date.format(img.capturedAt)}` : ""} ·{" "}
        <a href={img.pageUrl} target="_blank" rel="noreferrer">
          Mapillary
        </a>
        {img.author ? `, por ${img.author}` : ""} ·{" "}
        <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.pt-br" target="_blank" rel="noreferrer">
          CC BY-SA
        </a>
      </figcaption>
      {onOpen && (
        <button type="button" className="btn btn-block" onClick={() => onOpen(img.id)}>
          Andar pela rua (3D)
        </button>
      )}
    </figure>
  );
}
