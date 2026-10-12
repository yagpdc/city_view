import { useEffect, useMemo, useRef, useState } from "react";
import { downloadSidraTable } from "../sidraDownload";

/** Catálogo de referência: só índice + link para baixar na fonte oficial (não hospedamos o dado). */
interface SidraCatalog {
  source: string;
  sourceUrl: string;
  tableUrl: string;
  license: string;
  updatedAt: string;
  surveys: { id: string; name: string; count: number }[];
  subjects?: string[];
  /** [id, nome, pesquisa, assunto (-1 = sem), ano inicial, ano final, tem municípios (0/1)] */
  tables: Table[];
}

type Table = [number, string, number, number?, (number | null)?, (number | null)?, number?];

/** O IBGE usa termos técnicos; a busca aceita os do dia a dia. */
const SYNONYMS: Record<string, string[]> = {
  renda: ["rendimento"],
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
};

const MAX_RESULTS = 200;
const int = new Intl.NumberFormat("pt-BR");
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

let cached: Promise<SidraCatalog> | null = null;
/** Carregado sob demanda (1,8 MB): só quando a pessoa abre o catálogo. */
function loadSidra(): Promise<SidraCatalog> {
  cached ??= import("../../../../datapacks/references/sidra.json").then((m) => m.default as unknown as SidraCatalog);
  return cached;
}

const years = (t: Table) => {
  const [, , , , from, to] = t;
  if (!from) return "";
  return to && to !== from ? `${from}–${to}` : String(from);
};

