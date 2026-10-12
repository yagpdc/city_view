import { useEffect, useMemo, useRef, useState } from "react";
import { ADAPTERS } from "./adapters";
import { LIBRARY_SOURCES, loadAllSources } from "./load";
import { buildMapLayer, type LibraryLayer } from "./mapLayer";
import { FLAG, MAP_LEVELS, decodeItem, type ItemChoice, type ItemOptions, type LibraryItem, type LibrarySourceIndex, type MapData } from "./types";
import { Icon } from "../components/Icon";

const MAX_RESULTS = 200;
const int = new Intl.NumberFormat("pt-BR");
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** As fontes usam termos técnicos; a busca aceita os do dia a dia. */
const SYNONYMS: Record<string, string[]> = {
  renda: ["rendimento", "renda"],
  salario: ["rendimento", "salario"],
  casa: ["domicilio"],
  casas: ["domicilio"],
  moradia: ["domicilio"],
  moradores: ["populacao", "residente"],
  habitantes: ["populacao"],
  pessoas: ["populacao", "pessoas"],
  emprego: ["ocupacao", "ocupad", "emprego"],
  trabalho: ["trabalho", "ocupacao"],
  empresas: ["empresa", "unidades locais", "cnae"],
  lavoura: ["lavoura", "agricola"],
  gado: ["bovino", "rebanho"],
  escola: ["educacao", "escola", "ensino"],
  saude: ["saude", "estabelecimentos de saude"],
  pib: ["produto interno bruto", "pib"],
  inflacao: ["ipca", "inpc", "precos"],
  violencia: ["homicidio", "violencia", "obitos por agressao"],
};

interface Entry {
  item: LibraryItem;
  text: string;
  title: string;
}

type ActionState = { busy?: "download" | "map"; ok?: string; error?: string; choose?: MapData; chooseChoice?: ItemChoice };

/** Painel "Opções" de um item: opções carregadas da fonte e escolhas do usuário. */
type OptionsState = { open: boolean; loading?: boolean; error?: string; options?: ItemOptions; choice: ItemChoice };

/** Listas longas (ex.: 562 meses do IPCA) mostram só os mais recentes. */
const MAX_PERIOD_OPTIONS = 240;
/** Classificações como CNAE têm milhares de categorias; acima disso, use o site do SIDRA. */
const MAX_CATEGORY_OPTIONS = 600;

const years = (it: LibraryItem) =>
  !it.yearFrom && !it.yearTo ? "" : it.yearFrom && it.yearTo && it.yearFrom !== it.yearTo ? `${it.yearFrom}–${it.yearTo}` : `${it.yearTo ?? it.yearFrom}`;

