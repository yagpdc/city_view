import { categoryColor, matchesWhere, type CityMap, type MapPick, type NearbySummary, type Where } from "@cityview/engine";
import { useEffect, useRef, useState, type ReactNode } from "react";
/** Campos que formam a linha de resumo sob o título (o primeiro que existir). */
const SUMMARY_KEYS = ["endereco", "address", "endereço", "cidade"];
import { FieldValue, formatField, labelled, type DatasetInfo } from "./PickDetails";
import { StreetPhoto } from "./StreetPhoto";
import { InfoTip } from "./InfoTip";
import { Icon, type IconName } from "./Icon";

const int = new Intl.NumberFormat("pt-BR");
const RADII = [200, 500, 1000];
/** Campos em "Mais informações" (todos ficam na barra lateral). */
const MAX_FIELDS = 8;

/** Aba do cartão: o registro, a região da sua camada ou uma camada de áreas (`area:<id da camada>`). */
type PopupView = "record" | "aggregate" | `area:${string}`;

/** Camada em tiles ligada; `user` = dado da pessoa (para dizer "importe de novo" quando faltar a contagem). */
export interface UserLayer {
  id: string;
  info: DatasetInfo;
  user?: boolean;
}

/**
 * Linha de opções que rola para o lado (não cresce): quando há opções escondidas, setas e um esmaecido na borda.
 */
