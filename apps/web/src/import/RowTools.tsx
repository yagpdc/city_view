/**
 * Ferramentas sobre as linhas (docs/IMPORT.md · Passos da receita): filtrar, regras e tags (coluna nova por
 * condições, a primeira regra que bate vence) e coluna calculada. Cada uma vira um passo da receita.
 */
import type { ColumnType, Condition, RecipeStep } from "@cityview/importer";
import { useState } from "react";
import { Icon } from "../components/Icon";

type Tool = "filter" | "rules" | "compute";
type Op = Condition["op"];

const OPS: { op: Op; label: string; needs: "text" | "number" | "none" }[] = [
  { op: "=", label: "é igual a", needs: "text" },
  { op: "!=", label: "é diferente de", needs: "text" },
  { op: "contains", label: "contém", needs: "text" },
  { op: "starts", label: "começa com", needs: "text" },
  { op: ">", label: "maior que", needs: "number" },
  { op: ">=", label: "maior ou igual a", needs: "number" },
  { op: "<", label: "menor que", needs: "number" },
  { op: "<=", label: "menor ou igual a", needs: "number" },
  { op: "empty", label: "está vazio", needs: "none" },
  { op: "filled", label: "está preenchido", needs: "none" },
];

/** Condição em edição (o valor fica como texto até virar passo). */
interface Draft {
  column: string;
  op: Op;
  value: string;
}

/** "1.000,5" e "1.000.000" (Brasil) ou "1000.5" → número. */
function toNumber(raw: string): number {
  const v = raw.trim().replace(/\s/g, "");
  if (v.includes(",")) return Number(v.replace(/\./g, "").replace(",", "."));
  if (/^-?\d{1,3}(\.\d{3})+$/.test(v)) return Number(v.replace(/\./g, ""));
  return Number(v);
}

function toCondition(d: Draft): Condition | null {
  const def = OPS.find((o) => o.op === d.op);
  if (!def || !d.column) return null;
  if (def.needs === "none") return { column: d.column, op: d.op as "empty" | "filled" };
  if (def.needs === "number") {
    const n = toNumber(d.value);
    return Number.isFinite(n) && d.value.trim() ? { column: d.column, op: d.op as ">" | ">=" | "<" | "<=", value: n } : null;
  }
  return { column: d.column, op: d.op as "=" | "!=" | "contains" | "starts", value: d.value.trim() };
}

export function RowTools({
  columns,
  onStep,
}: {
  /** Colunas atuais com o tipo (para sugerir operadores e colunas numéricas). */
  columns: { name: string; type: ColumnType }[];
  onStep: (s: RecipeStep) => void;
}) {
  const [tool, setTool] = useState<Tool | null>(null);
  const done = (s: RecipeStep) => {
    onStep(s);
    setTool(null);
  };
  const chips: [Tool, string, "filter" | "sliders" | "chart"][] = [
    ["filter", "Filtrar linhas", "filter"],
    ["rules", "Regras e tags", "sliders"],
    ["compute", "Coluna calculada", "chart"],
  ];
  return (
    <div className="table-tools">
      <div className="builder-action-chips">
        {chips.map(([id, label, icon]) => (
          <button key={id} type="button" className={`chip-toggle ${tool === id ? "is-on" : ""}`} aria-pressed={tool === id} onClick={() => setTool(tool === id ? null : id)}>
            <Icon name={icon} size={16} />
            {label}
          </button>
        ))}
      </div>
      {tool === "filter" && <FilterForm columns={columns} onApply={done} onCancel={() => setTool(null)} />}
      {tool === "rules" && <RulesForm columns={columns} onApply={done} onCancel={() => setTool(null)} />}
      {tool === "compute" && <ComputeForm columns={columns} onApply={done} onCancel={() => setTool(null)} />}
    </div>
  );
}

