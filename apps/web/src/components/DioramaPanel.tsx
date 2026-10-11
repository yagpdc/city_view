import { categoryColor, type AreaSummary } from "@cityview/engine";
import type { Area } from "../areas";
import type { DatasetInfo } from "./PickDetails";

const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const dec = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export type AreaChoice = "municipio" | 2 | 5 | 10;

interface DioramaPanelProps {
  area: Area;
  areaChoice: AreaChoice;
  dataset: DatasetInfo | undefined;
  summary: AreaSummary | null;
  columns: boolean;
  exaggeration: number;
  orbiting: boolean;
  onAreaChoice: (choice: AreaChoice) => void;
  onColumns: (on: boolean) => void;
  onExaggeration: (value: number) => void;
  onOrbit: (on: boolean) => void;
  onExit: () => void;
}

const CHOICES: { value: AreaChoice; label: string }[] = [
  { value: "municipio", label: "Município" },
  { value: 2, label: "2 km" },
  { value: 5, label: "5 km" },
  { value: 10, label: "10 km" },
];

/** Painel da visualização avançada: números da área e controles da maquete. */
export function DioramaPanel(props: DioramaPanelProps) {
  const { area, dataset, summary } = props;
  const label = (i: number) => {
    const raw = dataset?.categories[i] ?? "";
    return dataset?.label ? dataset.label(raw) : raw;
  };
  const perKm2 = summary ? summary.count / area.areaKm2 : 0;
  const perThousand = summary && area.population ? (summary.count / area.population) * 1000 : null;
  const top = summary
    ? summary.byCategory
        .map((n, i) => ({ n, i }))
        .filter(({ n }) => n > 0)
        .sort((a, b) => b.n - a.n)
        .slice(0, 6)
    : [];
  const topMax = top[0]?.n ?? 1;

  return (
    <section className="diorama-panel" aria-label="Visualização avançada">
      <header>
        <span className="eyebrow">Visualização avançada</span>
        <h2>{area.name}</h2>
        <p className="muted">{dataset?.name ?? "Seus dados"}</p>
      </header>

      <div className="segmented small" role="radiogroup" aria-label="Área">
        {CHOICES.map((c) => (
          <button
            key={String(c.value)}
            type="button"
            role="radio"
            aria-checked={props.areaChoice === c.value}
            className={props.areaChoice === c.value ? "is-active" : ""}
            onClick={() => props.onAreaChoice(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {!summary ? (
        <p className="muted">Calculando os seus dados nesta área…</p>
      ) : (
        <>
          <div className="kpis">
            <div>
              <b>{int.format(summary.count)}</b>
              <span>registros seus aqui</span>
            </div>
            <div>
              <b>{dec.format(perKm2)}</b>
              <span>por km²</span>
            </div>
            {perThousand !== null && (
              <div>
                <b>{dec.format(perThousand)}</b>
                <span>por mil habitantes</span>
              </div>
            )}
            {area.population !== undefined && (
              <div>
                <b>{int.format(area.population)}</b>
                <span>habitantes (IBGE 2022)</span>
              </div>
            )}
          </div>
          {top.length > 0 && (
            <ul className="bars">
              {top.map(({ n, i }) => (
                <li key={i}>
                  <span className="bar-label">
                    <i style={{ background: categoryColor(i, dataset?.categories ?? []) }} />
                    {label(i)}
                  </span>
                  <span className="bar">
                    <span style={{ width: `${(n / topMax) * 100}%`, background: categoryColor(i, dataset?.categories ?? []) }} />
                  </span>
                  <span className="bar-value">{int.format(n)}</span>
                </li>
              ))}
            </ul>
          )}
          {summary.count === 0 && <p className="muted">Nenhum registro seu nesta área.</p>}
        </>
      )}

      <div className="density-legend">
        <span>menos</span>
        <i />
        <span>mais registros por km²</span>
      </div>

      <div className="diorama-controls">
        <label className="toggle">
          <input type="checkbox" checked={props.columns} onChange={(e) => props.onColumns(e.target.checked)} />
          Colunas 3D
        </label>
        <label className="toggle">
          <input type="checkbox" checked={props.orbiting} onChange={(e) => props.onOrbit(e.target.checked)} />
          Girar câmera
        </label>
        <label className="slider">
          Relevo ×{dec.format(props.exaggeration)}
          <input
            type="range"
            min={1}
            max={3.5}
            step={0.1}
            value={props.exaggeration}
            onChange={(e) => props.onExaggeration(Number(e.target.value))}
          />
        </label>
      </div>

      <button type="button" className="btn btn-block" onClick={props.onExit}>
        Sair da visualização
      </button>
    </section>
  );
}