export function ReferenceCatalog({ onClose }: { onClose: () => void }) {
  const [catalog, setCatalog] = useState<SidraCatalog | null>(null);
  const [query, setQuery] = useState("");
  const [survey, setSurvey] = useState(-1);
  const [municipalOnly, setMunicipalOnly] = useState(false);
  /** Estado do download por tabela: em andamento, concluído (mensagem) ou erro. */
  const [downloads, setDownloads] = useState<Record<number, { busy?: boolean; ok?: string; error?: string }>>({});

  const download = async (id: number) => {
    setDownloads((d) => ({ ...d, [id]: { busy: true } }));
    try {
      const r = await downloadSidraTable(id);
      setDownloads((d) => ({ ...d, [id]: { ok: `${int.format(r.rows)} linhas · ${r.levelName} · ${r.period}` } }));
    } catch (e) {
      setDownloads((d) => ({ ...d, [id]: { error: (e as Error).message } }));
    }
  };
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadSidra().then(setCatalog);
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Índice de busca: nome, pesquisa, assunto, número e anos da tabela, sem acentos.
  const index = useMemo(
    () =>
      catalog?.tables.map((t) => {
        const [id, name, s, subject = -1, from, to] = t;
        const span = from && to ? Array.from({ length: Math.min(to - from + 1, 80) }, (_, i) => from + i).join(" ") : "";
        return normalize(`${name} ${catalog.surveys[s]?.name ?? ""} ${catalog.subjects?.[subject] ?? ""} ${id} ${span}`);
      }) ?? [],
    [catalog],
  );

  const names = useMemo(() => catalog?.tables.map((t) => normalize(t[1])) ?? [], [catalog]);

  const results = useMemo(() => {
    if (!catalog) return { total: 0, items: [] as SidraCatalog["tables"] };
    const terms = normalize(query)
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => [term, ...(SYNONYMS[term] ?? [])]);
    const matches: { t: Table; score: number }[] = [];
    catalog.tables.forEach((t, i) => {
      if (survey !== -1 && t[2] !== survey) return;
      if (municipalOnly && t[6] !== 1) return;
      if (terms.length && !terms.every((alts) => alts.some((a) => index[i]!.includes(a)))) return;
      // Relevância: termos no nome da tabela > recente > tem municípios.
      const inName = terms.filter((alts) => alts.some((a) => names[i]!.includes(a))).length;
      const recent = (t[5] ?? t[4] ?? 1900) - 1900;
      matches.push({ t, score: inName * 1000 + recent + (t[6] === 1 ? 50 : 0) });
    });
    if (terms.length) matches.sort((a, b) => b.score - a.score);
    return { total: matches.length, items: matches.slice(0, MAX_RESULTS).map((m) => m.t) };
  }, [catalog, index, names, query, survey, municipalOnly]);

  return (
    <div className="wizard-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wizard reference-catalog" role="dialog" aria-modal="true" aria-labelledby="refs-title">
        <header className="wizard-header">
          <h2 id="refs-title">Catálogo de referências · IBGE SIDRA</h2>
          <button type="button" className="wizard-close" onClick={onClose} aria-label="Fechar catálogo">
            ×
          </button>
        </header>
        <div className="wizard-body">
          <p className="wizard-lead muted">
            {catalog ? `${int.format(catalog.tables.length)} tabelas de ${catalog.surveys.length} pesquisas.` : "Carregando…"} “Baixar
            CSV” busca direto na API do IBGE o período mais recente, no recorte mais detalhado disponível. Para escolher anos,
            recortes e classificações, use o SIDRA. A City View não hospeda esses dados.
          </p>
          <div className="refs-search">
            <input
              ref={input}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar: população, renda, censo 2022, agropecuária, 4714…"
              aria-label="Buscar tabelas"
            />
            <select value={survey} onChange={(e) => setSurvey(Number(e.target.value))} aria-label="Filtrar por pesquisa">
              <option value={-1}>Todas as pesquisas</option>
              {catalog?.surveys.map((s, i) => (
                <option key={s.id} value={i}>
                  {s.name} ({int.format(s.count)})
                </option>
              ))}
            </select>
            <label className="toggle refs-municipal">
              <input type="checkbox" checked={municipalOnly} onChange={(e) => setMunicipalOnly(e.target.checked)} />
              Só com dado por município (dá para cruzar no mapa)
            </label>
          </div>
          {catalog && (
            <p className="muted refs-count">
              {int.format(results.total)} {results.total === 1 ? "tabela" : "tabelas"}
              {results.total > MAX_RESULTS && ` · mostrando as primeiras ${MAX_RESULTS}, refine a busca`}
            </p>
          )}
          <ul className="refs-list">
            {catalog &&
              results.items.map((t) => {
                const [id, name, s, subject = -1, , , municipal] = t;
                return (
                <li key={id}>
                  <div>
                    <b>{name}</b>
                    <span className="muted">
                      Tabela {id} · {catalog.surveys[s]?.name}
                      {subject >= 0 && catalog.subjects ? ` · ${catalog.subjects[subject]}` : ""}
                      {years(t) ? ` · ${years(t)}` : ""}
                    </span>
                    {municipal === 1 && <span className="refs-badge">por município</span>}
                    {downloads[id]?.ok && <span className="refs-ok">Baixado: {downloads[id]!.ok}</span>}
                    {downloads[id]?.error && <span className="refs-error">Não deu para baixar direto: {downloads[id]!.error}</span>}
                  </div>
                  <div className="refs-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={downloads[id]?.busy}
                      onClick={() => void download(id)}
                      title="Baixa do IBGE o período mais recente, no recorte mais detalhado disponível"
                    >
                      {downloads[id]?.busy ? "Baixando…" : "Baixar CSV"}
                    </button>
                    <a className="btn" href={catalog.tableUrl.replace("{id}", String(id))} target="_blank" rel="noreferrer">
                      SIDRA ↗
                    </a>
                  </div>
                </li>
                );
              })}
          </ul>
        </div>
        <footer className="wizard-footer">
          <span className="muted refs-license">
            Fonte: {catalog?.source ?? "IBGE"} · {catalog?.license ?? ""}
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Fechar
          </button>
        </footer>
      </div>
    </div>
  );
}
