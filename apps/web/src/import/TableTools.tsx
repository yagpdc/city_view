/**
 * Juntar com outra planilha e acrescentar linhas (docs/IMPORT.md · Juntar com outra planilha).
 * A outra planilha é lida no worker, só na memória deste navegador; cada operação vira um passo da receita.
 */
import type { JoinStats, RecipeStep } from "@pinny/importer";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { ACCEPTED_EXTENSIONS, type SourceInfo } from "./protocol";

const int = new Intl.NumberFormat("pt-BR");
const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });

type Mode = "join" | "append";

export function TableTools({
  headers,
  originalHeaders,
  recipe,
  onRecipe,
  addSource,
  joinStats,
  only,
  lead,
}: {
  /** Colunas atuais (depois da receita). */
  headers: string[];
  /** Colunas como vieram do arquivo (as linhas acrescentadas entram antes dos ajustes). */
  originalHeaders: string[];
  recipe: RecipeStep[];
  onRecipe: (r: RecipeStep[]) => void;
  addSource: (file: File) => Promise<SourceInfo>;
  joinStats: (source: string, key: string, otherKey: string) => Promise<JoinStats>;
  /** Mostra só uma das ferramentas (ex.: "join" quando faltam as coordenadas). */
  only?: Mode;
  /** Texto antes dos botões. */
  lead?: string;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [source, setSource] = useState<SourceInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const pick = (m: Mode) => {
    setMode(m);
    setError(null);
    input.current?.click();
  };
  const onFile = async (file: File) => {
    setLoading(true);
    setSource(null);
    try {
      setSource(await addSource(file));
    } catch (e) {
      setError((e as Error).message);
      setMode(null);
    } finally {
      setLoading(false);
    }
  };
  const close = () => {
    setMode(null);
    setSource(null);
  };

  return (
    <div className="table-tools">
      {lead && <p className="table-tools-lead">{lead}</p>}
      <div className="builder-action-chips">
        {only !== "append" && (
          <button type="button" className={`chip-toggle ${mode === "join" ? "is-on" : ""}`} onClick={() => pick("join")} disabled={loading}>
            <Icon name="addCircle" size={16} />
            Juntar com outra planilha
          </button>
        )}
        {only !== "join" && (
          <button type="button" className={`chip-toggle ${mode === "append" ? "is-on" : ""}`} onClick={() => pick("append")} disabled={loading}>
            <Icon name="plus" size={16} />
            Acrescentar linhas de outra planilha
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void onFile(f);
            else if (!source) setMode(null);
          }}
        />
      </div>
      {loading && <p className="muted table-tools-note">Lendo a outra planilha… (fica só neste navegador)</p>}
      {error && <p className="wizard-error">{error}</p>}
      {source && mode === "join" && (
        <JoinForm
          source={source}
          headers={headers}
          joinStats={joinStats}
          onCancel={close}
          onApply={(step) => {
            onRecipe([...recipe, step]);
            close();
          }}
        />
      )}
      {source && mode === "append" && (
        <AppendForm
          source={source}
          headers={originalHeaders}
          onCancel={close}
          onApply={(step) => {
            // Entra no começo (depois de outros "acrescentar"): os ajustes já feitos valem também para as linhas novas.
            const at = recipe.findIndex((s) => s.op !== "append");
            const next = [...recipe];
            next.splice(at === -1 ? next.length : at, 0, step);
            onRecipe(next);
            close();
          }}
        />
      )}
    </div>
  );
}

function JoinForm({
  source,
  headers,
  joinStats,
  onCancel,
  onApply,
}: {
  source: SourceInfo;
  headers: string[];
  joinStats: (source: string, key: string, otherKey: string) => Promise<JoinStats>;
  onCancel: () => void;
  onApply: (step: RecipeStep) => void;
}) {
  const [key, setKey] = useState(source.join?.key ?? headers[0] ?? "");
  const [otherKey, setOtherKey] = useState(source.join?.otherKey ?? source.headers[0] ?? "");
  const [stats, setStats] = useState<JoinStats | null>(null);
  const [cols, setCols] = useState<string[]>(() => source.headers.filter((h) => h !== (source.join?.otherKey ?? source.headers[0])));
  const [multiple, setMultiple] = useState<"first" | "sum">("first");
  const [count, setCount] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    if (key && otherKey) void joinStats(source.id, key, otherKey).then((s) => !cancelled && setStats(s)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [source.id, key, otherKey, joinStats]);

  const short = source.name.replace(/\.[^.]+$/, "");
  /** Nome que a coluna trazida recebe (sem atropelar uma coluna que já existe). */
  const target = (c: string) => {
    if (!headers.includes(c)) return c;
    let name = `${c}_${short}`.replace(/\s+/g, "_");
    for (let i = 2; headers.includes(name); i++) name = `${c}_${i}`;
    return name;
  };
  const withKey = stats ? stats.total - stats.emptyKey : 0;
  const ratio = stats && withKey > 0 ? stats.matched / withKey : 0;

  return (
    <div className="table-tool-card">
      <header>
        <b>Juntar com {source.name}</b>
        <span className="muted">{int.format(source.rowCount)} linhas</span>
      </header>
      <div className="table-tool-row">
        <label>
          Coluna desta planilha
          <select value={key} onChange={(e) => setKey(e.target.value)}>
            {headers.map((h) => (
              <option key={h}>{h}</option>
            ))}
          </select>
        </label>
        <span className="table-tool-eq" aria-hidden="true">
          =
        </span>
        <label>
          Coluna de {short}
          <select
            value={otherKey}
            onChange={(e) => {
              setOtherKey(e.target.value);
              setCols((c) => c.filter((x) => x !== e.target.value));
            }}
          >
            {source.headers.map((h) => (
              <option key={h}>{h}</option>
            ))}
          </select>
        </label>
      </div>
      {source.join && source.join.key === key && source.join.otherKey === otherKey && (
        <p className="muted table-tools-note">Sugerimos estas colunas porque os valores delas batem.</p>
      )}
      {stats ? (
        <p className={ratio >= 0.5 ? "wizard-ok" : "wizard-warn"}>
          <b>{int.format(stats.matched)}</b> de {int.format(withKey)} linhas acharam par ({pct.format(ratio)})
          {stats.total >= 50_000 && " nas primeiras 50 mil"}
          {stats.multiple > 0 && <> · {int.format(stats.multiple)} com mais de um par</>}
          {stats.emptyKey > 0 && <> · {int.format(stats.emptyKey)} sem valor em "{key}"</>}.
          {stats.missingExamples.length > 0 && (
            <>
              {" "}
              Sem par, por exemplo: {stats.missingExamples.slice(0, 3).map((v) => `"${v}"`).join(", ")}. As linhas sem par continuam, com as colunas novas vazias.
            </>
          )}
        </p>
      ) : (
        <p className="muted table-tools-note">Conferindo quantas linhas casam…</p>
      )}
      <fieldset className="table-tool-cols">
        <legend>Colunas para trazer</legend>
        {source.headers
          .filter((h) => h !== otherKey)
          .map((h) => (
            <label key={h} className="toggle">
              <input type="checkbox" checked={cols.includes(h)} onChange={(e) => setCols((c) => (e.target.checked ? [...c, h] : c.filter((x) => x !== h)))} />
              {h}
              {target(h) !== h && <span className="muted"> → {target(h)}</span>}
            </label>
          ))}
      </fieldset>
      {stats && stats.multiple > 0 && (
        <label className="table-tool-inline">
          Quando houver mais de um par
          <select value={multiple} onChange={(e) => setMultiple(e.target.value as "first" | "sum")}>
            <option value="first">usar a primeira linha</option>
            <option value="sum">somar os números (texto: a primeira)</option>
          </select>
        </label>
      )}
      <label className="toggle">
        <input type="checkbox" checked={count} onChange={(e) => setCount(e.target.checked)} />
        Criar coluna com quantos pares cada linha achou
      </label>
      <div className="table-tool-actions">
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!key || !otherKey || (cols.length === 0 && !count)}
          onClick={() =>
            onApply({
              op: "join",
              source: source.id,
              label: source.name,
              key,
              otherKey,
              columns: source.headers.filter((h) => cols.includes(h)).map((h) => ({ from: h, to: target(h) })),
              ...(multiple === "sum" ? { multiple } : {}),
              ...(count ? { countAs: target(`qtd_${short}`.replace(/\s+/g, "_")) } : {}),
            })
          }
        >
          Juntar
        </button>
      </div>
    </div>
  );
}

