import type { DatapackManifest } from "@cityview/engine";
import { useEffect, useState, type ReactNode } from "react";
import { fetchStatus, relativeTime, type DatapackStatus } from "../catalog";
import { Icon } from "./Icon";

/** Linha do painel "Adicionar": o que é, de onde vem e o botão para pôr no mapa. */
export function AddRow({
  title,
  meta,
  added,
  disabled,
  onAdd,
}: {
  title: string;
  meta: ReactNode;
  added: boolean;
  disabled?: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="add-row">
      <span className="add-row-text">
        <b>{title}</b>
        <span>{meta}</span>
      </span>
      {added ? (
        <span className="add-row-added" title="Já está nas camadas">
          <Icon name="layers" size={16} />
          No mapa
        </span>
      ) : (
        <button type="button" className="btn" disabled={disabled} onClick={onAdd}>
          <Icon name="plus" size={16} />
          Adicionar
        </button>
      )}
    </div>
  );
}

/** Origem, quantidade e idade de um datapack do catálogo (lê o .meta.json gerado). */
export function DatapackMeta({ datapack, onStatus }: { datapack: DatapackManifest; onStatus?: (missing: boolean) => void }) {
  const [status, setStatus] = useState<DatapackStatus | null | undefined>(undefined);
  useEffect(() => {
    void fetchStatus(datapack.id).then((s) => {
      setStatus(s);
      onStatus?.(s === null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uma leitura por datapack
  }, [datapack.id]);
  if (status === undefined) return <>carregando…</>;
  if (status === null) return <span className="warn">Dados não gerados (pnpm datapacks)</span>;
  const ageHours = (Date.now() - status.updatedAt.getTime()) / 3_600_000;
  const stale = datapack.maxAgeHours !== undefined && ageHours > datapack.maxAgeHours;
  return (
    <>
      {datapack.source.name.split(" — ")[0]} · {new Intl.NumberFormat("pt-BR").format(status.features)} itens ·{" "}
      <span className={stale ? "warn" : undefined}>
        {stale ? "desatualizado, " : ""}
        {relativeTime(status.updatedAt)}
      </span>
    </>
  );
}
