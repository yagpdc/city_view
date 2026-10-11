import type { DatapackField, MapPick } from "@cityview/engine";
import { categoryColor } from "@cityview/engine";
import { useEffect, useState } from "react";

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
}

function formatField(field: DatapackField, value: unknown): string {
  if (value === undefined || value === null) return "–";
  if (field.format === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}/${m}/${y}`;
  }
  const text =
    typeof value === "number" ? (field.format === "int" ? int.format(value) : dec.format(value)) : String(value);
  return field.unit ? `${text} ${field.unit}` : text;
}

const formatValue = (v: string | number) => (typeof v === "number" ? dec.format(v) : v);

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
}: {
  pick: MapPick | null;
  datasets: Record<string, DatasetInfo>;
  onAdvanced?: (pick: MapPick) => void;
}) {
  const record = pick?.dataset?.kind === "record" ? pick.dataset : null;
  const info = pick?.dataset ? datasets[pick.dataset.datasetId] : undefined;
  const rowUrl = record && info?.rowUrl ? info.rowUrl.replace("{rowId}", String(record.id)) : null;
  const details = useRowDetails(rowUrl);

  if (!pick) return <p className="muted">Clique no mapa para ver o que há naquele ponto.</p>;
  const empty = !pick.dataset && pick.catalog.length === 0;
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
      {empty && <p className="muted">Nenhuma camada ligada tem dados aqui.</p>}
      {pick.dataset && onAdvanced && (
        <button type="button" className="btn btn-primary btn-block advanced" onClick={() => onAdvanced(pick)}>
          Visualização avançada desta área
        </button>
      )}

      {record && (
        <div className="pick-card">
          <h4>
            {info?.name ?? "Seus dados"}
            {info?.title && details.fields
              ? ` · ${details.fields.find(([k]) => k === info.title)?.[1] ?? ""}`
              : ` · #${record.id}`}
          </h4>
          {record.category !== null && info && (
            <p className="pick-category">
              <i style={{ background: categoryColor(record.category, info.categories) }} />
              {label(record.category)}
            </p>
          )}
          <dl>
            {details.fields
              ? details.fields
                  .filter(([k]) => k !== info?.title)
                  .map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v || "–"}</dd>
                    </div>
                  ))
              : Object.entries(record.properties).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{formatValue(v)}</dd>
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
