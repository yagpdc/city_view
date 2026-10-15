import type { Where, WhereClause } from "@pinny/engine";
import { useState, type FormEvent } from "react";
import { Icon } from "./Icon";

export interface FilterColumn {
  key: string;
  label: string;
  type: "number" | "text";
}

const num = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

/** Texto curto de uma condição, para o chip. */
function describe(column: FilterColumn, clause: WhereClause): string {
  const parts: string[] = [];
  if (clause.gte !== undefined && clause.lte !== undefined) parts.push(`${num.format(clause.gte)} – ${num.format(clause.lte)}`);
  else if (clause.gte !== undefined) parts.push(`≥ ${num.format(clause.gte)}`);
  else if (clause.lte !== undefined) parts.push(`≤ ${num.format(clause.lte)}`);
  if (clause.contains) parts.push(`contém “${clause.contains}”`);
  return `${column.label} ${parts.join(" · ")}`;
}

/** Campo numérico: vírgula decimal (pt-BR, com ponto de milhar) ou ponto decimal; vazio = sem limite. */
const parseNumber = (text: string): number | undefined => {
  const raw = text.trim().replace(/\s/g, "");
  const t = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Filtro por valor dentro do cartão de camada: uma condição por coluna (faixa numérica ou
 * "contém"), mostradas como chips. `range` dá a dica de mínimo/máximo do que está carregado.
 */
export function ValueFilter({
  columns,
  where,
  onChange,
  range,
  note,
}: {
  columns: FilterColumn[];
  where: Where | null;
  onChange: (where: Where | null) => void;
  range?: (column: string) => { min: number; max: number } | null;
  /** Aviso sobre onde o filtro vale (ex.: só nos pontos, não nos hexágonos). */
  note?: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  if (columns.length === 0) return null;
  const entries = Object.entries(where ?? {}).flatMap(([key, clause]) => {
    const column = columns.find((c) => c.key === key);
    return column ? [{ column, clause }] : [];
  });
  const remove = (key: string) => {
    const { [key]: _, ...rest } = where ?? {};
    onChange(Object.keys(rest).length ? rest : null);
  };
  const save = (key: string, clause: WhereClause | null) => {
    setEditing(null);
    if (!clause) return remove(key);
    onChange({ ...(where ?? {}), [key]: clause });
  };

  return (
    <div className="value-filter">
      {entries.length > 0 && (
        <ul className="value-filter-chips">
          {entries.map(({ column, clause }) => (
            <li key={column.key} className="value-chip">
              <button type="button" className="value-chip-label" onClick={() => setEditing(column.key)} title="Editar condição">
                <Icon name="filter" size={16} />
                <span>{describe(column, clause)}</span>
              </button>
              <button type="button" className="value-chip-remove" onClick={() => remove(column.key)} aria-label={`Tirar filtro de ${column.label}`}>
                <Icon name="close" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing !== null ? (
        <ClauseEditor
          columns={columns}
          initial={editing || entries.find((e) => !where?.[e.column.key])?.column.key || columns.find((c) => !where?.[c.key])?.key || columns[0]!.key}
          where={where}
          range={range}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button type="button" className="link-button value-filter-add" onClick={() => setEditing("")}>
          <Icon name="plus" size={16} />
          Filtrar por valor
        </button>
      )}
      {entries.length > 0 && note && <p className="value-filter-note muted">{note}</p>}
    </div>
  );
}

function ClauseEditor({
  columns,
  initial,
  where,
  range,
  onSave,
  onCancel,
}: {
  columns: FilterColumn[];
  initial: string;
  where: Where | null;
  range?: (column: string) => { min: number; max: number } | null;
  onSave: (key: string, clause: WhereClause | null) => void;
  onCancel: () => void;
}) {
  const [key, setKey] = useState(initial);
  const current = where?.[key];
  const [min, setMin] = useState(current?.gte !== undefined ? String(current.gte) : "");
  const [max, setMax] = useState(current?.lte !== undefined ? String(current.lte) : "");
  const [text, setText] = useState(current?.contains ?? "");
  const column = columns.find((c) => c.key === key) ?? columns[0]!;
  const hint = column.type === "number" ? range?.(column.key) : null;

  const pick = (next: string) => {
    setKey(next);
    const c = where?.[next];
    setMin(c?.gte !== undefined ? String(c.gte) : "");
    setMax(c?.lte !== undefined ? String(c.lte) : "");
    setText(c?.contains ?? "");
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (column.type === "number") {
      let gte = parseNumber(min);
      let lte = parseNumber(max);
      if (gte !== undefined && lte !== undefined && gte > lte) [gte, lte] = [lte, gte];
      onSave(column.key, gte === undefined && lte === undefined ? null : { ...(gte !== undefined && { gte }), ...(lte !== undefined && { lte }) });
    } else {
      onSave(column.key, text.trim() ? { contains: text.trim() } : null);
    }
  };

  return (
    <form className="clause-editor" onSubmit={submit}>
      <label className="clause-field">
        <span>Coluna</span>
        <select value={column.key} onChange={(e) => pick(e.target.value)}>
          {columns.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      {column.type === "number" ? (
        <div className="clause-range">
          <label className="clause-field">
            <span>De</span>
            <input inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder={hint ? num.format(hint.min) : "mín."} autoFocus />
          </label>
          <label className="clause-field">
            <span>Até</span>
            <input inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} placeholder={hint ? num.format(hint.max) : "máx."} />
          </label>
        </div>
      ) : (
        <label className="clause-field">
          <span>Contém</span>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="ex.: farmácia" autoFocus />
        </label>
      )}
      {hint && (
        <p className="clause-hint muted">
          Nos dados carregados: <span className="num">{num.format(hint.min)}</span> a <span className="num">{num.format(hint.max)}</span>
        </p>
      )}
      <div className="clause-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary">
          Aplicar
        </button>
      </div>
    </form>
  );
}
