import { categoryColor, matchesWhere, type CityMap, type DatasetFilter, type NearbySummary, type ViewportRecord } from "@cityview/engine";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ratio, type PlaceFacts } from "../compare";
import { Icon } from "./Icon";
import type { DatasetInfo } from "./PickDetails";

const int = new Intl.NumberFormat("pt-BR");
const dec = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, notation: "compact" });
/** Número de destaque que cabe num cartão estreito: 7.444,5 → "7,4 mil"; 0,53 fica. */
const stat = (v: number) => (Math.abs(v) >= 1000 ? compact.format(v) : dec.format(v));

/** Camada de pontos ligada que os widgets podem ler. */
export interface WidgetLayer {
  id: string;
  name: string;
  info: DatasetInfo;
  filter?: DatasetFilter;
  /** Dado da pessoa (não da biblioteca pública). */
  user: boolean;
}

/** Ajustes de um widget (camada, coluna, raio…), guardados junto com a posição. */
export interface WidgetSettings {
  layer?: string;
  column?: string;
  center?: [number, number];
  radiusM?: number;
  sort?: { column: string; desc: boolean };
}

/** Pseudo-coluna "a categoria de cor da camada" (contagem exata em qualquer zoom). */
const CATEGORY_COLUMN = "__category";
/** Linhas mostradas na tabela (o CSV leva todas as lidas). */
const TABLE_ROWS = 200;

/** Recalcula quando o mapa para de mexer ou termina de carregar (inclusive depois de trocar um filtro). */
function useViewTick(map: CityMap): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void map.whenIdle().then(() => live && setTick((t) => t + 1));
    const off = map.onViewChange(() => setTick((t) => t + 1));
    return () => {
      live = false;
      off();
    };
  }, [map]);
  return tick;
}

const fieldLabel = (layer: WidgetLayer, column: string) => layer.info.fieldLabels?.[column] ?? column;
const categoryLabel = (layer: WidgetLayer, c: number | null) => {
  const raw = c === null ? undefined : layer.info.categories[c];
  if (raw === undefined) return "Sem categoria";
  return layer.info.label ? layer.info.label(raw) : raw;
};
const columnsOf = (map: CityMap, layer: WidgetLayer) => map.datasetColumns(layer.id).filter((c) => !c.name.startsWith("_"));

/** Camada escolhida (ou a primeira, se a escolhida saiu do mapa). */
function useLayer(layers: WidgetLayer[], settings: WidgetSettings): WidgetLayer | undefined {
  return layers.find((l) => l.id === settings.layer) ?? layers[0];
}

