import { useEffect, useState } from "react";
import { nearestStreetImage, streetImageryEnabled, type StreetImage } from "../streetImagery";
import { PhotoLightbox } from "./PhotoLightbox";
import { InfoTip } from "./InfoTip";
import { Icon } from "./Icon";

const date = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric" });
const longDate = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });

/** "15 m", "1,2 km". */
export const distanceLabel = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(m / 1000)} km`);

/** Crédito da foto (data, autor, fonte, licença), para o balão ⓘ. */
function PhotoCredit({ img }: { img: StreetImage }) {
  return (
    <dl className="photo-credit">
      {img.capturedAt && (
        <div>
          <dt>Tirada em</dt>
          <dd>{longDate.format(img.capturedAt)}</dd>
        </div>
      )}
      {img.author && (
        <div>
          <dt>Autor</dt>
          <dd>{img.author}</dd>
        </div>
      )}
      <div>
        <dt>Fonte</dt>
        <dd>
          <a href={img.pageUrl} target="_blank" rel="noreferrer">
            Mapillary
          </a>
        </dd>
      </div>
      <div>
        <dt>Licença</dt>
        <dd>
          <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.pt-br" target="_blank" rel="noreferrer">
            CC BY-SA 4.0
          </a>
        </dd>
      </div>
    </dl>
  );
}

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
            <Icon name="expand" size={16} />
            Ampliar
          </span>
        </button>
        {/* Distância entre a foto e o ponto: selo sobre a foto. */}
        <span className="photo-chip photo-distance" title="Distância entre o lugar da foto e o ponto clicado">
          <Icon name="pin" size={16} />
          <span className="num">{distanceLabel(img.distanceM)}</span>
        </span>
        <span className="photo-credit-tip">
          <InfoTip label="Sobre a foto" placement="bottom-end" tone="dark">
            <PhotoCredit img={img} />
          </InfoTip>
        </span>
        {zoomed && <PhotoLightbox image={img} onClose={() => setZoomed(false)} onStreetView={onOpen} />}
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
