import type { DatapackField, MapPick } from "@cityview/engine";
import { categoryColor } from "@cityview/engine";
import { useEffect, useState } from "react";
import { StreetPhoto } from "./StreetPhoto";

const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const dec = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

/** O que a tela sabe de cada dataset vetorial (servidor ou demonstração). */
export interface DatasetInfo {
  name: string;
  categories: string[];
  colorBy?: string | null;
  title?: string | null;
  /** Converte o valor bruto da categoria num rótulo legível (ex.: código → nome). */
  label?: (value: string) => string;
  /** URL que devolve todas as colunas da linha (`{rowId}` é substituído). */
  rowUrl?: string;
  /** Rótulos legíveis por coluna, na ordem de exibição; colunas fora da lista vêm depois. */
  fieldLabels?: Record<string, string>;
}

const SOCIAL_NAMES: [RegExp, string][] = [
  [/facebook\.com/i, "Facebook"],
  [/instagram\.com/i, "Instagram"],
  [/(twitter|x)\.com/i, "X/Twitter"],
  [/linkedin\.com/i, "LinkedIn"],
  [/tiktok\.com/i, "TikTok"],
  [/youtube\.com|youtu\.be/i, "YouTube"],
];

function linkLabel(url: string): string {
  const social = SOCIAL_NAMES.find(([re]) => re.test(url));
  if (social) return social[1];
  return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}

