import { categoryColor, matchesWhere, type CityMap, type DatasetFilter, type NearbySummary, type ViewportRecord, type WhereClause } from "@cityview/engine";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { areaAt, regionDirectory, type RegionInfo } from "../areas";
import { ratio, type PlaceFacts } from "../compare";
import { InfoTip } from "./InfoTip";
import { humanize } from "./FieldRows";
import { AgentFace, type AgentKind } from "./Agents";
import { Icon, type IconName } from "./Icon";
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
  /** Ranking: nível, medida e ordem. */
  level?: "uf" | "mun";
  per?: "total" | "pop";
  order?: "desc" | "asc";
  /** Oportunidade: grandeza de comparação ("pop" ou id da camada da biblioteca), recorte e lado. */
  variable?: string;
  scope?: "br" | "uf";
  side?: "missing" | "extra";
  /** Número em destaque: operação. */
  op?: "count" | "sum" | "avg" | "min" | "max";
  /** Nota: texto livre. */
  text?: string;
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

/** Quem da turma aparece no vazio de cada widget (o agente que faria aquele trabalho). */
const EMPTY_AGENT: Partial<Record<IconName, AgentKind>> = { chart: "hexa", ranking: "hexa", sigma: "hexa", idea: "pinny", target: "pinny", table: "bolha", landmark: "quadra" };

