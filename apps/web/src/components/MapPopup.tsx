import { categoryColor, matchesWhere, type CityMap, type MapPick, type NearbySummary, type Where } from "@cityview/engine";
import { useEffect, useState } from "react";
/** Campos que formam a linha de resumo sob o título (o primeiro que existir). */
const SUMMARY_KEYS = ["endereco", "address", "endereço", "cidade"];
import { FieldValue, formatField, labelled, type DatasetInfo } from "./PickDetails";
import { StreetPhoto } from "./StreetPhoto";
import { Icon } from "./Icon";

const int = new Intl.NumberFormat("pt-BR");
const RADII = [200, 500, 1000];
/** Campos em "Mais informações" (todos ficam na barra lateral). */
const MAX_FIELDS = 8;

const meters = (m: number) =>
  m < 1000 ? `${Math.round(m)} m` : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(m / 1000)} km`;

/** Dataset usado para "o que tem por perto" (os Lugares, quando gerados). */
export interface NearbySource {
  datasetId: string;
  name: string;
  info: DatasetInfo;
  /** Categorias visíveis pelo filtro do cartão da camada (null = todas). */
  categories?: number[] | null;
  /** Condições por coluna do filtro do cartão. */
  where?: Where | null;
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
      ? pick.dataset.name
        ? `${pick.dataset.name}: ${int.format(pick.dataset.count)} ${pick.dataset.count === 1 ? "registro" : "registros"}`
        : `${int.format(pick.dataset.count)} registros nesta área`
      : catalog
        ? catalog.datapack.name
        : "Neste ponto";

  const [expanded, setExpanded] = useState(false);
  const summary = record
    ? SUMMARY_KEYS.map((k) => record.properties[k]).find((v) => v !== undefined && String(v).trim() !== "")
    : undefined;

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
      <StreetPhoto lngLat={center} onOpen={onStreetView} variant="hero" />

      <h4>{titleText}</h4>
      {record && record.category !== null && info && (
        <p className="pick-category">
          <i style={{ background: categoryColor(record.category, info.categories) }} />
          {info.label ? info.label(info.categories[record.category] ?? "") : info.categories[record.category]}
          {info.name ? <span className="muted"> · {info.name}</span> : null}
        </p>
      )}
      {summary !== undefined && <p className="map-popup-summary">{String(summary)}</p>}
      {/* Afastado, numa área muito densa, o ponto representa a região e vem sem as colunas. */}
      {record && Object.keys(record.properties).length === 0 && (
        <p className="map-popup-summary">
          Ponto de uma área com muitos registros.{" "}
          <button type="button" className="link" onClick={() => map.flyTo({ center, zoom: 15 })}>
            Aproximar aqui
          </button>{" "}
          para ver os dados de cada um.
        </p>
      )}

      <div className="map-popup-actions">
        <button type="button" className="btn" aria-expanded={expanded} onClick={() => setExpanded((x) => !x)}>
          {expanded ? "Menos informações" : "Mais informações"}
          <Icon name={expanded ? "chevronUp" : "chevronDown"} size={16} />
        </button>
        {onAdvanced && (
          <button type="button" className="btn" onClick={() => onAdvanced(pick)} title="Maquete 3D da área">
            Maquete 3D
          </button>
        )}
      </div>

      {expanded && (
        <div className="map-popup-more">
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
          {nearbySource && (
            <Nearby
              map={map}
              source={nearbySource}
              center={center}
              exclude={record && pick.dataset?.datasetId === nearbySource.datasetId ? record.id : null}
            />
          )}
          <button type="button" className="link map-popup-all" onClick={onDetails}>
            Todos os campos na barra lateral →
          </button>
        </div>
      )}
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
  const allowed = source.categories;
  const where = source.where ?? undefined;
  const points =
    summary?.points.filter(
      (p) =>
        !(exclude !== null && p.distanceM < 1) &&
        (!allowed || (p.category !== null && allowed.includes(p.category))) &&
        matchesWhere(p.properties, where),
    ) ?? [];
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
            {(allowed || where) && " · com o filtro da camada"}
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