const SKIP = "";

function AppendForm({
  source,
  headers,
  onCancel,
  onApply,
}: {
  source: SourceInfo;
  headers: string[];
  onCancel: () => void;
  onApply: (step: RecipeStep) => void;
}) {
  const [map, setMap] = useState<Record<string, string>>(source.appendMap);
  const used = new Set(Object.values(map).filter(Boolean));
  const emptyHere = headers.filter((h) => !used.has(h));
  const fresh = Object.entries(map).filter(([, to]) => to && !headers.includes(to));
  return (
    <div className="table-tool-card">
      <header>
        <b>Acrescentar {int.format(source.rowCount)} linhas de {source.name}</b>
        <span className="muted">entram no fim, com os mesmos ajustes</span>
      </header>
      <p className="muted table-tools-note">Confira em qual coluna desta planilha cai cada coluna da outra:</p>
      <div className="table-tool-map">
        {source.headers.map((h) => (
          <label key={h}>
            <span title={h}>{h}</span>
            <select value={map[h] ?? SKIP} onChange={(e) => setMap({ ...map, [h]: e.target.value })}>
              {headers.map((c) => (
                <option key={c} value={c}>
                  → {c}
                </option>
              ))}
              {!headers.includes(h) && <option value={h}>+ coluna nova "{h}"</option>}
              <option value={SKIP}>não trazer</option>
            </select>
          </label>
        ))}
      </div>
      {emptyHere.length > 0 && (
        <p className="wizard-warn">
          Nas linhas novas ficam vazias: {emptyHere.slice(0, 6).map((h) => `"${h}"`).join(", ")}
          {emptyHere.length > 6 ? ` e mais ${emptyHere.length - 6}` : ""}.
        </p>
      )}
      {fresh.length > 0 && (
        <p className="muted table-tools-note">
          {fresh.length === 1 ? "1 coluna nova: nas linhas desta planilha ela fica vazia." : `${fresh.length} colunas novas: nas linhas desta planilha elas ficam vazias.`}
        </p>
      )}
      <div className="table-tool-actions">
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => onApply({ op: "append", source: source.id, label: source.name, map })}>
          Acrescentar
        </button>
      </div>
    </div>
  );
}