/** Valor de uma coluna: links, e-mail e telefone clicáveis; datas ISO em dd/mm/aaaa. */
export function FieldValue({ value }: { value: string | number }) {
  if (typeof value === "number") return <>{formatValue(value)}</>;
  const text = value.trim();
  if (!text) return <>–</>;
  const urls = text.split(/\s+/).filter((t) => /^https?:\/\//i.test(t));
  if (urls.length > 0 && urls.length === text.split(/\s+/).length) {
    return (
      <>
        {urls.map((u, i) => (
          <span key={u}>
            {i > 0 && " · "}
            <a href={u} target="_blank" rel="noreferrer">
              {linkLabel(u)}
            </a>
          </span>
        ))}
      </>
    );
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return <a href={`mailto:${text}`}>{text}</a>;
  // Telefone: só dígitos e pontuação, com 10+ dígitos (CEP e códigos curtos ficam como texto).
  if (/^\+?[\d\s().-]+$/.test(text) && text.replace(/\D/g, "").length >= 10) return <a href={`tel:${text.replace(/[^\d+]/g, "")}`}>{text}</a>;
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (date) return <>{`${date[3]}/${date[2]}/${date[1]}`}</>;
  return <>{text}</>;
}

/** Ordena pelas colunas com rótulo e troca o nome técnico pelo rótulo. */
export function labelled(entries: [string, string | number][], labels: Record<string, string> = {}) {
  const order = Object.keys(labels);
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  return [...entries].sort((a, b) => rank(a[0]) - rank(b[0])).map(([k, v]) => ({ key: k, label: labels[k] ?? k, value: v }));
}

export function formatField(field: DatapackField, value: unknown): string {
  if (value === undefined || value === null) return "–";
  if (field.format === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}/${m}/${y}`;
  }
  const text =
    typeof value === "number" ? (field.format === "int" ? int.format(value) : dec.format(value)) : String(value);
  return field.unit ? `${text} ${field.unit}` : text;
}

// Inteiros pequenos (anos, códigos) sem separador de milhar.
const formatValue = (v: string | number) =>
  typeof v !== "number" ? v : Number.isInteger(v) && Math.abs(v) < 10000 ? String(v) : dec.format(v);

function useRowDetails(url: string | null) {
  const [fields, setFields] = useState<[string, string][] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setFields(null);
    if (!url) return;
    let cancelled = false;
    setLoading(true);
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { fields: [string, string][] } | null) => !cancelled && setFields(body?.fields ?? null))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [url]);
  return { fields, loading };
}

export function PickDetails({
  pick,
  datasets,
  onAdvanced,
  onStreetView,
}: {
  pick: MapPick | null;
  datasets: Record<string, DatasetInfo>;
  onAdvanced?: (pick: MapPick) => void;
  /** Abre o visualizador navegável na foto de rua escolhida. */
  onStreetView?: (imageId: string) => void;
}) {
  const record = pick?.dataset?.kind === "record" ? pick.dataset : null;
  const info = pick?.dataset ? datasets[pick.dataset.datasetId] : undefined;
  const rowUrl = record && info?.rowUrl ? info.rowUrl.replace("{rowId}", String(record.id)) : null;
  const details = useRowDetails(rowUrl);

  if (!pick) return <p className="muted">Clique no mapa para ver o que há naquele ponto.</p>;
  const empty = !pick.dataset && !pick.building && pick.catalog.length === 0;
  const buildingInfo = pick.building ? datasets[pick.building.datasetId] : undefined;
  const buildingLabel = (i: number) => {
    const raw = buildingInfo?.categories[i] ?? "";
    return buildingInfo?.label ? buildingInfo.label(raw) : raw;
  };
  const label = (i: number | null) => {
    if (i === null || !info) return null;
    const raw = info.categories[i] ?? "";
    return info.label ? info.label(raw) : raw;
  };

  return (
    <div className="pick">
      <p className="muted coords">
        {pick.lngLat[1].toFixed(5)}, {pick.lngLat[0].toFixed(5)}
      </p>
      <StreetPhoto lngLat={pick.lngLat} onOpen={onStreetView} />
      {empty && <p className="muted">Nenhuma camada ligada tem dados aqui.</p>}
      {pick.dataset && onAdvanced && (
        <button type="button" className="btn btn-primary btn-block advanced" onClick={() => onAdvanced(pick)}>
          Visualização avançada desta área
        </button>
      )}

      {pick.building && (
        <div className="pick-card building-card">
          <h4>
            Prédio com {int.format(pick.building.count)} {pick.building.count === 1 ? "registro seu" : "registros seus"}
          </h4>
          <p className="muted source">Registros que caem neste prédio (ou a até 25 m dele).</p>
          <ul className="building-records">
            {pick.building.records.map((r) => (
              <li key={r.id}>
                <i style={{ background: categoryColor(r.category, buildingInfo?.categories ?? []) }} />
                <span>
                  <b>#{r.id}</b> {r.category >= 0 ? buildingLabel(r.category) : ""}
                  {Object.entries(r.properties).length > 0 && (
                    <span className="muted">
                      {" · "}
                      {Object.entries(r.properties)
                        .filter(([k]) => k !== buildingInfo?.colorBy)
                        .slice(0, 3)
                        .map(([k, v]) => `${k}: ${formatValue(v)}`)
                        .join(" · ")}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {pick.building.count > pick.building.records.length && (
            <p className="muted source">e mais {int.format(pick.building.count - pick.building.records.length)}…</p>
          )}
        </div>
      )}

      {record && (
        <div className="pick-card">
          <h4>
            {info?.name ?? "Seus dados"}
            {info?.title && details.fields
              ? ` · ${details.fields.find(([k]) => k === info.title)?.[1] ?? ""}`
              : info?.title && record.properties[info.title]
                ? ` · ${record.properties[info.title]}`
                : ` · #${record.id}`}
          </h4>
          {record.category !== null && info && (
            <p className="pick-category">
              <i style={{ background: categoryColor(record.category, info.categories) }} />
              {label(record.category)}
            </p>
          )}
          <dl>
            {labelled(
              (details.fields ?? Object.entries(record.properties)).filter(([k]) => k !== info?.title),
              info?.fieldLabels,
            ).map(({ key, label: name, value }) => (
              <div key={key}>
                <dt>{name}</dt>
                <dd>
                  <FieldValue value={value} />
                </dd>
              </div>
            ))}
          </dl>
          {details.loading && <p className="muted source">Carregando todas as colunas…</p>}
        </div>
      )}

      {pick.dataset?.kind === "aggregate" && (
        <div className="pick-card">
          <h4>
            {info?.name ?? "Seus dados"} · {int.format(pick.dataset.count)} registros
          </h4>
          <p>
            {int.format(pick.dataset.count / pick.dataset.areaKm2)} por km² nesta área de{" "}
            {int.format(pick.dataset.areaKm2)} km²
          </p>
          {info && info.categories.length > 0 && (
            <ul className="pick-breakdown">
              {pick.dataset.byCategory
                .map((n, i) => ({ n, i }))
                .filter(({ n }) => n > 0)
                .sort((a, b) => b.n - a.n)
                .slice(0, 5)
                .map(({ n, i }) => (
                  <li key={i}>
                    <i style={{ background: categoryColor(i, info.categories) }} />
                    {label(i)} <span className="muted">{int.format(n)}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {pick.catalog.map(({ datapack, properties }, i) => (
        <div key={`${datapack.id}-${i}`} className="pick-card">
          <h4>{datapack.name}</h4>
          <dl>
            {datapack.fields.map((f) => (
              <div key={f.key}>
                <dt>{f.label}</dt>
                <dd>{formatField(f, properties[f.key])}</dd>
              </div>
            ))}
          </dl>
          <p className="muted source">Fonte: {datapack.attribution || datapack.source.name}</p>
        </div>
      ))}
    </div>
  );
}