function ScrollRow({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * 160, behavior: "smooth" });
  return (
    <div className={`map-popup-tabs-wrap ${edges.left ? "can-left" : ""} ${edges.right ? "can-right" : ""}`}>
      {edges.left && (
        <button type="button" className="map-popup-tabs-arrow is-left" onClick={() => scroll(-1)} aria-label="Ver opções anteriores">
          <Icon name="chevronLeft" size={16} />
        </button>
      )}
      <div ref={ref} className="map-popup-tabs" role="tablist" aria-label="O que ver neste ponto">
        {children}
      </div>
      {edges.right && (
        <button type="button" className="map-popup-tabs-arrow is-right" onClick={() => scroll(1)} aria-label="Ver mais opções">
          <Icon name="chevronRight" size={16} />
        </button>
      )}
    </div>
  );
}

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
  userLayers,
}: {
  map: CityMap;
  pick: MapPick;
  datasets: Record<string, DatasetInfo>;
  nearbySource: NearbySource | null;
  onDetails: () => void;
  onStreetView?: (imageId: string) => void;
  onAdvanced?: (pick: MapPick) => void;
  /** Camadas em tiles ligadas (para "Seus dados aqui" no clique numa região). */
  userLayers?: UserLayer[];
}) {
  // O que há sob o clique, uma aba por camada: o ponto (registro, com a foto da rua), a região da sua camada e a
  // área de uma camada de áreas (IBGE, biblioteca). Mais de uma coisa: botões no topo para escolher o que ver.
  const areaPicks = pick.catalog.filter((c) => c.datapack.geometry === "polygon");
  const recordPick = pick.dataset?.kind === "record" ? pick.dataset : null;
  const aggregatePick = pick.dataset?.kind === "aggregate" ? pick.dataset : null;
  const pickInfo = pick.dataset ? datasets[pick.dataset.datasetId] : undefined;
  const views: { key: PopupView; label: string; icon: IconName }[] = [];
  if (recordPick) {
    const t = pickInfo?.title && recordPick.properties[pickInfo.title] ? String(recordPick.properties[pickInfo.title]) : (pickInfo?.name ?? "Registro");
    views.push({ key: "record", label: t, icon: "pin" });
  }
  if (aggregatePick) views.push({ key: "aggregate", label: aggregatePick.name ?? "Região", icon: "map" });
  // Cada camada de áreas (IBGE, biblioteca) na sua aba.
  for (const c of areaPicks) views.push({ key: `area:${c.datapack.id}`, label: c.datapack.name, icon: "layers" });
  // De longe, a área vale mais que o ponto acertado; de perto, o ponto.
  const preferred: PopupView = areaPicks.length && (!pick.dataset || map.camera.zoom < 12) ? `area:${areaPicks[0]!.datapack.id}` : (views[0]?.key ?? "record");
  const [view, setView] = useState<PopupView>(preferred);
  const areaPick = view.startsWith("area:") ? areaPicks.find((c) => `area:${c.datapack.id}` === view) : undefined;
  const areaMode = Boolean(areaPick);
  const record = view === "record" ? recordPick : null;
  const info = pickInfo;
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
  // Linha de endereço/cidade: o primeiro campo que existir, com o rótulo certo.
  const summaryKey = record ? SUMMARY_KEYS.find((k) => record.properties[k] !== undefined && String(record.properties[k]).trim() !== "") : undefined;
  const summary = record && summaryKey ? record.properties[summaryKey] : undefined;
  const summaryLabel = summaryKey === "cidade" ? "Cidade" : "Endereço";
  const isUserRecord = Boolean(record && userLayers?.find((l) => l.id === record.datasetId)?.user);
  /** "Estabelecimentos (Overture Maps)" → nome e fonte separados. */
  const sourceMatch = info?.name.match(/^(.*?)\s*\((.+)\)$/);
  const layerName = sourceMatch ? sourceMatch[1]! : (info?.name ?? "");
  const sourceName = sourceMatch ? sourceMatch[2]! : null;

  const fields = record
    ? labelled(
        // Sem o título e sem a coluna de cor (já aparecem no cabeçalho do cartão).
        Object.entries(record.properties).filter(
          ([k, v]) => k !== info?.title && k !== info?.colorBy && String(v).trim() !== "",
        ),
        info?.fieldLabels,
      ).slice(0, MAX_FIELDS)
    : [];

  const tabs =
    views.length > 1 ? (
      <ScrollRow>
        {views.map((v) => (
          <button key={v.key} type="button" role="tab" aria-selected={view === v.key} className={view === v.key ? "is-on" : ""} onClick={() => setView(v.key)} title={v.label}>
            <Icon name={v.icon} size={16} />
            <span>{v.label}</span>
          </button>
        ))}
      </ScrollRow>
    ) : null;

  if (areaMode) {
    return (
      <div className="map-popup map-popup-area">
        {tabs}
        <AreaSummary map={map} picks={[areaPick!]} userLayers={userLayers} />
        <div className="map-popup-actions">
          <button type="button" className="btn" onClick={onDetails}>
            Detalhes
          </button>
          {onAdvanced && (
            <button type="button" className="btn" onClick={() => onAdvanced(pick)} title="Visualização avançada (3D) do ponto clicado">
              Visualização avançada
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`map-popup ${tabs ? "has-tabs" : ""}`}>
      {tabs}
      <StreetPhoto lngLat={center} onOpen={onStreetView} variant="hero" />

      <h4 className="popup-title">{titleText}</h4>
      {record && info && (
        <div className="popup-meta">
          {record.category !== null && (
            <span className="popup-category" style={{ ["--cat" as string]: categoryColor(record.category, info.categories) }}>
              <i aria-hidden="true" />
              {info.label ? info.label(info.categories[record.category] ?? "") : info.categories[record.category]}
            </span>
          )}
          <span className={`origin-tag ${isUserRecord ? "origin-user" : "origin-public"}`}>{isUserRecord ? "Seu dado" : "Público"}</span>
          <span className="popup-source">
            {layerName}
            {sourceName && <span className="muted"> · {sourceName}</span>}
          </span>
        </div>
      )}
      {summary !== undefined && (
        <p className="popup-fact">
          <span className="popup-fact-icon" aria-hidden="true">
            <Icon name="pin" size={16} />
          </span>
          <span className="popup-fact-text">
            <span className="popup-fact-label">{summaryLabel}</span>
            {String(summary)}
          </span>
          {sourceName && (
            <InfoTip label={`De onde vem o ${summaryLabel.toLowerCase()}`} placement="top-end">
              Informado pela fonte ({sourceName}), como veio. Pode estar incompleto ou desatualizado.
            </InfoTip>
          )}
        </p>
      )}
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
          <button type="button" className="btn" onClick={() => onAdvanced(pick)} title="Visualização avançada (3D) da área">
            Visualização avançada
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

/** Nome da área, o valor de cada camada de áreas escolhida e quantos registros seus caem nela. */
function AreaSummary({
  map,
  picks,
  userLayers = [],
  compact,
}: {
  map: CityMap;
  picks: MapPick["catalog"];
  userLayers?: UserLayer[];
  compact?: boolean;
}) {
  const first = picks[0]!;
  const p = first.properties;
  const code = String(p.codigo ?? first.featureId ?? "");
  const isState = code.length <= 2;
  const name = p.nome ? `${p.nome}${p.uf && !isState ? ` · ${p.uf}` : ""}` : first.datapack.name;
  const values = picks.flatMap((c) => {
    const r = c.datapack.render;
    const key = r.type === "choropleth" ? r.property : undefined;
    const field = c.datapack.fields.find((f) => f.key === key) ?? c.datapack.fields.find((f) => typeof c.properties[f.key] === "number");
    if (!field) return [];
    const extra = c.datapack.fields.filter((f) => f !== field && typeof c.properties[f.key] === "number").slice(0, compact ? 0 : 2);
    return [field, ...extra].map((f) => ({ key: `${c.datapack.id}:${f.key}`, label: f === field && c.datapack.category === "Biblioteca" ? c.datapack.name : f.label, value: formatField(f, c.properties[f.key]) }));
  });
  const mine = code
    ? userLayers.map(({ id, info, user }) => {
        const row = map.datasetRegionRow(id, code);
        const top = row
          ? info.categories
              .map((c, i) => ({ label: info.label ? info.label(c) : c, n: row[i + 1] ?? 0, color: categoryColor(i, info.categories) }))
              .filter((x) => x.n > 0)
              .sort((a, b) => b.n - a.n)
              .slice(0, 3)
          : [];
        return { id, name: info.name, total: row ? row[0]! : null, top, user };
      })
    : [];
  return (
    <div className={`area-summary ${compact ? "is-compact" : ""}`}>
      {compact ? (
        <p className="area-summary-kicker">Em {name}</p>
      ) : (
        <>
          <span className="area-summary-kicker">{isState ? "Estado" : "Município"}</span>
          <h4>{name}</h4>
        </>
      )}
      {values.length > 0 && (
        <dl className="area-summary-values">
          {values.map((v) => (
            <div key={v.key}>
              <dt>{v.label}</dt>
              <dd className="num">{v.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {mine.length > 0 && (
        <div className="area-summary-mine">
          <span className="area-summary-kicker">Seus dados aqui</span>
          <ul>
            {mine.map((m) => (
              <li key={m.id}>
                <div className="area-summary-row">
                  <span>{m.name}</span>
                  <b className="num">{m.total === null ? "–" : int.format(m.total)}</b>
                </div>
                {m.total === null ? (
                  <span className="muted area-summary-note">
                    {m.user ? "Camada sem contagem por região: importe de novo para ver." : "Contagem por região ainda não disponível nesta versão da fonte."}
                  </span>
                ) : (
                  m.top.length > 0 && (
                    <span className="area-summary-cats">
                      {m.top.map((t) => (
                        <span key={t.label}>
                          <i style={{ background: t.color }} />
                          {t.label} <span className="num">{int.format(t.n)}</span>
                        </span>
                      ))}
                    </span>
                  )
                )}
              </li>
            ))}
          </ul>
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