/** Estado vazio comum: o agente da tarefa (pensando), título e o que fazer. */
function WidgetEmpty({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <div className="widget-empty">
      <span className="empty-icon">
        <AgentFace kind={EMPTY_AGENT[icon] ?? "bolha"} mood="thinking" size={56} />
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
  /** Valor que o clique filtra (índice da categoria ou texto); sem = não filtra ("Outros", vazio). */
  value?: number | string;
}

/** Muda o filtro do cartão da camada (o mesmo do mapa, da legenda e dos outros widgets). */
export type WidgetFilter = (layerId: string, change: Partial<DatasetFilter>) => void;

/** Liga/desliga um valor numa seleção (vazia = todos). */
function toggle<T>(selected: T[] | null, value: T): T[] | null {
  if (!selected) return [value];
  const next = selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
  return next.length ? next : null;
}

/** Selo do filtro ativo vindo do widget, com o X para limpar. */
function ActiveFilter({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <div className="widget-active-filter">
      <Icon name="filter" size={16} />
      <span>{label}</span>
      <button type="button" className="icon-button sm" onClick={onClear} aria-label="Limpar este filtro" title="Limpar filtro">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

/**
 * Gráfico de uma coluna no que está na tela: categorias e textos viram barras (os mais comuns), números viram
 * histograma com soma, média, mediana e faixa. Clicar numa barra (ou arrastar no histograma) filtra o mapa e os
 * outros widgets: o filtro é o mesmo do cartão da camada.
 */
export function ColumnChartWidget({
  map,
  layers,
  settings,
  onSettings,
  onFilter,
}: {
  map: CityMap;
  layers: WidgetLayer[];
  settings: WidgetSettings;
  onSettings: (s: WidgetSettings) => void;
  onFilter?: WidgetFilter;
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
  const filterKey = JSON.stringify(layer?.filter ?? null);

  const result = useMemo(() => {
    if (!layer || !column) return null;
    if (column === CATEGORY_COLUMN) {
      // Pela contagem do mapa (exata em qualquer zoom, também nos hexágonos e regiões).
      const summary = map.viewportSummary(layer.id);
      if (!summary) return null;
      const bars: Bar[] = layer.info.categories
        .map((_, i) => ({ label: categoryLabel(layer, i), n: summary.byCategory[i] ?? 0, color: categoryColor(i, layer.info.categories), value: i }))
        .filter((b) => b.n > 0)
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
      const key = v === undefined || v === null || String(v).trim() === "" ? "" : String(v).trim();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const top: Bar[] = sorted
      .slice(0, 8)
      .map(([label, n], i) => ({ label: label ? humanize(label) : "(vazio)", n, color: categoryColor(i, sorted.map((x) => x[0])), value: label || undefined }));
    const rest = sorted.slice(8).reduce((sum, [, n]) => sum + n, 0);
    if (rest > 0) top.push({ label: `Outros (${int.format(sorted.length - 8)} valores)`, n: rest, color: "var(--cv-text-muted)" });
    return { kind: "bars" as const, bars: top, total: read.total, thinned: read.thinned };
  }, [map, layer, column, columns, tick, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!layer) return <WidgetEmpty icon="chart" title="Nenhuma camada de pontos">{NO_LAYER}</WidgetEmpty>;

  // O que está filtrado nesta coluna (pelo widget ou pelo cartão da camada).
  const where = layer.filter?.where ?? {};
  const clause = column && column !== CATEGORY_COLUMN ? where[column] : undefined;
  const selected: (number | string)[] | null =
    column === CATEGORY_COLUMN ? (layer.filter?.categories ?? null) : (clause?.in?.map(String) ?? null);
  const setWhere = (next: WhereClause | null) => {
    if (!column || !onFilter) return;
    const { [column]: _, ...rest } = where;
    const merged = next ? { ...rest, [column]: next } : rest;
    onFilter(layer.id, { where: Object.keys(merged).length ? merged : undefined });
  };
  const pickBar = (value: number | string) => {
    if (!onFilter) return;
    if (column === CATEGORY_COLUMN) onFilter(layer.id, { categories: toggle(selected as number[] | null, value as number) ?? undefined });
    else {
      const next = toggle(selected as string[] | null, String(value));
      setWhere(next ? { in: next } : null);
    }
  };
  const selectedLabel =
    selected &&
    (column === CATEGORY_COLUMN
      ? (selected as number[]).map((i) => categoryLabel(layer, i))
      : (selected as string[]).map((v) => humanize(v))
    ).join(", ");
  const range = clause && (clause.gte !== undefined || clause.lte !== undefined) ? clause : null;
  // Com categorias escolhidas, as outras não aparecem no mapa (contam 0): ficam na lista, apagadas, para somar mais uma.
  const bars =
    result?.kind === "bars" && column === CATEGORY_COLUMN && selected
      ? [
          ...result.bars,
          ...layer.info.categories
            .map((_, i) => ({ label: categoryLabel(layer, i), n: 0, color: categoryColor(i, layer.info.categories), value: i }))
            .filter((b) => !result.bars.some((x) => x.value === b.value)),
        ]
      : result?.kind === "bars"
        ? result.bars
        : [];

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
      {selectedLabel && (
        <ActiveFilter
          label={`Só ${selectedLabel}`}
          onClear={() => (column === CATEGORY_COLUMN ? onFilter?.(layer.id, { categories: undefined }) : setWhere(null))}
        />
      )}
      {range && <ActiveFilter label={`Faixa ${stat(range.gte ?? -Infinity)} – ${stat(range.lte ?? Infinity)}`} onClear={() => setWhere(null)} />}
      {!result || result.total === 0 ? (
        <WidgetEmpty icon="chart" title="Nada para mostrar aqui">
          {result && result.thinned > 0 ? "Neste zoom os pontos vêm só com a cor. Aproxime o mapa para ler esta coluna." : "Nada desta camada nesta parte do mapa. Mova ou aproxime o mapa."}
        </WidgetEmpty>
      ) : result.kind === "bars" ? (
        <>
          <p className="widget-caption">
            <b className="num">{int.format(result.total)}</b> na tela
            {onFilter && <span className="muted"> · clique numa barra para filtrar o mapa</span>}
          </p>
          <BarList bars={bars} selected={selected} onPick={onFilter ? pickBar : undefined} />
          <ThinnedNote thinned={result.thinned} />
        </>
      ) : (
        <>
          <NumberSummary nums={result.nums} total={result.total} onRange={onFilter ? (gte, lte) => setWhere({ gte, lte }) : undefined} />
          <ThinnedNote thinned={result.thinned} />
        </>
      )}
    </div>
  );
}

function BarList({ bars, selected, onPick }: { bars: Bar[]; selected?: (number | string)[] | null; onPick?: (value: number | string) => void }) {
  const max = Math.max(1, ...bars.map((b) => b.n));
  const isOn = (b: Bar) => !selected || (b.value !== undefined && selected.map(String).includes(String(b.value)));
  return (
    <ul className={`widget-bars ${onPick ? "is-pickable" : ""}`}>
      {bars.map((b) => {
        const content = (
          <>
            <span className="widget-bar-label">
              <i style={{ background: b.color }} />
              <span title={b.label}>{b.label}</span>
              <span className="num">{isOn(b) || b.n > 0 ? int.format(b.n) : ""}</span>
            </span>
            <span className="widget-bar-track">
              <span style={{ width: `${(b.n / max) * 100}%`, background: b.color }} />
            </span>
          </>
        );
        return (
          <li key={b.label} className={isOn(b) ? "" : "is-off"}>
            {onPick && b.value !== undefined ? (
              <button type="button" className="widget-bar-button" onClick={() => onPick(b.value!)} aria-pressed={Boolean(selected && isOn(b))} title="Filtrar o mapa por este valor">
                {content}
              </button>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ul>
  );
}

const HISTOGRAM_BINS = 12;

/** Resumo de números com histograma; arrastar (ou clicar) nas barras escolhe uma faixa que filtra o mapa. */
function NumberSummary({ nums, total, onRange }: { nums: number[]; total: number; onRange?: (gte: number, lte: number) => void }) {
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  if (nums.length === 0) return <p className="widget-caption">Nenhum valor nesta coluna entre os {int.format(total)} da tela.</p>;
  const sum = nums.reduce((acc, v) => acc + v, 0);
  const min = nums[0]!;
  const max = nums[nums.length - 1]!;
  const mid = Math.floor(nums.length / 2);
  const median = nums.length % 2 ? nums[mid]! : (nums[mid - 1]! + nums[mid]!) / 2;
  const width = (max - min) / HISTOGRAM_BINS || 1;
  const bins = Array.from({ length: HISTOGRAM_BINS }, () => 0);
  for (const v of nums) bins[Math.min(HISTOGRAM_BINS - 1, Math.floor((v - min) / width))]!++;
  const peak = Math.max(...bins);
  const fmt = stat;
  const lo = drag ? Math.min(drag.from, drag.to) : -1;
  const hi = drag ? Math.max(drag.from, drag.to) : -1;
  const commit = () => {
    if (!drag || !onRange) return;
    onRange(min + lo * width, hi === HISTOGRAM_BINS - 1 ? max : min + (hi + 1) * width);
    setDrag(null);
  };
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
      <div
        className={`widget-histogram ${onRange ? "is-pickable" : ""}`}
        role="img"
        aria-label={`Distribuição de ${int.format(nums.length)} valores, de ${fmt(min)} a ${fmt(max)}`}
        onPointerUp={commit}
        onPointerLeave={() => drag && commit()}
      >
        {bins.map((n, i) => (
          <span
            key={i}
            className={drag && i >= lo && i <= hi ? "is-picked" : ""}
            style={{ height: `${Math.max(n > 0 ? 4 : 0, (n / peak) * 100)}%` }}
            title={`${fmt(min + i * width)} – ${fmt(min + (i + 1) * width)}: ${int.format(n)}`}
            onPointerDown={(e) => {
              if (!onRange) return;
              e.preventDefault();
              setDrag({ from: i, to: i });
            }}
            onPointerEnter={() => drag && setDrag({ ...drag, to: i })}
          />
        ))}
      </div>
      <div className="widget-histogram-axis num">
        <span>{fmt(min)}</span>
        <span>{fmt(max)}</span>
      </div>
      <p className="widget-caption">
        <b className="num">{int.format(nums.length)}</b> valores
        {nums.length < total && <span className="muted"> · {int.format(total - nums.length)} sem valor</span>}
        {onRange && <span className="muted"> · arraste nas barras para filtrar uma faixa</span>}
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

  /** Título, categoria e mais uma coluna: cabe numa janela pequena sem rolar para o lado (a planilha toda vai no CSV). */
  const shown = useMemo(() => {
    if (!layer) return [];
    const title = layer.info.title && columns.some((c) => c.name === layer.info.title) ? [layer.info.title] : [];
    const rest = columns.map((c) => c.name).filter((n) => n !== layer.info.title && n !== layer.info.colorBy);
    return [...title, ...(layer.info.categories.length > 1 ? [CATEGORY_COLUMN] : []), ...rest].slice(0, 3);
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
                      <td key={c} className={typeof value(r, c) === "number" ? "num" : undefined} title={cellText(value(r, c))}>
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

// ---------- Ranking de regiões ----------

/** Diretório de estados ou municípios (nome, população, retângulo), carregado uma vez. */
function useDirectory(level: "uf" | "mun"): Map<string, RegionInfo> | null {
  const [dir, setDir] = useState<Map<string, RegionInfo> | null>(null);
  useEffect(() => {
    let live = true;
    setDir(null);
    void regionDirectory(level).then((d) => live && setDir(d));
    return () => {
      live = false;
    };
  }, [level]);
  return dir;
}

/** Contagem da camada numa região respeitando as categorias do filtro: [total, c0, c1…] → número. */
const regionCount = (row: number[] | undefined, allowed: number[] | undefined) =>
  !row ? 0 : allowed ? allowed.reduce((sum, c) => sum + (row[c + 1] ?? 0), 0) : (row[0] ?? 0);

/** Abaixo disso, "por habitante" fica dominado por cidades pequenas com um ou dois registros. */
const MIN_POP_PER_CAPITA = 10_000;

/** Onde a camada mais (ou menos) aparece: estados ou municípios, em total ou por 1.000 habitantes. */
export function RankingWidget({
  map,
  layers,
  settings,
  onSettings,
  onFly,
}: {
  map: CityMap;
  layers: WidgetLayer[];
  settings: WidgetSettings;
  onSettings: (s: WidgetSettings) => void;
  onFly: (bounds: [number, number, number, number]) => void;
}) {
  const layer = useLayer(layers, settings);
  const level = settings.level ?? "mun";
  const per = settings.per ?? "total";
  const order = settings.order ?? "desc";
  const dir = useDirectory(level);
  const regions = layer ? map.datasetRegions(layer.id) : null;

  const rows = useMemo(() => {
    const counts = regions?.[level];
    if (!counts || !dir || !layer) return null;
    const allowed = layer.filter?.categories;
    const list = Object.entries(counts).flatMap(([code, row]) => {
      const info = dir.get(code);
      const n = regionCount(row, allowed);
      if (!info || n === 0) return [];
      if (per === "pop" && (level === "mun" ? info.population < MIN_POP_PER_CAPITA : !info.population)) return [];
      return [{ info, n, value: per === "pop" ? (n / info.population) * 1000 : n }];
    });
    list.sort((a, b) => (order === "desc" ? b.value - a.value : a.value - b.value));
    return { top: list.slice(0, 10), total: list.length };
  }, [regions, level, dir, layer, per, order]);

  if (!layer) return <WidgetEmpty icon="ranking" title="Nenhuma camada de pontos">{NO_LAYER}</WidgetEmpty>;
  const set = (patch: Partial<WidgetSettings>) => onSettings({ ...settings, layer: layer.id, ...patch });
  const max = Math.max(1e-9, ...(rows?.top.map((r) => r.value) ?? [0]));

  return (
    <div className="widget-stack">
      <div className="widget-controls">
        <LayerSelect layers={layers} value={layer.id} onChange={(id) => onSettings({ ...settings, layer: id })} />
      </div>
      <div className="widget-toggles">
        <Segmented value={level} options={[["uf", "Estados"], ["mun", "Municípios"]]} onChange={(v) => set({ level: v })} label="Nível" />
        <Segmented value={per} options={[["total", "Total"], ["pop", "Por 1.000 hab."]]} onChange={(v) => set({ per: v })} label="Medida" />
        <Segmented value={order} options={[["desc", "Mais"], ["asc", "Menos"]]} onChange={(v) => set({ order: v })} label="Ordem" />
      </div>
      {!regions ? (
        <WidgetEmpty icon="ranking" title="Sem contagem por região">
          {layer.user ? "Importe a planilha de novo para contar por estado e município." : "Esta versão da camada não tem contagem por região."}
        </WidgetEmpty>
      ) : !rows ? (
        <p className="muted">Carregando as regiões…</p>
      ) : rows.top.length === 0 ? (
        <WidgetEmpty icon="ranking" title="Nada para listar">Nenhuma região com registros desta camada (com o filtro atual).</WidgetEmpty>
      ) : (
        <>
          <ol className="widget-ranking">
            {rows.top.map((r, i) => (
              <li key={r.info.code}>
                <button type="button" onClick={() => onFly(r.info.bounds)} title={`Ver ${r.info.name} no mapa`}>
                  <span className="widget-rank num">{i + 1}</span>
                  <span className="widget-ranking-main">
                    <span className="widget-ranking-name">
                      {r.info.name}
                      {level === "mun" && <span className="muted"> · {r.info.uf}</span>}
                    </span>
                    <span className="widget-bar-track">
                      <span style={{ width: `${(r.value / max) * 100}%` }} />
                    </span>
                  </span>
                  <span className="widget-ranking-value num">{per === "pop" ? dec.format(r.value) : int.format(r.value)}</span>
                </button>
              </li>
            ))}
          </ol>
          <p className="widget-caption muted">
            {int.format(rows.total)} {level === "mun" ? "municípios" : "estados"} com registros
            {per === "pop" && level === "mun" && ` (com ${int.format(MIN_POP_PER_CAPITA)} hab. ou mais)`}
            {layer.filter?.categories && " · com o filtro da camada"} · arquivo inteiro, não só a tela
          </p>
        </>
      )}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <span className="segmented segmented-sm" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? "is-active" : ""} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </span>
  );
}

// ---------- Oportunidade (seus dados × dado público) ----------

/** Grandeza pública por região para comparar com a camada (população do IBGE ou camada da biblioteca). */
export interface PublicVariable {
  id: string;
  label: string;
  unit: string;
  level: "uf" | "mun";
  values: Record<string, number>;
  /** Como entra na frase ("a população", "o PIB · 2021"). */
  phrase: string;
}

/**
 * Onde há mais (ou menos) registros do que a grandeza pública "pede": o esperado de cada região é a parte dela na
 * grandeza (ex.: população) vezes o total de registros do recorte. Faltam = esperado − real.
 */
export function OpportunityWidget({
  map,
  layers,
  variables,
  settings,
  onSettings,
  onFly,
}: {
  map: CityMap;
  layers: WidgetLayer[];
  variables: PublicVariable[];
  settings: WidgetSettings;
  onSettings: (s: WidgetSettings) => void;
  onFly: (bounds: [number, number, number, number]) => void;
}) {
  const tick = useViewTick(map);
  const layer = useLayer(layers, settings);
  const variable = variables.find((v) => v.id === settings.variable) ?? variables[0]!;
  const level = variable.level;
  const scope = level === "mun" ? (settings.scope ?? "uf") : "br";
  const side = settings.side ?? "missing";
  const dir = useDirectory(level);
  const regions = layer ? map.datasetRegions(layer.id) : null;
  const [uf, setUf] = useState<string | null>(null);

  // Recorte "no estado": o estado no centro do mapa (recalcula ao mover).
  useEffect(() => {
    if (scope !== "uf") return;
    const c = map.native.getCenter();
    let live = true;
    void areaAt([c.lng, c.lat]).then((a) => live && setUf(a.code ? a.code.slice(0, 2) : null));
    return () => {
      live = false;
    };
  }, [map, scope, tick]);

  const result = useMemo(() => {
    const counts = regions?.[level];
    if (!counts || !dir || !layer) return null;
    if (scope === "uf" && !uf) return { rows: [], scopeName: null, total: 0 };
    const allowed = layer.filter?.categories;
    const inScope = [...dir.values()].filter((r) => scope === "br" || r.code.startsWith(uf!));
    const pairs = inScope.flatMap((info) => {
      const v = variable.id === "pop" ? info.population : variable.values[info.code];
      return v !== undefined && v > 0 ? [{ info, v, a: regionCount(counts[info.code], allowed) }] : [];
    });
    const sumA = pairs.reduce((s, x) => s + x.a, 0);
    const sumV = pairs.reduce((s, x) => s + x.v, 0);
    if (sumA === 0 || sumV === 0) return { rows: [], scopeName: scope === "uf" ? uf : null, total: sumA };
    const rows = pairs
      .map((x) => {
        const expected = (x.v / sumV) * sumA;
        return { ...x, expected, gap: side === "missing" ? expected - x.a : x.a - expected };
      })
      .filter((x) => x.gap >= 1)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 10);
    return { rows, scopeName: scope === "uf" ? uf : null, total: sumA };
  }, [regions, level, dir, layer, variable, scope, uf, side]);

  if (!layer) return <WidgetEmpty icon="idea" title="Nenhuma camada de pontos">{NO_LAYER}</WidgetEmpty>;
  const set = (patch: Partial<WidgetSettings>) => onSettings({ ...settings, layer: layer.id, ...patch });
  const ufName = result?.scopeName ? [...(dir?.values() ?? [])].find((r) => r.code.startsWith(result.scopeName!))?.uf : null;

  return (
    <div className="widget-stack">
      <div className="widget-controls">
        <LayerSelect layers={layers} value={layer.id} onChange={(id) => onSettings({ ...settings, layer: id })} />
        <label className="widget-field">
          <span>Comparar com</span>
          <select value={variable.id} onChange={(e) => set({ variable: e.target.value })}>
            {variables.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="widget-toggles">
        <Segmented value={side} options={[["missing", "Faltam registros"], ["extra", "Sobram"]]} onChange={(v) => set({ side: v })} label="Lado" />
        {level === "mun" && <Segmented value={scope} options={[["uf", "No estado"], ["br", "No Brasil"]]} onChange={(v) => set({ scope: v })} label="Recorte" />}
        <InfoTip label="Como é calculado" placement="bottom-end">
          Cada {level === "mun" ? "município" : "estado"} deveria ter registros na proporção {variable.phrase.replace(/^a /, "da ").replace(/^o /, "do ")}: esperado = a parte dele × o total de registros do recorte. A lista mostra onde a diferença para o
          real é maior.
        </InfoTip>
      </div>
      {!regions ? (
        <WidgetEmpty icon="idea" title="Sem contagem por região">
          {layer.user ? "Importe a planilha de novo para contar por estado e município." : "Esta versão da camada não tem contagem por região."}
        </WidgetEmpty>
      ) : !result ? (
        <p className="muted">Carregando as regiões…</p>
      ) : scope === "uf" && !result.scopeName ? (
        <WidgetEmpty icon="idea" title="Centralize num estado">O recorte "No estado" usa o estado no centro do mapa.</WidgetEmpty>
      ) : result.rows.length === 0 ? (
        <WidgetEmpty icon="idea" title="Nada fora da proporção">
          {result.total === 0 ? "Nenhum registro desta camada no recorte." : "Os registros acompanham a proporção nesse recorte."}
        </WidgetEmpty>
      ) : (
        <>
          <p className="widget-caption">
            {side === "missing" ? "Onde há menos registros do que" : "Onde há mais registros do que"} {variable.phrase} indica
            {ufName && <span className="muted"> · {ufName}</span>}
          </p>
          <ol className="widget-ranking">
            {result.rows.map((r) => (
              <li key={r.info.code}>
                <button type="button" onClick={() => onFly(r.info.bounds)} title={`Ver ${r.info.name} no mapa`}>
                  <span className="widget-ranking-main">
                    <span className="widget-ranking-name">
                      {r.info.name}
                      {level === "mun" && scope === "br" && <span className="muted"> · {r.info.uf}</span>}
                    </span>
                    <span className="widget-gap">
                      <span className="num">{int.format(r.a)}</span> <span className="muted">de ~{int.format(Math.round(r.expected))} esperados</span>
                    </span>
                  </span>
                  <span className={`widget-gap-badge num ${side === "missing" ? "is-missing" : "is-extra"}`}>
                    {side === "missing" ? "−" : "+"}
                    {int.format(Math.round(r.gap))}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

// ---------- Número em destaque ----------

const OPS: [NonNullable<WidgetSettings["op"]>, string][] = [
  ["count", "Contagem"],
  ["sum", "Soma"],
  ["avg", "Média"],
  ["min", "Menor"],
  ["max", "Maior"],
];

/** Um número grande do que está na tela: contagem, ou soma/média/menor/maior de uma coluna de número. */
export function KpiWidget({
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
  const numeric = useMemo(() => (layer ? columnsOf(map, layer).filter((c) => c.type === "number") : []), [map, layer, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const op = settings.op && (settings.op === "count" || numeric.length) ? settings.op : "count";
  const column = numeric.find((c) => c.name === settings.column)?.name ?? numeric[0]?.name;
  const filterKey = JSON.stringify(layer?.filter ?? null);

  const value = useMemo(() => {
    if (!layer) return null;
    if (op === "count") {
      const s = map.viewportSummary(layer.id);
      return s ? { n: s.count, of: s.count, thinned: 0 } : null;
    }
    const read = map.viewportRecords(layer.id, 50000);
    if (!read || !column) return null;
    const nums = read.records.map((r) => r.properties[column]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (nums.length === 0) return { n: null, of: read.total, thinned: read.thinned };
    const sum = nums.reduce((a, b) => a + b, 0);
    const n = op === "sum" ? sum : op === "avg" ? sum / nums.length : op === "min" ? Math.min(...nums) : Math.max(...nums);
    return { n, of: nums.length, thinned: read.thinned };
  }, [map, layer, op, column, tick, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!layer) return <WidgetEmpty icon="sigma" title="Nenhuma camada de pontos">{NO_LAYER}</WidgetEmpty>;
  const set = (patch: Partial<WidgetSettings>) => onSettings({ ...settings, layer: layer.id, ...patch });
  const label = op === "count" ? `Registros de ${layer.name}` : `${OPS.find((o) => o[0] === op)![1]} de ${fieldLabel(layer, column ?? "")}`;

  return (
    <div className="widget-stack">
      <div className="widget-controls">
        <LayerSelect layers={layers} value={layer.id} onChange={(id) => onSettings({ ...settings, layer: id, column: undefined })} />
        <label className="widget-field">
          <span>Cálculo</span>
          <select value={op} onChange={(e) => set({ op: e.target.value as WidgetSettings["op"] })}>
            {OPS.filter(([o]) => o === "count" || numeric.length > 0).map(([o, t]) => (
              <option key={o} value={o}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {op !== "count" && (
          <label className="widget-field">
            <span>Coluna</span>
            <select value={column} onChange={(e) => set({ column: e.target.value })}>
              {numeric.map((c) => (
                <option key={c.name} value={c.name}>
                  {fieldLabel(layer, c.name)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="widget-kpi">
        <span className="widget-kpi-label">{label}</span>
        <b className="num" title={value?.n != null ? dec.format(value.n) : undefined}>
          {value?.n == null ? "–" : stat(value.n)}
        </b>
        <span className="muted">
          na tela agora
          {op !== "count" && value && ` · ${int.format(value.of)} valores`}
          {layer.filter && " · com o filtro da camada"}
        </span>
      </div>
      {numeric.length === 0 && <p className="widget-caption muted">Esta camada não tem colunas de número: só a contagem.</p>}
      {value && <ThinnedNote thinned={value.thinned} />}
    </div>
  );
}

// ---------- Nota ----------

/** Texto livre sobre o mapa (explicar um link compartilhado ou um painel embutido). */
export function NoteWidget({ settings, onSettings }: { settings: WidgetSettings; onSettings: (s: WidgetSettings) => void }) {
  return (
    <div className="widget-stack widget-note-wrap">
      <textarea
        className="widget-note-text"
        value={settings.text ?? ""}
        onChange={(e) => onSettings({ ...settings, text: e.target.value })}
        placeholder="Escreva uma nota sobre este mapa: o que ele mostra, de onde vêm os dados, o que observar…"
        aria-label="Texto da nota"
        maxLength={2000}
      />
    </div>
  );
}
