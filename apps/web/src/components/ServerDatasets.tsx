import type { ServerDataset } from "../server/api";
import type { PendingUpload } from "../server/useServerDatasets";

const int = new Intl.NumberFormat("pt-BR");
const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(0.1, b / 1e6).toFixed(1)} MB`);
const STAGES: Record<string, string> = {
  reading: "lendo o arquivo",
  indexing: "agregando por região",
  tiling: "gerando o mapa",
  writing: "finalizando",
};

interface ServerDatasetsProps {
  datasets: ServerDataset[];
  uploads: PendingUpload[];
  active: Set<string>;
  onToggle: (id: string, on: boolean) => void;
  onRename: (id: string) => void;
  onRemove: (id: string) => void;
  onFocus: (d: ServerDataset) => void;
}

export function ServerDatasets({ datasets, uploads, active, onToggle, onRename, onRemove, onFocus }: ServerDatasetsProps) {
  if (datasets.length === 0 && uploads.length === 0) return null;
  return (
    <div className="user-datasets">
      {uploads.map((u) => (
        <div key={u.key} className="user-dataset">
          <span className="toggle">
            <span className="spinner" aria-hidden="true" />
            <span>{u.name}</span>
          </span>
          <p className="catalog-meta">enviando ao servidor… {Math.round(u.fraction * 100)}%</p>
          <div className="progress mini">
            <div style={{ width: `${Math.round(u.fraction * 100)}%` }} />
          </div>
        </div>
      ))}
      {datasets.map((d) => {
        const ready = d.status === "ready";
        const working = d.status === "queued" || d.status === "processing";
        return (
          <div key={d.id} className="user-dataset">
            <label className="toggle">
              {working ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <input
                  type="checkbox"
                  checked={active.has(d.id)}
                  disabled={!ready}
                  onChange={(e) => onToggle(d.id, e.target.checked)}
                />
              )}
              <span>{d.name}</span>
            </label>
            <div className="user-dataset-actions">
              {ready && (
                <button type="button" className="link" onClick={() => onFocus(d)}>
                  ver
                </button>
              )}
              <button type="button" className="link" onClick={() => onRename(d.id)}>
                renomear
              </button>
              {!working && (
                <button type="button" className="link danger" onClick={() => onRemove(d.id)}>
                  remover
                </button>
              )}
            </div>
            <p className="catalog-meta">
              {ready && d.report
                ? `${int.format(d.report.records)} pontos · ${d.fileName} · mapa de ${mb(d.report.tilesBytes)} · no servidor local`
                : working
                  ? d.status === "queued"
                    ? "na fila do servidor…"
                    : `${STAGES[d.stage ?? "reading"] ?? "processando"}… ${Math.round(d.progress * 100)}%`
                  : null}
              {ready && d.report && d.report.stats.invalid > 0 && (
                <>
                  <br />
                  {int.format(d.report.stats.invalid)} linhas ignoradas (sem coordenada ou inválidas)
                </>
              )}
            </p>
            {d.status === "error" && <p className="warn user-error">{d.error}</p>}
            {working && (
              <div className="progress mini">
                <div style={{ width: `${Math.round(d.progress * 100)}%` }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
