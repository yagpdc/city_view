import { categoryColor, type CityMap, type MapPick, type NearbySummary } from "@cityview/engine";
import { useEffect, useState } from "react";
import { FieldValue, formatField, labelled, type DatasetInfo } from "./PickDetails";
import { StreetPhoto } from "./StreetPhoto";

const int = new Intl.NumberFormat("pt-BR");
const RADII = [200, 500, 1000];
/** Campos mostrados no cartão (o resto fica em "Detalhes", na barra lateral). */
const MAX_FIELDS = 4;

const meters = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`);

/** Dataset usado para "o que tem por perto" (os Lugares, quando gerados). */
export interface NearbySource {
  datasetId: string;
  name: string;
  info: DatasetInfo;
}

/**
 * Cartão sobre o mapa no ponto clicado: o que é, foto da rua e o que tem por perto.
 * Os detalhes completos continuam na barra lateral ("Neste ponto").
 */
export function MapPopup({
  map,
  pick,
  datasets,
  nearbySource,
  onDetails,
  onStreetView,
  onAdvanced,
}: {
  map: CityMap;
  pick: MapPick;
  datasets: Record<string, DatasetInfo>;
  nearbySource: NearbySource | null;
  onDetails: () => void;
  onStreetView?: (imageId: string) => void;
  onAdvanced?: (pick: MapPick) => void;
}) {
  const record = pick.dataset?.kind === "record" ? pick.dataset : null;
  const info = pick.dataset ? datasets[pick.dataset.datasetId] : undefined;
  const center = pick.dataset?.lngLat ?? pick.lngLat;
  const catalog = pick.catalog[0];

  const titleText = record
    ? (info?.title && record.properties[info.title] ? String(record.properties[info.title]) : `${info?.name ?? "Registro"} #${record.id}`)
    : pick.dataset?.kind === "aggregate"
      ? `${int.format(pick.dataset.count)} registros nesta área`
      : catalog
        ? catalog.datapack.name
        : "Neste ponto";

  const fields = record
    ? labelled(
        // Sem o título e sem a coluna de cor (já aparecem no cabeçalho do cartão).
        Object.entries(record.properties).filter(
          ([k, v]) => k !== info?.title && k !== info?.colorBy && String(v).trim() !== "",
        ),
        info?.fieldLabels,
      ).slice(0, MAX_FIELDS)
    : [];

  return (
    <div className="map-popup">
      <h4>{titleText}</h4>
      {record && record.category !== null && info && (
        <p className="pick-category">
          <i style={{ background: categoryColor(record.category, info.categories) }} />
          {info.label ? info.label(info.categories[record.category] ?? "") : info.categories[record.category]}
          {record && pick.dataset && info.name ? <span className="muted"> · {info.name}</span> : null}
        </p>
      )}
      {fields.length > 0 && (
        <dl>
          {fields.map(({ key, label, value }) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>
                <FieldValue value={value} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {!record && catalog && (
        <dl>
          {catalog.datapack.fields.slice(0, MAX_FIELDS).map((f) => (
            <div key={f.key}>
              <dt>{f.label}</dt>
              <dd>{formatField(f, catalog.properties[f.key])}</dd>
            </div>
          ))}
        </dl>
      )}

      <StreetPhoto lngLat={center} onOpen={onStreetView} />

      {nearbySource && (
        <Nearby
          map={map}
          source={nearbySource}
          center={center}
          exclude={record && pick.dataset?.datasetId === nearbySource.datasetId ? record.id : null}
        />
      )}

      <div className="map-popup-actions">
        <button type="button" className="btn" onClick={onDetails}>
          Detalhes
        </button>
        {pick.dataset && onAdvanced && (
          <button type="button" className="btn btn-primary" onClick={() => onAdvanced(pick)}>
            Visualização avançada
          </button>
        )}
      </div>
    </div>
  );
}

function Nearby({
  map,
  source,
  center,
  exclude,
}: {
  map: CityMap;
  source: NearbySource;
  center: [number, number];
  exclude: number | null;
}) {
  const [radius, setRadius] = useState(500);
  const [state, setState] = useState<{ summary?: NearbySummary; error?: string }>({});
  const [lon, lat] = center;

  useEffect(() => {
    let cancelled = false;
    setState({});
    map.setRadius({ center: [lon, lat], radiusM: radius });
    map
      .nearby(source.datasetId, [lon, lat], radius)
      .then((summary) => !cancelled && setState({ summary }))
      .catch((e: Error) => !cancelled && setState({ error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [map, source.datasetId, lon, lat, radius]);

  useEffect(() => () => map.setRadius(null), [map]);

  const { info } = source;
  const summary = state.summary;
  // O próprio lugar clicado não conta como "perto".
  const points = summary?.points.filter((p) => !(exclude !== null && p.distanceM < 1)) ?? [];
  const total = summary ? points.length : 0;
  const byCategory = info.categories.map((label, i) => ({
    i,
    label,
    count: points.filter((p) => p.category === i).length,
  }));
  const top = byCategory.filter((c) => c.count > 0).sort((a, b) => b.count - a.count);
  const max = top[0]?.count ?? 1;
  const nearest = points.filter((p) => info.title && p.properties[info.title]).slice(0, 5);

  return (
    <section className="map-popup-nearby">
      <header>
        <strong>Por perto</strong>
        <span className="segmented" role="radiogroup" aria-label="Raio">
          {RADII.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={radius === r}
              className={radius === r ? "is-active" : ""}
              onClick={() => setRadius(r)}
            >
              {meters(r)}
            </button>
          ))}
        </span>
      </header>
      {state.error && <p className="muted">Não deu para contar: {state.error}</p>}
      {!summary && !state.error && <p className="muted">Contando {source.name.toLowerCase()}…</p>}
      {summary && (
        <>
          <p className="muted">
            {int.format(total)} {source.name.toLowerCase()} em {meters(radius)}
          </p>
          {top.length > 0 && (
            <ul className="bars">
              {top.slice(0, 6).map((c) => (
                <li key={c.i}>
                  <span className="bar-label">
                    <i style={{ background: categoryColor(c.i, info.categories) }} />
                    {info.label ? info.label(c.label) : c.label}
                  </span>
                  <span className="bar-track">
                    <span style={{ width: `${(c.count / max) * 100}%`, background: categoryColor(c.i, info.categories) }} />
                  </span>
                  <b>{int.format(c.count)}</b>
                </li>
              ))}
            </ul>
          )}
          {nearest.length > 0 && (
            <ol className="map-popup-nearest">
              {nearest.map((p, k) => (
                <li key={k}>
                  {String(p.properties[info.title!])}
                  {p.properties.categoria ? <span className="muted"> · {String(p.properties.categoria)}</span> : null}
                  <span className="muted"> · {meters(p.distanceM)}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