function LayerSelect({ layers, value, onChange }: { layers: WidgetLayer[]; value: string; onChange: (id: string) => void }) {
  if (layers.length < 2) return null;
  return (
    <label className="widget-field">
      <span>Camada</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {layers.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Estado vazio comum: ícone, título e o que fazer. */
function WidgetEmpty({ icon, title, children }: { icon: "chart" | "table" | "target" | "landmark"; title: string; children: ReactNode }) {
  return (
    <div className="widget-empty">
      <span className="empty-icon">
        <Icon name={icon} size={24} />
      </span>
      <b>{title}</b>
      <span className="muted">{children}</span>
    </div>
  );
}

const NO_LAYER = "Ligue uma camada de pontos (seus dados ou Estabelecimentos) para usar este widget.";

/** Aviso de que, afastado, parte dos pontos vem sem as colunas. */
function ThinnedNote({ thinned }: { thinned: number }) {
  if (thinned === 0) return null;
  return (
    <p className="widget-note">
      <Icon name="info" size={16} />
      <span>
        Mais {compact.format(thinned)} pontos na tela vêm só com a cor neste zoom. Aproxime o mapa para ler as colunas de todos.
      </span>
    </p>
  );
}

// ---------- Gráfico por coluna ----------

interface Bar {
  label: string;
  n: number;
  color: string;
}

/**
 * Gráfico de uma coluna no que está na tela: categorias e textos viram barras (os mais comuns), números viram
 * histograma com soma, média, mediana e faixa.
 */
export function ColumnChartWidget({
  map,
  layers,
  settings,
  onSettings,
}: {
  map: CityMap;
  layers: WidgetLayer[];
  settings: WidgetSettings;
  onSettings: (s: WidgetSettings) => void;
}) {
  const tick = useViewTick(map);
  const layer = useLayer(layers, settings);
  const columns = useMemo(() => (layer ? columnsOf(map, layer) : []), [map, layer, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasCategories = (layer?.info.categories.length ?? 0) > 1;
  const column = settings.column && (settings.column === CATEGORY_COLUMN ? hasCategories : columns.some((c) => c.name === settings.column))
    ? settings.column
    : hasCategories
      ? CATEGORY_COLUMN
      : columns[0]?.name;

  const result = useMemo(() => {
    if (!layer || !column) return null;
    if (column === CATEGORY_COLUMN) {
      // Pela contagem do mapa (exata em qualquer zoom, também nos hexágonos e regiões).
      const summary = map.viewportSummary(layer.id);
      if (!summary) return null;
      const allowed = layer.filter?.categories;
      const bars: Bar[] = layer.info.categories
        .map((_, i) => ({ label: categoryLabel(layer, i), n: summary.byCategory[i] ?? 0, color: categoryColor(i, layer.info.categories), i }))
        .filter((b) => b.n > 0 && (!allowed || allowed.includes(b.i)))
        .sort((a, b) => b.n - a.n);
      return { kind: "bars" as const, bars, total: summary.count, thinned: 0 };
    }
    const read = map.viewportRecords(layer.id, 20000);
    if (!read) return null;
    const type = columns.find((c) => c.name === column)?.type;
    const values = read.records.map((r) => r.properties[column]);
    if (type === "number") {
      const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
      return { kind: "numbers" as const, nums, total: read.total, thinned: read.thinned };
    }
    const counts = new Map<string, number>();
    for (const v of values) {
      const key = v === undefined || v === null || String(v).trim() === "" ? "(vazio)" : String(v).trim();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 8).map(([label, n], i) => ({ label, n, color: categoryColor(i, sorted.map((s) => s[0])) }));
    const rest = sorted.slice(8).reduce((s, [, n]) => s + n, 0);
    if (rest > 0) top.push({ label: `Outros (${int.format(sorted.length - 8)} valores)`, n: rest, color: "var(--cv-text-muted)" });
    return { kind: "bars" as const, bars: top, total: read.total, thinned: read.thinned };
  }, [map, layer, column, columns, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!layer) return <WidgetEmpty icon="chart" title="Nenhuma camada de pontos">{NO_LAYER}</WidgetEmpty>;

  return (
    <div className="widget-stack">
      <div className="widget-controls">
        <LayerSelect layers={layers} value={layer.id} onChange={(id) => onSettings({ ...settings, layer: id, column: undefined })} />
        <label className="widget-field">
          <span>Coluna</span>
          <select value={column ?? ""} onChange={(e) => onSettings({ ...settings, layer: layer.id, column: e.target.value })}>
            {hasCategories && <option value={CATEGORY_COLUMN}>{layer.info.colorBy ? `${fieldLabel(layer, layer.info.colorBy)} (cor)` : "Categoria (cor)"}</option>}
            {columns
              .filter((c) => c.name !== layer.info.colorBy)
              .map((c) => (
                <option key={c.name} value={c.name}>
                  {fieldLabel(layer, c.name)}
                </option>
              ))}
          </select>
        </label>
      </div>
      {!result || result.total === 0 ? (
        <>
          <WidgetEmpty icon="chart" title="Nada para mostrar aqui">
            {result && result.thinned > 0 ? "Neste zoom os pontos vêm só com a cor. Aproxime o mapa para ler esta coluna." : "Nada desta camada nesta parte do mapa. Mova ou aproxime o mapa."}
          </WidgetEmpty>
        </>
      ) : result.kind === "bars" ? (
        <>
          <p className="widget-caption">
            <b className="num">{int.format(result.total)}</b> na tela
          </p>
          <BarList bars={result.bars} />
          <ThinnedNote thinned={result.thinned} />
        </>
      ) : (
        <>
          <NumberSummary nums={result.nums} total={result.total} />
          <ThinnedNote thinned={result.thinned} />
        </>
      )}
    </div>
  );
}

function BarList({ bars }: { bars: Bar[] }) {
  const max = Math.max(1, ...bars.map((b) => b.n));
  return (
    <ul className="widget-bars">
      {bars.map((b) => (
        <li key={b.label}>
          <span className="widget-bar-label">
            <i style={{ background: b.color }} />
            <span title={b.label}>{b.label}</span>
            <span className="num">{int.format(b.n)}</span>
          </span>
          <span className="widget-bar-track">
            <span style={{ width: `${(b.n / max) * 100}%`, background: b.color }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

const HISTOGRAM_BINS = 12;

function NumberSummary({ nums, total }: { nums: number[]; total: number }) {
  if (nums.length === 0) return <p className="widget-caption">Nenhum valor nesta coluna entre os {int.format(total)} da tela.</p>;
  const sum = nums.reduce((s, v) => s + v, 0);
  const min = nums[0]!;
  const max = nums[nums.length - 1]!;
  const mid = Math.floor(nums.length / 2);
  const median = nums.length % 2 ? nums[mid]! : (nums[mid - 1]! + nums[mid]!) / 2;
  const width = (max - min) / HISTOGRAM_BINS || 1;
  const bins = Array.from({ length: HISTOGRAM_BINS }, () => 0);
  for (const v of nums) bins[Math.min(HISTOGRAM_BINS - 1, Math.floor((v - min) / width))]!++;
  const peak = Math.max(...bins);
  const fmt = stat;
  return (
    <>
      <dl className="widget-stats">
        <div>
          <dt>Soma</dt>
          <dd className="num">{fmt(sum)}</dd>
        </div>
        <div>
          <dt>Média</dt>
          <dd className="num">{fmt(sum / nums.length)}</dd>
        </div>
        <div>
          <dt>Mediana</dt>
          <dd className="num">{fmt(median)}</dd>
        </div>
      </dl>
      <div className="widget-histogram" role="img" aria-label={`Distribuição de ${int.format(nums.length)} valores, de ${fmt(min)} a ${fmt(max)}`}>
        {bins.map((n, i) => (
          <span key={i} style={{ height: `${Math.max(n > 0 ? 4 : 0, (n / peak) * 100)}%` }} title={`${fmt(min + i * width)} – ${fmt(min + (i + 1) * width)}: ${int.format(n)}`} />
        ))}
      </div>
      <div className="widget-histogram-axis num">
        <span>{fmt(min)}</span>
        <span>{fmt(max)}</span>
      </div>
      <p className="widget-caption">
        <b className="num">{int.format(nums.length)}</b> valores
        {nums.length < total && <span className="muted"> · {int.format(total - nums.length)} sem valor</span>}
      </p>
    </>
  );
}

// ---------- Tabela dos visíveis ----------

const cellText = (v: string | number | undefined) => (v === undefined || v === "" ? "–" : typeof v === "number" ? dec.format(v) : String(v));

/** Tabela do que está na tela: ordena pelo cabeçalho, clique leva ao registro, baixa em CSV. */
export function VisibleTableWidget({
  map,
  layers,
  settings,
  onSettings,
  onRecord,
}: {
  map: CityMap;
  layers: WidgetLayer[];
  settings: WidgetSettings;
  onSettings: (s: WidgetSettings) => void;
  onRecord: (layerId: string, record: ViewportRecord) => void;
}) {
  const tick = useViewTick(map);
  const layer = useLayer(layers, settings);
  const read = useMemo(() => (layer ? map.viewportRecords(layer.id, 5000) : null), [map, layer, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const columns = useMemo(() => (layer ? columnsOf(map, layer) : []), [map, layer, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Título, categoria e as primeiras colunas (a planilha toda vai no CSV). */
  const shown = useMemo(() => {
    if (!layer) return [];
    const title = layer.info.title && columns.some((c) => c.name === layer.info.title) ? [layer.info.title] : [];
    const rest = columns.map((c) => c.name).filter((n) => n !== layer.info.title && n !== layer.info.colorBy);
    return [...title, ...(layer.info.categories.length > 1 ? [CATEGORY_COLUMN] : []), ...rest].slice(0, 5);
  }, [layer, columns]);

  const value = (r: ViewportRecord, column: string): string | number | undefined =>
    column === CATEGORY_COLUMN ? categoryLabel(layer!, r.category) : r.properties[column];

  const sort = settings.sort && shown.includes(settings.sort.column) ? settings.sort : null;
  const rows = useMemo(() => {
    if (!read) return [];
    if (!sort) return read.records.slice(0, TABLE_ROWS);
    const dir = sort.desc ? -1 : 1;
    return [...read.records]
      .sort((a, b) => {
        const x = value(a, sort.column);
        const y = value(b, sort.column);
        if (x === undefined || x === "") return 1;
        if (y === undefined || y === "") return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "pt-BR")) * dir;
      })
      .slice(0, TABLE_ROWS);
  }, [read, sort?.column, sort?.desc]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!layer) return <WidgetEmpty icon="table" title="Nenhuma camada de pontos">{NO_LAYER}</WidgetEmpty>;

  const header = (column: string) => (column === CATEGORY_COLUMN ? (layer.info.colorBy ? fieldLabel(layer, layer.info.colorBy) : "Categoria") : fieldLabel(layer, column));

  const download = () => {
    if (!read) return;
    const cols = columns.map((c) => c.name);
    const all = [...(layer.info.categories.length > 1 ? [CATEGORY_COLUMN] : []), ...cols];
    const esc = (v: string | number | undefined) => {
      const s = v === undefined ? "" : String(v);
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      [...all.map(header), "longitude", "latitude"].map(esc).join(";"),
      ...read.records.map((r) => [...all.map((c) => value(r, c)), r.lngLat[0].toFixed(6), r.lngLat[1].toFixed(6)].map(esc).join(";")),
    ];
    // BOM para o Excel abrir os acentos certos; ";" como separador (padrão do Excel em português).
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${layer.name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "registros"} - na tela.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="widget-stack widget-table-wrap">
      <div className="widget-controls">
        <LayerSelect layers={layers} value={layer.id} onChange={(id) => onSettings({ ...settings, layer: id, sort: undefined })} />
      </div>
      {!read || read.total === 0 ? (
        <WidgetEmpty icon="table" title="Nenhum registro para listar">
          {read && read.thinned > 0 ? "Neste zoom os pontos vêm só com a cor. Aproxime o mapa para listar os registros." : "Nada desta camada nesta parte do mapa. Mova ou aproxime o mapa."}
        </WidgetEmpty>
      ) : (
        <>
          <div className="widget-table-bar">
            <span className="widget-caption">
              <b className="num">{int.format(read.total)}</b> na tela
              {read.total > rows.length && <span className="muted"> · mostrando {int.format(rows.length)}</span>}
            </span>
            <button type="button" className="btn btn-sm" onClick={download} title={`Baixar ${int.format(read.records.length)} registros em CSV (todas as colunas)`}>
              <Icon name="download" size={16} />
              CSV
            </button>
          </div>
          <div className="widget-table-scroll">
            <table className="widget-table">
              <thead>
                <tr>
                  {shown.map((c) => {
                    const active = sort?.column === c;
                    return (
                      <th key={c} aria-sort={active ? (sort!.desc ? "descending" : "ascending") : undefined}>
                        <button
                          type="button"
                          onClick={() => onSettings({ ...settings, layer: layer.id, sort: { column: c, desc: active ? !sort!.desc : false } })}
                          title="Ordenar"
                        >
                          <span>{header(c)}</span>
                          {active && <Icon name={sort!.desc ? "arrowDown" : "arrowUp"} size={16} />}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.id}:${i}`} onClick={() => onRecord(layer.id, r)} title="Ver no mapa">
                    {shown.map((c) => (
                      <td key={c} className={typeof value(r, c) === "number" ? "num" : undefined}>
                        {c === CATEGORY_COLUMN ? (
                          <span className="widget-cat">
                            <i style={{ background: categoryColor(r.category ?? -1, layer.info.categories) }} />
                            {cellText(value(r, c))}
                          </span>
                        ) : (
                          cellText(value(r, c))
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ThinnedNote thinned={read.thinned} />
        </>
      )}
    </div>
  );
}

// ---------- Raio ao redor ----------

export const WIDGET_RADII = [250, 500, 1000, 2000];
const meters = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(m / 1000)} km`);

/** Quantos registros de cada camada há num raio em volta de um ponto escolhido no mapa. */
export function RadiusWidget({
  map,
  layers,
  settings,
  onSettings,
  placing,
  onPlacing,
}: {
  map: CityMap;
  layers: WidgetLayer[];
  settings: WidgetSettings;
  onSettings: (s: WidgetSettings) => void;
  placing: boolean;
  onPlacing: (on: boolean) => void;
}) {
  const radiusM = WIDGET_RADII.includes(settings.radiusM ?? 0) ? settings.radiusM! : 500;
  const center = settings.center;
  const [results, setResults] = useState<Record<string, { summary?: NearbySummary; error?: string }>>({});

  // Sem centro ainda: começa no centro do mapa.
  useEffect(() => {
    if (!center) {
      const c = map.native.getCenter();
      onSettings({ ...settings, center: [c.lng, c.lat] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center]);

  useEffect(() => {
    if (!center) return;
    map.setRadius({ center, radiusM }, "cv-radius-widget");
  }, [map, center, radiusM]);
  useEffect(() => () => map.setRadius(null, "cv-radius-widget"), [map]);

  const layerKey = layers.map((l) => l.id).join("|");
  useEffect(() => {
    if (!center) return;
    let cancelled = false;
    setResults({});
    for (const l of layers) {
      map
        .nearby(l.id, center, radiusM)
        .then((summary) => !cancelled && setResults((r) => ({ ...r, [l.id]: { summary } })))
        .catch((e: Error) => !cancelled && setResults((r) => ({ ...r, [l.id]: { error: e.message } })));
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, center?.[0], center?.[1], radiusM, layerKey]);

  const areaKm2 = (Math.PI * radiusM * radiusM) / 1e6;

  return (
    <div className="widget-stack">
      <div className="widget-radius-head">
        <span className="segmented" role="radiogroup" aria-label="Raio">
          {WIDGET_RADII.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={radiusM === r} className={radiusM === r ? "is-active" : ""} onClick={() => onSettings({ ...settings, radiusM: r })}>
              {meters(r)}
            </button>
          ))}
        </span>
        <button type="button" className={`btn btn-sm ${placing ? "btn-primary" : ""}`} onClick={() => onPlacing(!placing)} aria-pressed={placing}>
          <Icon name="target" size={16} />
          {placing ? "Clique no mapa…" : "Mudar centro"}
        </button>
      </div>
      {center && (
        <p className="widget-caption muted">
          {dec.format(areaKm2)} km² em volta de {center[1].toFixed(5)}, {center[0].toFixed(5)}
          {" · "}
          <button type="button" className="link" onClick={() => map.flyTo({ center, zoom: Math.max(map.native.getZoom(), radiusM > 1000 ? 13 : 14.5) })}>
            ver
          </button>
        </p>
      )}
      {layers.length === 0 && <WidgetEmpty icon="target" title="Nenhuma camada de pontos">{NO_LAYER}</WidgetEmpty>}
      {layers.map((l) => {
        const r = results[l.id];
        const allowed = l.filter?.categories;
        const where = l.filter?.where;
        const points = r?.summary?.points.filter((p) => (!allowed || (p.category !== null && allowed.includes(p.category))) && matchesWhere(p.properties, where)) ?? [];
        const bars = l.info.categories
          .map((_, i) => ({ label: categoryLabel(l, i), n: points.filter((p) => p.category === i).length, color: categoryColor(i, l.info.categories) }))
          .filter((b) => b.n > 0)
          .sort((a, b) => b.n - a.n)
          .slice(0, 5);
        return (
          <section key={l.id} className="widget-radius-layer">
            <header>
              <b>{l.name}</b>
              {r?.summary && <span className="num">{int.format(points.length)}</span>}
            </header>
            {!r && <p className="muted">Contando…</p>}
            {r?.error && <p className="muted">{/tiles/i.test(r.error) ? "Raio grande demais para esta camada: escolha um menor." : `Não deu para contar: ${r.error}`}</p>}
            {r?.summary && (
              <>
                <p className="widget-caption muted">
                  {stat(points.length / areaKm2)} por km²{(allowed || where) && " · com o filtro da camada"}
                </p>
                {bars.length > 1 && <BarList bars={bars} />}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---------- Indicadores do lugar ----------

/** Município no centro do mapa: população, área, densidade e quanto das suas camadas cai nele. */
export function PlaceWidget({
  map,
  layers,
  placeFacts,
}: {
  map: CityMap;
  layers: WidgetLayer[];
  placeFacts: (center: [number, number]) => Promise<PlaceFacts>;
}) {
  const tick = useViewTick(map);
  const [facts, setFacts] = useState<PlaceFacts | null>(null);
  const [far, setFar] = useState(false);

  useEffect(() => {
    const zoom = map.native.getZoom();
    setFar(zoom < 6);
    if (zoom < 6) return;
    const c = map.native.getCenter();
    let cancelled = false;
    void placeFacts([c.lng, c.lat]).then((f) => !cancelled && setFacts(f));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, tick]);

  if (far) return <WidgetEmpty icon="landmark" title="Aproxime num município">Os números são do município no centro do mapa (marcado com +).</WidgetEmpty>;
  if (!facts) return <p className="muted">Procurando o município…</p>;
  if (facts.kind !== "municipio") return <WidgetEmpty icon="landmark" title="Fora dos municípios do Brasil">Centralize o mapa num município para ver os números dele.</WidgetEmpty>;

  const pop = facts.population;
  return (
    <div className="widget-stack">
      <header className="widget-place-head">
        <h4>{facts.name}</h4>
        <span className="muted">no centro do mapa · IBGE</span>
      </header>
      <dl className="widget-stats">
        <div>
          <dt>População</dt>
          <dd className="num">{pop ? compact.format(pop) : "–"}</dd>
        </div>
        <div>
          <dt>Área</dt>
          <dd className="num">{stat(facts.areaKm2)} km²</dd>
        </div>
        <div>
          <dt>Hab./km²</dt>
          <dd className="num">{pop ? stat(pop / facts.areaKm2) : "–"}</dd>
        </div>
      </dl>
      {layers.length > 0 && facts.code && (
        <section className="widget-place-layers">
          <h5>Suas camadas aqui</h5>
          <ul>
            {layers.map((l) => {
              const row = map.datasetRegionRow(l.id, facts.code!);
              const allowed = l.filter?.categories;
              const n = row ? (allowed ? allowed.reduce((s, c) => s + (row[c + 1] ?? 0), 0) : (row[0] ?? 0)) : null;
              const per = n !== null && pop ? ratio(n, { id: "pop", label: "População", unit: "Pessoas", value: pop }) : null;
              return (
                <li key={l.id}>
                  <span className="widget-place-layer-name">{l.name}</span>
                  {n === null ? (
                    <span className="muted">{l.user ? "importe de novo para contar por município" : "sem contagem por município"}</span>
                  ) : (
                    <span>
                      <b className="num">{int.format(n)}</b>
                      {per && <span className="muted"> · {dec.format(per.value)} {per.per}</span>}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {facts.comparisons.length > 0 && (
        <section className="widget-place-layers">
          <h5>Da biblioteca</h5>
          <ul>
            {facts.comparisons.map((c) => (
              <li key={c.id}>
                <span className="widget-place-layer-name">{c.label}</span>
                <span>
                  <b className="num">{compact.format(c.value)}</b>
                  <span className="muted"> {c.unit}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