function ConditionRow({
  draft,
  columns,
  onChange,
  onRemove,
}: {
  draft: Draft;
  columns: { name: string; type: ColumnType }[];
  onChange: (d: Draft) => void;
  onRemove?: () => void;
}) {
  const def = OPS.find((o) => o.op === draft.op) ?? OPS[0]!;
  return (
    <div className="table-tool-row condition-row">
      <select value={draft.column} onChange={(e) => onChange({ ...draft, column: e.target.value })} aria-label="Coluna">
        {columns.map((c) => (
          <option key={c.name}>{c.name}</option>
        ))}
      </select>
      <select value={draft.op} onChange={(e) => onChange({ ...draft, op: e.target.value as Op })} aria-label="Condição">
        {/* Todos os operadores para qualquer coluna: números escritos como texto ("1.000") também comparam. */}
        {OPS.map((o) => (
          <option key={o.op} value={o.op}>
            {o.label}
          </option>
        ))}
      </select>
      {def.needs !== "none" && (
        <input
          value={draft.value}
          onChange={(e) => onChange({ ...draft, value: e.target.value })}
          inputMode={def.needs === "number" ? "decimal" : "text"}
          placeholder={def.needs === "number" ? "ex.: 1000" : "valor"}
          aria-invalid={def.needs === "number" && draft.value.trim() !== "" && !Number.isFinite(toNumber(draft.value))}
          title={def.needs === "number" ? "Um número, como 1000 ou 1.000,50" : undefined}
          aria-label="Valor"
        />
      )}
      {onRemove && (
        <button type="button" className="icon-button sm" onClick={onRemove} aria-label="Tirar condição">
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}

function Conditions({
  drafts,
  setDrafts,
  columns,
  match,
  setMatch,
}: {
  drafts: Draft[];
  setDrafts: (d: Draft[]) => void;
  columns: { name: string; type: ColumnType }[];
  match: "all" | "any";
  setMatch: (m: "all" | "any") => void;
}) {
  const blank = (): Draft => ({ column: columns[0]?.name ?? "", op: "=", value: "" });
  return (
    <div className="conditions">
      {drafts.map((d, i) => (
        <ConditionRow
          key={i}
          draft={d}
          columns={columns}
          onChange={(nd) => setDrafts(drafts.map((x, k) => (k === i ? nd : x)))}
          onRemove={drafts.length > 1 ? () => setDrafts(drafts.filter((_, k) => k !== i)) : undefined}
        />
      ))}
      <div className="conditions-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDrafts([...drafts, blank()])}>
          <Icon name="plus" size={16} />
          Condição
        </button>
        {drafts.length > 1 && (
          <select value={match} onChange={(e) => setMatch(e.target.value as "all" | "any")} aria-label="Como combinar">
            <option value="all">todas valem (E)</option>
            <option value="any">qualquer uma vale (OU)</option>
          </select>
        )}
      </div>
    </div>
  );
}

const Actions = ({ onCancel, disabled, label, onApply }: { onCancel: () => void; disabled: boolean; label: string; onApply: () => void }) => (
  <div className="table-tool-actions">
    <button type="button" className="btn btn-sm" onClick={onCancel}>
      Cancelar
    </button>
    <button type="button" className="btn btn-primary btn-sm" disabled={disabled} onClick={onApply}>
      {label}
    </button>
  </div>
);

function FilterForm({ columns, onApply, onCancel }: { columns: { name: string; type: ColumnType }[]; onApply: (s: RecipeStep) => void; onCancel: () => void }) {
  const [keep, setKeep] = useState(true);
  const [match, setMatch] = useState<"all" | "any">("all");
  const [drafts, setDrafts] = useState<Draft[]>([{ column: columns[0]?.name ?? "", op: "=", value: "" }]);
  const when = drafts.map(toCondition);
  const valid = when.every(Boolean);
  return (
    <div className="table-tool-card">
      <header>
        <b>Filtrar linhas</b>
        <div className="segmented" role="radiogroup" aria-label="Manter ou remover">
          <button type="button" role="radio" aria-checked={keep} className={keep ? "is-active" : ""} onClick={() => setKeep(true)}>
            Manter só as que
          </button>
          <button type="button" role="radio" aria-checked={!keep} className={!keep ? "is-active" : ""} onClick={() => setKeep(false)}>
            Remover as que
          </button>
        </div>
      </header>
      <Conditions drafts={drafts} setDrafts={setDrafts} columns={columns} match={match} setMatch={setMatch} />
      <p className="muted table-tools-note">As linhas tiradas aparecem na revisão. O arquivo original não muda.</p>
      <Actions onCancel={onCancel} disabled={!valid} label="Filtrar" onApply={() => onApply({ op: "filter", keep, match, when: when as Condition[] })} />
    </div>
  );
}

interface RuleDraft {
  drafts: Draft[];
  match: "all" | "any";
  value: string;
}

function RulesForm({ columns, onApply, onCancel }: { columns: { name: string; type: ColumnType }[]; onApply: (s: RecipeStep) => void; onCancel: () => void }) {
  const blankRule = (): RuleDraft => ({ drafts: [{ column: columns[0]?.name ?? "", op: "=", value: "" }], match: "all", value: "" });
  const [to, setTo] = useState("tag");
  const [rules, setRules] = useState<RuleDraft[]>([blankRule()]);
  const [otherwise, setOtherwise] = useState("");
  const built = rules.map((r) => ({ when: r.drafts.map(toCondition), match: r.match, value: r.value.trim() }));
  const valid = to.trim() !== "" && built.every((r) => r.value && r.when.every(Boolean));
  const exists = columns.some((c) => c.name === to.trim());
  return (
    <div className="table-tool-card">
      <header>
        <b>Regras e tags</b>
        <span className="muted">a primeira regra que bate vence</span>
      </header>
      <label className="table-tool-inline">
        Coluna {exists ? "(substitui a existente)" : "nova"}
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="ex.: perfil" />
      </label>
      {rules.map((r, i) => (
        <div key={i} className="rule-block">
          <span className="rule-label">{i === 0 ? "Se" : "Senão, se"}</span>
          <Conditions
            drafts={r.drafts}
            setDrafts={(d) => setRules(rules.map((x, k) => (k === i ? { ...x, drafts: d } : x)))}
            columns={columns}
            match={r.match}
            setMatch={(m) => setRules(rules.map((x, k) => (k === i ? { ...x, match: m } : x)))}
          />
          <div className="table-tool-row">
            <span className="rule-label">então</span>
            <input value={r.value} onChange={(e) => setRules(rules.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)))} placeholder='ex.: "Indústria grande"' aria-label="Valor da regra" />
            {rules.length > 1 && (
              <button type="button" className="icon-button sm" onClick={() => setRules(rules.filter((_, k) => k !== i))} aria-label="Tirar regra">
                <Icon name="trash" size={16} />
              </button>
            )}
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-ghost btn-sm table-tool-add" onClick={() => setRules([...rules, blankRule()])}>
        <Icon name="plus" size={16} />
        Regra
      </button>
      <div className="table-tool-row">
        <span className="rule-label">Senão</span>
        <input value={otherwise} onChange={(e) => setOtherwise(e.target.value)} placeholder="vazio" aria-label="Valor quando nenhuma regra bate" />
      </div>
      <Actions
        onCancel={onCancel}
        disabled={!valid}
        label="Criar coluna"
        onApply={() =>
          onApply({
            op: "rules",
            to: to.trim(),
            rules: built.map((r) => ({ when: r.when as Condition[], match: r.match, value: r.value })),
            ...(otherwise.trim() ? { otherwise: otherwise.trim() } : {}),
          })
        }
      />
    </div>
  );
}

function ComputeForm({ columns, onApply, onCancel }: { columns: { name: string; type: ColumnType }[]; onApply: (s: RecipeStep) => void; onCancel: () => void }) {
  // Todas as colunas, as de número primeiro: numa amostra pequena um número pode ter sido lido como categoria.
  const numeric = [...columns.filter((c) => c.type === "number"), ...columns.filter((c) => c.type !== "number")];
  const [a, setA] = useState(numeric[0]?.name ?? "");
  const [operator, setOperator] = useState<"+" | "-" | "*" | "/">("/");
  const [bKind, setBKind] = useState<"column" | "number">(numeric.length > 1 ? "column" : "number");
  const [b, setB] = useState(numeric[1]?.name ?? "");
  const [n, setN] = useState("");
  const [to, setTo] = useState("");
  const num = toNumber(n);
  const bValue = bKind === "column" ? b : num;
  const name = to.trim() || `${a}_${{ "+": "mais", "-": "menos", "*": "vezes", "/": "por" }[operator]}_${bKind === "column" ? b : n.trim()}`;
  const valid = Boolean(a) && (bKind === "column" ? Boolean(b) : n.trim() !== "" && Number.isFinite(num));
  return (
    <div className="table-tool-card">
      <header>
        <b>Coluna calculada</b>
        <span className="muted">ex.: faturamento ÷ funcionários</span>
      </header>
      <div className="table-tool-row">
        <select value={a} onChange={(e) => setA(e.target.value)} aria-label="Primeira coluna">
          {numeric.map((c) => (
            <option key={c.name}>{c.name}</option>
          ))}
        </select>
        <select value={operator} onChange={(e) => setOperator(e.target.value as typeof operator)} aria-label="Operação" className="compute-op">
          <option value="+">+</option>
          <option value="-">−</option>
          <option value="*">×</option>
          <option value="/">÷</option>
        </select>
        <select value={bKind} onChange={(e) => setBKind(e.target.value as "column" | "number")} aria-label="Segundo termo">
          <option value="column">coluna</option>
          <option value="number">número</option>
        </select>
        {bKind === "column" ? (
          <select value={b} onChange={(e) => setB(e.target.value)} aria-label="Segunda coluna">
            {numeric.map((c) => (
              <option key={c.name}>{c.name}</option>
            ))}
          </select>
        ) : (
          <input value={n} onChange={(e) => setN(e.target.value)} inputMode="decimal" placeholder="ex.: 1000" aria-label="Número" />
        )}
      </div>
      <label className="table-tool-inline">
        Nome da coluna nova
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder={name} />
      </label>
      <p className="muted table-tools-note">Linhas com valor vazio ou que não é número (ou divisão por zero) ficam vazias na coluna nova.</p>
      <Actions onCancel={onCancel} disabled={!valid} label="Calcular" onApply={() => onApply({ op: "compute", to: name, a, operator, b: bValue })} />
    </div>
  );
}
