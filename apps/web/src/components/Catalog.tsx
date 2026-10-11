import type { DatapackManifest } from "@cityview/engine";
import { useEffect, useState } from "react";
import { fetchStatus, relativeTime, type DatapackStatus } from "../catalog";

interface CatalogProps {
  datapacks: DatapackManifest[];
  active: Set<string>;
  onToggle: (id: string, on: boolean) => void;
}

export function Catalog({ datapacks, active, onToggle }: CatalogProps) {
  const categories = [...new Set(datapacks.map((d) => d.category))];
  return (
    <div className="catalog">
      {categories.map((category) => (
        <div key={category} className="catalog-group">
          <h3>{category}</h3>
          {datapacks
            .filter((d) => d.category === category)
            .map((d) => (
              <CatalogItem key={d.id} datapack={d} on={active.has(d.id)} onToggle={(on) => onToggle(d.id, on)} />
            ))}
        </div>
      ))}
    </div>
  );
}

function CatalogItem({ datapack, on, onToggle }: { datapack: DatapackManifest; on: boolean; onToggle: (on: boolean) => void }) {
  const [status, setStatus] = useState<DatapackStatus | null | undefined>(undefined);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void fetchStatus(datapack.id).then(setStatus);
  }, [datapack.id]);

  const ageHours = status ? (Date.now() - status.updatedAt.getTime()) / 3_600_000 : 0;
  const stale = status && datapack.maxAgeHours !== undefined && ageHours > datapack.maxAgeHours;
  const missing = status === null;

  return (
    <div className="catalog-item">
      <label className="toggle">
        <input type="checkbox" checked={on} disabled={missing} onChange={(e) => onToggle(e.target.checked)} />
        <span>{datapack.name}</span>
      </label>
      <div className="catalog-meta">
        {missing ? (
          <span className="warn">Dados não gerados — rode datapacks/build.py</span>
        ) : status ? (
          <>
            {datapack.source.name.split(" — ")[0]} · {new Intl.NumberFormat("pt-BR").format(status.features)} itens ·{" "}
            <span className={stale ? "warn" : undefined}>
              {stale ? "desatualizado, " : ""}
              atualizado {relativeTime(status.updatedAt)}
            </span>
          </>
        ) : (
          "carregando…"
        )}
        <button type="button" className="link" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "menos" : "detalhes"}
        </button>
      </div>
      {open && (
        <dl className="catalog-details">
          <dt>Descrição</dt>
          <dd>{datapack.description}</dd>
          <dt>Fonte</dt>
          <dd>
            <a href={datapack.source.url} target="_blank" rel="noreferrer">
              {datapack.source.name}
            </a>
          </dd>
          <dt>Licença</dt>
          <dd>
            <a href={datapack.license.url} target="_blank" rel="noreferrer">
              {datapack.license.name}
            </a>
            {datapack.license.commercial ? " · uso comercial permitido" : " · uso não comercial"}
          </dd>
          <dt>Atualização</dt>
          <dd>{datapack.refresh}</dd>
        </dl>
      )}
    </div>
  );
}
