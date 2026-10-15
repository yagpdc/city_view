/**
 * Builder de dados (passo "Dados" da importação): colunas à esquerda; perfil, problemas e ações da coluna
 * escolhida à direita; a receita (passos aplicados, removíveis) e a prévia já transformada embaixo.
 * Nada altera o arquivo original — cada ação vira um passo da receita (docs/IMPORT.md).
 */
import { describeStep, type ColumnProfile, type ColumnType, type RecipeStep } from "@pinny/importer";
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import type { OpenedFile } from "./protocol";

export interface ColumnChoice {
  name: string;
  include: boolean;
  type: ColumnType;
  /** Tipo escolhido à mão (a detecção não muda mais). */
  locked?: boolean;
}

const TYPE_LABELS: Record<ColumnType, string> = { number: "Número", category: "Categoria", date: "Data", text: "Texto" };
const int = new Intl.NumberFormat("pt-BR");
const dec = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

export function BuilderStep({
  opened,
  choices,
  onChoices,
  recipe,
  onRecipe,
  locationColumns,
  profile,
  title,
  onTitle,
  colorBy,
  onColorBy,
  tools,
}: {
  opened: OpenedFile;
  choices: ColumnChoice[];
  onChoices: (c: ColumnChoice[]) => void;
  recipe: RecipeStep[];
  onRecipe: (r: RecipeStep[]) => void;
  /** Colunas usadas na localização (ficam fora da lista de dados). */
  locationColumns: string[];
  profile: (column: string) => Promise<ColumnProfile>;
  title: string;
  onTitle: (v: string) => void;
  colorBy: string;
  onColorBy: (v: string) => void;
  /** Ferramentas da planilha inteira (juntar, acrescentar). */
  tools?: ReactNode;
}) {
  const data = choices.filter((c) => !locationColumns.includes(c.name));
  const [selected, setSelected] = useState<string>(data[0]?.name ?? "");
  const [prof, setProf] = useState<ColumnProfile | null>(null);
  const add = (step: RecipeStep) => onRecipe([...recipe, step]);

  useEffect(() => {
    if (!data.some((c) => c.name === selected)) setSelected(data[0]?.name ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choices]);
  useEffect(() => {
    let cancelled = false;
    setProf(null);
    if (selected) void profile(selected).then((p) => !cancelled && setProf(p)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selected, recipe, profile]);

  const choice = data.find((c) => c.name === selected);
  const setChoice = (patch: Partial<ColumnChoice>) => onChoices(choices.map((c) => (c.name === selected ? { ...c, ...patch } : c)));
  const textLike = choices.filter((c) => c.include && (c.type === "text" || c.type === "category"));
  const categoryCols = choices.filter((c) => c.include && c.type === "category" && !locationColumns.includes(c.name));

  return (
    <div className="builder">
      {tools && <div className="builder-tools">{tools}</div>}
      <aside className="builder-columns" aria-label="Colunas">
        <span className="builder-caption">Colunas · {data.filter((c) => c.include).length} de {data.length} no mapa</span>
        <ul>
          {data.map((c) => (
            <li key={c.name} className={`${c.name === selected ? "is-selected" : ""} ${c.include ? "" : "is-off"}`}>
              <input
                type="checkbox"
                checked={c.include}
                aria-label={`Levar "${c.name}" para o mapa`}
                onChange={(e) => onChoices(choices.map((x) => (x.name === c.name ? { ...x, include: e.target.checked } : x)))}
              />
              <button type="button" onClick={() => setSelected(c.name)}>
                <span className="builder-col-name">{c.name}</span>
                <span className="builder-type">{TYPE_LABELS[c.type]}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="builder-panel" aria-label={`Coluna ${selected}`}>
        {choice ? (
          <>
            <header className="builder-panel-head">
              <h3>{choice.name}</h3>
              <select value={choice.type} onChange={(e) => setChoice({ type: e.target.value as ColumnType, locked: true })} aria-label="Tipo da coluna">
                {Object.entries(TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </header>
            {prof ? <ProfileView profile={prof} onFix={add} /> : <p className="muted">Analisando a coluna…</p>}
            <ColumnActions column={choice.name} type={choice.type} profile={prof} onStep={add} />
          </>
        ) : (
          <p className="muted">Escolha uma coluna à esquerda.</p>
        )}
      </section>

      <footer className="builder-bottom">
        <div className="wizard-row">
          <label>
            Título do ponto
            <select value={title} onChange={(e) => onTitle(e.target.value)}>
              <option value="">Nenhum</option>
              {textLike.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </select>
          </label>
          <label>
            Colorir por
            <select value={colorBy} onChange={(e) => onColorBy(e.target.value)}>
              <option value="">Uma cor só</option>
              {categoryCols.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="builder-recipe">
          <span className="builder-caption">
            Ajustes aplicados ({recipe.length}){recipe.length > 0 && <span className="muted"> · o arquivo original não muda</span>}
          </span>
          {recipe.length === 0 ? (
            <p className="muted">Nenhum ainda. Corrija problemas ou use as ações da coluna — cada ajuste aparece aqui e pode ser desfeito.</p>
          ) : (
            <ol>
              {recipe.map((s, i) => (
                <li key={i}>
                  <span>{describeStep(s)}</span>
                  <button type="button" className="icon-button sm" aria-label={`Desfazer: ${describeStep(s)}`} onClick={() => onRecipe(recipe.filter((_, k) => k !== i))}>
                    <Icon name="close" size={16} />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
        <PreviewMini opened={opened} highlight={selected} />
      </footer>
    </div>
  );
}

function ProfileView({ profile: p, onFix }: { profile: ColumnProfile; onFix: (s: RecipeStep) => void }) {
  const maxBin = p.numeric ? Math.max(1, ...p.numeric.bins.map((b) => b.count)) : 1;
  const maxTop = Math.max(1, ...p.top.map(([, n]) => n));
  return (
    <div className="builder-profile">
      <p className="builder-stats muted">
        <span className="num">{int.format(p.total)}</span> linhas na amostra · <span className="num">{int.format(p.empty)}</span> vazias ·{" "}
        <span className="num">{int.format(p.distinct)}</span> valores diferentes
        {p.numeric && (
          <>
            {" "}
            · de <span className="num">{dec.format(p.numeric.min)}</span> a <span className="num">{dec.format(p.numeric.max)}</span> (média{" "}
            <span className="num">{dec.format(p.numeric.mean)}</span>)
          </>
        )}
      </p>
      {p.numeric ? (
        <div className="builder-hist" aria-label="Distribuição">
          {p.numeric.bins.map((b, i) => (
            <span key={i} title={`${dec.format(b.from)} – ${dec.format(b.to)}: ${int.format(b.count)}`} style={{ height: `${(b.count / maxBin) * 100}%` }} />
          ))}
        </div>
      ) : (
        <ul className="builder-top">
          {p.top.slice(0, 6).map(([v, n]) => (
            <li key={v}>
              <span className="builder-top-label" title={v}>
                {v}
              </span>
              <span className="builder-top-bar">
                <span style={{ width: `${(n / maxTop) * 100}%` }} />
              </span>
              <span className="num muted">{int.format(n)}</span>
            </li>
          ))}
        </ul>
      )}
      {p.problems.length > 0 && (
        <ul className="builder-problems">
          {p.problems.map((x) => (
            <li key={x.id}>
              <Icon name="info" size={16} />
              <span>{x.message}</span>
              {x.fix && (
                <button type="button" className="btn btn-sm" onClick={() => onFix(x.fix!.step)}>
                  {x.fix.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Action = "" | "rename" | "round" | "bucket" | "case" | "fill" | "split" | "replace" | "drop";

function ColumnActions({ column, type, profile, onStep }: { column: string; type: ColumnType; profile: ColumnProfile | null; onStep: (s: RecipeStep) => void }) {
  const [action, setAction] = useState<Action>("");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [map, setMap] = useState<Record<string, string>>({});
  useEffect(() => {
    setAction("");
    setA("");
    setB("");
    setMap({});
  }, [column]);
  const done = (s: RecipeStep) => {
    onStep(s);
    setAction("");
    setA("");
    setB("");
    setMap({});
  };
  const numberActions: [Action, string][] = [
    ["round", "Arredondar"],
    ["bucket", "Criar faixas"],
  ];
  const textActions: [Action, string][] = [
    ["case", "Maiúsculas/minúsculas"],
    ["replace", "Trocar valores"],
    ["split", "Dividir"],
  ];
  const all: [Action, string][] = [["rename", "Renomear"], ...(type === "number" ? numberActions : textActions), ["fill", "Preencher vazios"]];
  const num = (s: string) => Number(s.replace(",", "."));

  return (
    <div className="builder-actions">
      <div className="builder-action-chips">
        {all.map(([id, label]) => (
          <button key={id} type="button" className={`chip-toggle ${action === id ? "is-on" : ""}`} aria-pressed={action === id} onClick={() => setAction(action === id ? "" : id)}>
            {label}
          </button>
        ))}
        {type !== "number" && (
          <button type="button" className="chip-toggle" onClick={() => done({ op: "accents", column })}>
            Tirar acentos
          </button>
        )}
      </div>

      {action === "rename" && (
        <form className="builder-form" onSubmit={(e) => (e.preventDefault(), a.trim() && done({ op: "rename", column, to: a.trim() }))}>
          <input autoFocus value={a} onChange={(e) => setA(e.target.value)} placeholder="Novo nome" />
          <button className="btn btn-primary btn-sm">Aplicar</button>
        </form>
      )}
      {action === "round" && (
        <form
          className="builder-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (b) done({ op: "round", column, multiple: num(b) });
            else done({ op: "round", column, decimals: Number(a || 0) });
          }}
        >
          <label>
            Casas decimais
            <input inputMode="numeric" value={a} onChange={(e) => setA(e.target.value)} placeholder="0" />
          </label>
          <label>
            ou múltiplos de
            <input inputMode="decimal" value={b} onChange={(e) => setB(e.target.value)} placeholder="ex.: 10" />
          </label>
          <button className="btn btn-primary btn-sm">Aplicar</button>
        </form>
      )}
      {action === "bucket" && (
        <form
          className="builder-form"
          onSubmit={(e) => {
            e.preventDefault();
            let edges = a
              .split(/[;\s]+/)
              .map((x) => num(x))
              .filter((x) => Number.isFinite(x))
              .sort((x, y) => x - y);
            if (edges.length === 0 && profile?.numeric) {
              // Sem limites digitados: 5 faixas iguais entre o mínimo e o máximo.
              const { min, max } = profile.numeric;
              edges = [1, 2, 3, 4].map((i) => Number((min + ((max - min) * i) / 5).toPrecision(3)));
            }
            if (edges.length) done({ op: "bucket", column, edges, to: b.trim() || `${column}_faixa` });
          }}
        >
          <label>
            Limites (separe com espaço)
            <input autoFocus value={a} onChange={(e) => setA(e.target.value)} placeholder="ex.: 10 20 50 — vazio = 5 faixas iguais" />
          </label>
          <label>
            Nova coluna
            <input value={b} onChange={(e) => setB(e.target.value)} placeholder={`${column}_faixa`} />
          </label>
          <button className="btn btn-primary btn-sm">Criar</button>
        </form>
      )}
      {action === "case" && (
        <div className="builder-form">
          <button type="button" className="btn btn-sm" onClick={() => done({ op: "case", column, to: "upper" })}>
            MAIÚSCULAS
          </button>
          <button type="button" className="btn btn-sm" onClick={() => done({ op: "case", column, to: "lower" })}>
            minúsculas
          </button>
          <button type="button" className="btn btn-sm" onClick={() => done({ op: "case", column, to: "title" })}>
            Primeira Maiúscula
          </button>
          <button type="button" className="btn btn-sm" onClick={() => done({ op: "trim", column })}>
            Tirar espaços
          </button>
        </div>
      )}
      {action === "fill" && (
        <form className="builder-form" onSubmit={(e) => (e.preventDefault(), done({ op: "fillEmpty", column, value: a }))}>
          <input autoFocus value={a} onChange={(e) => setA(e.target.value)} placeholder={type === "number" ? "ex.: 0" : "ex.: Sem informação"} />
          <button className="btn btn-primary btn-sm">Aplicar</button>
        </form>
      )}
      {action === "split" && (
        <form
          className="builder-form"
          onSubmit={(e) => {
            e.preventDefault();
            const into = b
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean);
            if (a && into.length >= 2) done({ op: "split", column, separator: a, into });
          }}
        >
          <label>
            Separador
            <input autoFocus value={a} onChange={(e) => setA(e.target.value)} placeholder="ex.: /" />
          </label>
          <label>
            Novas colunas (separe com vírgula)
            <input value={b} onChange={(e) => setB(e.target.value)} placeholder="ex.: cidade, uf" />
          </label>
          <button className="btn btn-primary btn-sm">Dividir</button>
        </form>
      )}
      {action === "replace" && profile && (
        <form
          className="builder-form builder-replace"
          onSubmit={(e) => {
            e.preventDefault();
            const clean = Object.fromEntries(Object.entries(map).filter(([k, v]) => v.trim() !== "" && v !== k));
            if (Object.keys(clean).length) done({ op: "replace", column, map: clean });
          }}
        >
          <span className="muted">Escreva o novo valor ao lado dos que quer trocar (ex.: "x" e "y" → "z").</span>
          {profile.top.map(([v, n]) => (
            <label key={v} className="builder-replace-row">
              <span title={v}>
                {v} <span className="muted num">({int.format(n)})</span>
              </span>
              <input value={map[v] ?? ""} onChange={(e) => setMap({ ...map, [v]: e.target.value })} placeholder="manter" />
            </label>
          ))}
          <button className="btn btn-primary btn-sm">Trocar</button>
        </form>
      )}
    </div>
  );
}

function PreviewMini({ opened, highlight }: { opened: OpenedFile; highlight: string }) {
  const rows = opened.preview.slice(0, 6);
  return (
    <div className="preview builder-preview">
      <table>
        <thead>
          <tr>
            {opened.headers.map((h) => (
              <th key={h} className={h === highlight ? "is-highlight" : ""}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {opened.headers.map((h) => (
                <td key={h} className={h === highlight ? "is-highlight" : ""}>
                  {r[h]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
