import type { StorageUsage } from "../storage/datasets";
import type { UserDataset } from "../storage/useUserDatasets";

const int = new Intl.NumberFormat("pt-BR");
const mb = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(0.1, bytes / 1e6).toFixed(1)} MB`);
const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

interface UserDatasetsProps {
  datasets: UserDataset[];
  active: Set<string>;
  usage: StorageUsage | null;
  onToggle: (id: string, on: boolean) => void;
  onRename: (id: string) => void;
  onRemove: (id: string) => void;
  onFocus: (dataset: UserDataset) => void;
}

export function UserDatasets({ datasets, active, usage, onToggle, onRename, onRemove, onFocus }: UserDatasetsProps) {
  if (datasets.length === 0) return null;
  return (
    <div className="user-datasets">
      {datasets.map((d) => (
        <div key={d.id} className="user-dataset">
          <label className="toggle">
            <input type="checkbox" checked={active.has(d.id)} onChange={(e) => onToggle(d.id, e.target.checked)} />
            <span>{d.manifest.name}</span>
          </label>
          <div className="user-dataset-actions">
            <button type="button" className="link" onClick={() => onFocus(d)} title="Enquadrar no mapa">
              ver
            </button>
            <button type="button" className="link" onClick={() => onRename(d.id)} aria-label={`Renomear ${d.manifest.name}`}>
              renomear
            </button>
            <button type="button" className="link danger" onClick={() => onRemove(d.id)} aria-label={`Remover ${d.manifest.name}`}>
              remover
            </button>
          </div>
          <p className="catalog-meta">
            {int.format(d.count)} pontos · {d.fileName} · {mb(d.data.size)}
            <br />
            {d.saved ? `salvo neste navegador em ${date.format(d.createdAt)}` : "salvando…"}
          </p>
        </div>
      ))}
      {usage && (
        <p className="hint storage-usage">
          {mb(usage.usedBytes)} usados de {mb(usage.quotaBytes)} disponíveis neste navegador
          {usage.persisted ? "" : " · o navegador pode liberar espaço se o disco encher"}
        </p>
      )}
    </div>
  );
}
