import type { MaqueteData, MaqueteSelection } from "@pinny/engine";
import { useState } from "react";
import { Icon } from "./Icon";
import { FieldValue, labelled, type DatasetInfo } from "./PickDetails";

const int = new Intl.NumberFormat("pt-BR");
const MAX_LIST = 40;

type Point = MaqueteData["points"][number];

/** Cartão de detalhes da maquete: um prédio (com os registros dele) ou um registro. */
export function MaqueteDetails({
  data,
  selection,
  datasets,
  onClose,
}: {
  data: MaqueteData;
  selection: NonNullable<MaqueteSelection>;
  datasets: Record<string, DatasetInfo>;
  onClose: () => void;
}) {
  const [record, setRecord] = useState<number | null>(null);
  const categoryLabel = (p: Point) => {
    const info = datasets[p.datasetId];
    if (p.category === null || !info) return "Outros";
    const raw = info.categories[p.category] ?? "Outros";
    return info.label ? info.label(raw) : raw;
  };
  const pointTitle = (p: Point) => p.title ?? `${datasets[p.datasetId]?.name ?? "Registro"}`;

  // Um registro aberto (de dentro do prédio ou alfinete na rua).
  const pointIndex = selection.kind === "point" ? selection.index : record;
  if (pointIndex !== null) {
    const p = data.points[pointIndex];
    if (!p) return null;
    const info = datasets[p.datasetId];
    const fields = labelled(
      Object.entries(p.properties).filter(([k, v]) => k !== info?.title && k !== info?.colorBy && String(v).trim() !== ""),
      info?.fieldLabels,
    ).slice(0, 14);
    return (
      <section className="maquete-details" aria-label="Detalhes do registro">
        <header>
          <span className="maquete-details-title">
            {selection.kind === "building" && (
              <button type="button" className="link-button" onClick={() => setRecord(null)}>
                ← Voltar ao prédio
              </button>
            )}
            <b>{pointTitle(p)}</b>
            <span className="maquete-details-category">
              <i style={{ background: p.color }} />
              {categoryLabel(p)}
              {info && <span className="muted"> · {info.name}</span>}
            </span>
          </span>
          <button type="button" className="icon-button sm" onClick={onClose} aria-label="Fechar detalhes">
            <Icon name="close" size={16} />
          </button>
        </header>
        <dl>
          {fields.map(({ key, label, value }) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>
                <FieldValue value={value} />
              </dd>
            </div>
          ))}
          {fields.length === 0 && <p className="muted">Sem outros campos.</p>}
        </dl>
      </section>
    );
  }

  const b = data.buildings[selection.index];
  if (!b) return null;
  const records = b.records.map((i) => ({ i, p: data.points[i]! }));
  // Contagem por categoria (cor + rótulo), da maior para a menor.
  const groups = new Map<string, { color: string; label: string; n: number }>();
  for (const { p } of records) {
    const label = categoryLabel(p);
    const key = `${p.color}|${label}`;
    const g = groups.get(key) ?? { color: p.color, label, n: 0 };
    g.n++;
    groups.set(key, g);
  }
  const bars = [...groups.values()].sort((a, c) => c.n - a.n);
  const max = bars[0]?.n ?? 1;
  return (
    <section className="maquete-details" aria-label="Detalhes do prédio">
      <header>
        <span className="maquete-details-title">
          <b>Prédio</b>
          <span className="muted num">
            {Math.round(b.height)} m de altura{b.base > 0 ? ` · a partir de ${Math.round(b.base)} m` : ""}
          </span>
        </span>
        <button type="button" className="icon-button sm" onClick={onClose} aria-label="Fechar detalhes">
          <Icon name="close" size={16} />
        </button>
      </header>
      {records.length === 0 ? (
        <p className="muted">Nenhum dos seus registros cai neste prédio.</p>
      ) : (
        <>
          <p className="maquete-details-count">
            <span className="num">{int.format(records.length)}</span> {records.length === 1 ? "registro" : "registros"} aqui
          </p>
          <ul className="widget-bars">
            {bars.slice(0, 5).map((g) => (
              <li key={`${g.color}${g.label}`}>
                <span className="widget-bar-label">
                  <i style={{ background: g.color }} />
                  <span>{g.label}</span>
                  <span className="num">{int.format(g.n)}</span>
                </span>
                <span className="widget-bar-track">
                  <span style={{ width: `${(g.n / max) * 100}%`, background: g.color }} />
                </span>
              </li>
            ))}
          </ul>
          <ol className="maquete-details-list">
            {records.slice(0, MAX_LIST).map(({ i, p }) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => setRecord(i)}
                >
                  <i style={{ background: p.color }} />
                  <span>{pointTitle(p)}</span>
                  <span className="muted">{categoryLabel(p)}</span>
                </button>
              </li>
            ))}
          </ol>
          {records.length > MAX_LIST && <p className="muted">+ {int.format(records.length - MAX_LIST)} registros</p>}
        </>
      )}
    </section>
  );
}