export function LibraryPanel({ onClose, onAddLayer }: { onClose: () => void; onAddLayer: (layer: LibraryLayer) => void }) {
  const [indexes, setIndexes] = useState<LibrarySourceIndex[] | null>(null);
  const [query, setQuery] = useState("");
  const [sourceId, setSourceId] = useState<string>("all");
  const [group, setGroup] = useState("");
  const [municipalOnly, setMunicipalOnly] = useState(false);
  const [actions, setActions] = useState<Record<string, ActionState>>({});
  const [itemOptions, setItemOptions] = useState<Record<string, OptionsState>>({});
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadAllSources().then(setIndexes);
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Índice de busca: título, grupo, assunto, id e anos, sem acentos.
  const entries = useMemo<Entry[]>(() => {
    if (!indexes) return [];
    return indexes.flatMap((index) =>
      index.items.map((raw) => {
        const item = decodeItem(index, raw);
        const span =
          item.yearFrom && item.yearTo ? Array.from({ length: Math.min(item.yearTo - item.yearFrom + 1, 80) }, (_, i) => item.yearFrom! + i).join(" ") : (item.yearTo ?? "");
        return {
          item,
          title: normalize(item.title),
          text: normalize(`${item.title} ${item.group} ${item.subject} ${item.id} ${item.source.name} ${span}`),
        };
      }),
    );
  }, [indexes]);

  const groups = useMemo(() => {
    const index = indexes?.find((i) => i.source.id === sourceId);
    return index ? index.groups.map((g) => g.name) : [];
  }, [indexes, sourceId]);

  const results = useMemo(() => {
    const terms = normalize(query)
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => [t, ...(SYNONYMS[t] ?? [])]);
    const matches: { e: Entry; score: number }[] = [];
    for (const e of entries) {
      const it = e.item;
      if (sourceId !== "all" && it.source.id !== sourceId) continue;
      if (group && it.group !== group) continue;
      if (municipalOnly && !(it.flags & FLAG.MUNICIPAL)) continue;
      if (terms.length && !terms.every((alts) => alts.some((a) => e.text.includes(a)))) continue;
      // Relevância: termos no título > recente > tem municípios.
      const inTitle = terms.filter((alts) => alts.some((a) => e.title.includes(a))).length;
      const recent = (it.yearTo ?? it.yearFrom ?? 1900) - 1900;
      matches.push({ e, score: inTitle * 1000 + recent + (it.flags & FLAG.MUNICIPAL ? 50 : 0) });
    }
    if (terms.length) matches.sort((a, b) => b.score - a.score);
    return { total: matches.length, items: matches.slice(0, MAX_RESULTS).map((m) => m.e.item) };
  }, [entries, query, sourceId, group, municipalOnly]);

  const key = (it: LibraryItem) => `${it.source.id}:${it.id}`;
  const setAction = (it: LibraryItem, state: ActionState) => setActions((a) => ({ ...a, [key(it)]: state }));

  const toggleOptions = async (it: LibraryItem) => {
    const k = key(it);
    const current = itemOptions[k];
    if (current?.open) return setItemOptions((o) => ({ ...o, [k]: { ...current, open: false } }));
    setItemOptions((o) => ({ ...o, [k]: { open: true, loading: !current?.options, choice: current?.choice ?? {}, options: current?.options } }));
    if (current?.options) return;
    const adapter = ADAPTERS[it.source.adapter];
    try {
      const options = await adapter!.options!(it);
      setItemOptions((o) => ({ ...o, [k]: { ...o[k]!, loading: false, options } }));
    } catch (e) {
      setItemOptions((o) => ({ ...o, [k]: { ...o[k]!, loading: false, error: (e as Error).message } }));
    }
  };

  const setChoice = (it: LibraryItem, patch: ItemChoice) =>
    setItemOptions((o) => {
      const cur = o[key(it)]!;
      return { ...o, [key(it)]: { ...cur, choice: { ...cur.choice, ...patch } } };
    });

  const download = async (it: LibraryItem, choice?: ItemChoice) => {
    const adapter = ADAPTERS[it.source.adapter];
    if (!adapter) return;
    setAction(it, { busy: "download" });
    try {
      const r = await adapter.download(it, choice);
      setAction(it, { ok: `Baixado: ${int.format(r.rows)} linhas · ${r.detail}` });
    } catch (e) {
      setAction(it, { error: `Não deu para baixar direto: ${(e as Error).message}` });
    }
  };

  const showOnMap = async (it: LibraryItem, data?: MapData, variableId?: string, choice?: ItemChoice) => {
    const adapter = ADAPTERS[it.source.adapter];
    if (!adapter?.mapData) return;
    setAction(it, { busy: "map" });
    try {
      const d = data ?? (await adapter.mapData(it, choice));
      variableId ??= choice?.variable;
      if (d.variables.length > 1 && !variableId) return setAction(it, { choose: d, chooseChoice: choice });
      const variable = d.variables.find((v) => v.id === variableId) ?? d.variables[0]!;
      onAddLayer(await buildMapLayer(it, d, variable, choice));
      setAction(it, { ok: `No mapa: ${variable.name} · ${d.period} · ${MAP_LEVELS[d.level].name.toLowerCase()}` });
    } catch (e) {
      setAction(it, { error: `Não deu para pôr no mapa: ${(e as Error).message}` });
    }
  };

  const total = LIBRARY_SOURCES.reduce((s, x) => s + x.items, 0);

  return (
    <div className="wizard-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wizard reference-catalog" role="dialog" aria-modal="true" aria-labelledby="library-title">
        <header className="wizard-header">
          <h2 id="library-title">Biblioteca de dados</h2>
          <button type="button" className="wizard-close" onClick={onClose} aria-label="Fechar biblioteca">
            <Icon name="close" />
          </button>
        </header>
        <div className="wizard-body">
          <p className="wizard-lead muted">
            {int.format(total)} tabelas e séries de {LIBRARY_SOURCES.length} fontes públicas. Baixe direto da fonte oficial ou coloque no
            mapa — o dado vem da fonte para o seu navegador; a City View não hospeda nada.
          </p>
          <div className="library-sources" role="radiogroup" aria-label="Fonte">
            <button
              type="button"
              role="radio"
              aria-checked={sourceId === "all"}
              className={sourceId === "all" ? "is-active" : ""}
              onClick={() => {
                setSourceId("all");
                setGroup("");
              }}
            >
              Todas <span>{int.format(total)}</span>
            </button>
            {LIBRARY_SOURCES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={sourceId === s.id}
                className={sourceId === s.id ? "is-active" : ""}
                title={s.description}
                onClick={() => {
                  setSourceId(s.id);
                  setGroup("");
                }}
              >
                {s.name} <span>{int.format(s.items)}</span>
              </button>
            ))}
          </div>
          <div className="refs-search">
            <input
              ref={input}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar: população, renda, PIB municipal, rebanho, 2022, 4714…"
              aria-label="Buscar na biblioteca"
            />
            {groups.length > 0 && (
              <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Filtrar por grupo">
                <option value="">Todos os grupos</option>
                {groups.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            )}
            <label className="toggle refs-municipal">
              <input type="checkbox" checked={municipalOnly} onChange={(e) => setMunicipalOnly(e.target.checked)} />
              Só com dado confirmado por município (dá para pôr no mapa)
            </label>
          </div>
          {indexes ? (
            <p className="muted refs-count">
              {int.format(results.total)} {results.total === 1 ? "resultado" : "resultados"}
              {results.total > MAX_RESULTS && ` · mostrando os primeiros ${MAX_RESULTS}, refine a busca`}
            </p>
          ) : (
            <p className="muted">Carregando índices…</p>
          )}
          <ul className="refs-list">
            {results.items.map((it) => {
              const state = actions[key(it)] ?? {};
              const adapter = ADAPTERS[it.source.adapter];
              const canMap = Boolean(adapter?.mapData) && Boolean(it.flags & (FLAG.MUNICIPAL | FLAG.REGIONAL));
              return (
                <li key={key(it)}>
                  <div>
                    <b>{it.title}</b>
                    <span className="muted">
                      {it.source.name} · {it.id}
                      {it.group ? ` · ${it.group}` : ""}
                      {it.subject ? ` · ${it.subject}` : ""}
                      {years(it) ? ` · ${years(it)}` : ""}
                    </span>
                    <span className="refs-badges">
                      {it.flags & FLAG.MUNICIPAL ? <span className="refs-badge">por município</span> : null}
                      {!(it.flags & FLAG.MUNICIPAL) && it.flags & FLAG.REGIONAL ? <span className="refs-badge regional">por estado/região</span> : null}
                    </span>
                    {state.choose && (
                      <span className="library-choose">
                        Qual variável colocar no mapa?
                        {state.choose.variables.map((v) => (
                          <button key={v.id} type="button" className="link" onClick={() => void showOnMap(it, state.choose, v.id, state.chooseChoice)}>
                            {v.name}
                            {v.unit ? ` (${v.unit})` : ""}
                          </button>
                        ))}
                      </span>
                    )}
                    {itemOptions[key(it)]?.open && (
                      <ItemOptionsPanel
                        state={itemOptions[key(it)]!}
                        busy={Boolean(state.busy)}
                        canMap={canMap}
                        canDownload={Boolean(it.flags & FLAG.DOWNLOAD)}
                        onChoice={(patch) => setChoice(it, patch)}
                        onDownload={(choice) => void download(it, choice)}
                        onMap={(choice) => void showOnMap(it, undefined, undefined, choice)}
                      />
                    )}
                    {state.ok && <span className="refs-ok">{state.ok}</span>}
                    {state.error && <span className="refs-error">{state.error}</span>}
                  </div>
                  <div className="refs-actions">
                    {canMap && (
                      <button type="button" className="btn btn-primary" disabled={Boolean(state.busy)} onClick={() => void showOnMap(it)}>
                        {state.busy === "map" ? "Carregando…" : "Ver no mapa"}
                      </button>
                    )}
                    {adapter && it.flags & FLAG.DOWNLOAD ? (
                      <button type="button" className="btn" disabled={Boolean(state.busy)} onClick={() => void download(it)}>
                        {state.busy === "download" ? "Baixando…" : "Baixar CSV"}
                      </button>
                    ) : null}
                    {adapter?.options && (
                      <button
                        type="button"
                        className="btn"
                        aria-expanded={Boolean(itemOptions[key(it)]?.open)}
                        onClick={() => void toggleOptions(it)}
                        title="Escolher período, recorte e variável"
                      >
                        Opções <Icon name={itemOptions[key(it)]?.open ? "chevronUp" : "chevronDown"} size={16} />
                      </button>
                    )}
                    {it.url && (
                      <a className="btn" href={it.url} target="_blank" rel="noreferrer" title="Abrir na fonte oficial">
                        Fonte <Icon name="external" size={16} />
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <footer className="wizard-footer">
          <span className="muted refs-license">
            {sourceId === "all"
              ? "Cada item mostra a sua fonte. Cite a fonte ao usar os dados."
              : `${LIBRARY_SOURCES.find((s) => s.id === sourceId)?.name}: ${LIBRARY_SOURCES.find((s) => s.id === sourceId)?.license}`}
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Fechar
          </button>
        </footer>
      </div>
    </div>
  );
}

function ItemOptionsPanel({
  state,
  busy,
  canMap,
  canDownload,
  onChoice,
  onDownload,
  onMap,
}: {
  state: OptionsState;
  busy: boolean;
  canMap: boolean;
  canDownload: boolean;
  onChoice: (patch: ItemChoice) => void;
  onDownload: (choice: ItemChoice) => void;
  onMap: (choice: ItemChoice) => void;
}) {
  if (state.loading) return <span className="library-options muted">Carregando opções da fonte…</span>;
  if (state.error) return <span className="library-options refs-error">Não deu para carregar as opções: {state.error}</span>;
  const o = state.options;
  if (!o) return null;
  const { choice } = state;
  const periods = o.periods.slice(0, MAX_PERIOD_OPTIONS);
  return (
    <span className="library-options">
      <label>
        Período
        <select value={choice.period ?? ""} onChange={(e) => onChoice({ period: e.target.value || undefined })}>
          <option value="">Mais recente{o.periods[0] ? ` (${o.periods[0].label})` : ""}</option>
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {o.levels.length > 0 && (
        <label>
          Recorte (download)
          <select value={choice.level ?? ""} onChange={(e) => onChoice({ level: e.target.value || undefined })}>
            <option value="">Mais detalhado ({o.levels[0]!.name})</option>
            {o.levels.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {o.variables.length > 1 && (
        <label>
          Variável
          <select value={choice.variable ?? ""} onChange={(e) => onChoice({ variable: e.target.value || undefined })}>
            <option value="">Todas (no mapa, você escolhe uma)</option>
            {o.variables.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.unit ? ` (${v.unit})` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {o.classifications?.map((c) => (
        <label key={c.id}>
          {c.name}
          <select
            value={choice.categories?.[c.id] ?? ""}
            onChange={(e) => onChoice({ categories: { ...choice.categories, [c.id]: e.target.value } })}
          >
            <option value="">Total</option>
            {c.categories
              .filter((x) => x.level > 0)
              .slice(0, MAX_CATEGORY_OPTIONS)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {"\u00a0\u00a0".repeat(Math.max(0, x.level - 1))}
                  {x.name}
                </option>
              ))}
          </select>
        </label>
      ))}
      {canMap && o.mapLevels.length > 1 && (
        <label>
          Recorte (mapa)
          <select value={choice.mapLevel ?? ""} onChange={(e) => onChoice({ mapLevel: (e.target.value || undefined) as ItemChoice["mapLevel"] })}>
            <option value="">Mais detalhado ({MAP_LEVELS[o.mapLevels[0]!].name})</option>
            {o.mapLevels.map((l) => (
              <option key={l} value={l}>
                {MAP_LEVELS[l].name}
              </option>
            ))}
          </select>
        </label>
      )}
      <span className="library-options-actions">
        {canDownload && (
          <button type="button" className="btn" disabled={busy} onClick={() => onDownload(choice)}>
            Baixar com essas opções
          </button>
        )}
        {canMap && o.mapLevels.length > 0 && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onMap(choice)}>
            Ver no mapa
          </button>
        )}
        {o.mapLevels.length === 0 && <span className="muted">Sem recorte por município ou estado: só download.</span>}
      </span>
    </span>
  );
}
