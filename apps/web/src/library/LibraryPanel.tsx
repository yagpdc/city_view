import { useEffect, useMemo, useRef, useState } from "react";
import { ADAPTERS } from "./adapters";
import { LIBRARY_SOURCES, loadAllSources } from "./load";
import { buildMunicipalLayer, type LibraryLayer } from "./mapLayer";
import { FLAG, decodeItem, type LibraryItem, type LibrarySourceIndex, type MunicipalData } from "./types";

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

type ActionState = { busy?: "download" | "map"; ok?: string; error?: string; choose?: MunicipalData };

const years = (it: LibraryItem) =>
  !it.yearFrom && !it.yearTo ? "" : it.yearFrom && it.yearTo && it.yearFrom !== it.yearTo ? `${it.yearFrom}–${it.yearTo}` : `${it.yearTo ?? it.yearFrom}`;

export function LibraryPanel({ onClose, onAddLayer }: { onClose: () => void; onAddLayer: (layer: LibraryLayer) => void }) {
  const [indexes, setIndexes] = useState<LibrarySourceIndex[] | null>(null);
  const [query, setQuery] = useState("");
  const [sourceId, setSourceId] = useState<string>("all");
  const [group, setGroup] = useState("");
  const [municipalOnly, setMunicipalOnly] = useState(false);
  const [actions, setActions] = useState<Record<string, ActionState>>({});
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

  const download = async (it: LibraryItem) => {
    const adapter = ADAPTERS[it.source.adapter];
    if (!adapter) return;
    setAction(it, { busy: "download" });
    try {
      const r = await adapter.download(it);
      setAction(it, { ok: `Baixado: ${int.format(r.rows)} linhas · ${r.detail}` });
    } catch (e) {
      setAction(it, { error: `Não deu para baixar direto: ${(e as Error).message}` });
    }
  };

  const showOnMap = async (it: LibraryItem, data?: MunicipalData, variableId?: string) => {
    const adapter = ADAPTERS[it.source.adapter];
    if (!adapter?.municipal) return;
    setAction(it, { busy: "map" });
    try {
      const d = data ?? (await adapter.municipal(it));
      if (d.variables.length > 1 && !variableId) return setAction(it, { choose: d });
      const variable = d.variables.find((v) => v.id === variableId) ?? d.variables[0]!;
      onAddLayer(await buildMunicipalLayer(it, d, variable));
      setAction(it, { ok: `No mapa: ${variable.name} · ${d.period}` });
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
            ×
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
              const canMap = Boolean(adapter?.municipal) && Boolean(it.flags & (FLAG.MUNICIPAL | FLAG.REGIONAL));
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
                      {!(it.flags & FLAG.MUNICIPAL) && it.flags & FLAG.REGIONAL ? <span className="refs-badge regional">regional</span> : null}
                    </span>
                    {state.choose && (
                      <span className="library-choose">
                        Qual variável colocar no mapa?
                        {state.choose.variables.map((v) => (
                          <button key={v.id} type="button" className="link" onClick={() => void showOnMap(it, state.choose, v.id)}>
                            {v.name}
                            {v.unit ? ` (${v.unit})` : ""}
                          </button>
                        ))}
                      </span>
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
                    {it.url && (
                      <a className="btn" href={it.url} target="_blank" rel="noreferrer" title="Abrir na fonte oficial">
                        Fonte ↗
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
