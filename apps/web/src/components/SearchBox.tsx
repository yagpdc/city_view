import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Icon } from "./Icon";

/** Um resultado da busca (cidade, lugar, registro ou coordenada). */
export interface SearchResult {
  key: string;
  title: string;
  subtitle?: string;
  /** Cor do marcador (categoria do ponto). */
  color?: string;
  kind: "city" | "place" | "coords";
}

const DEBOUNCE_MS = 250;
const KIND_LABEL: Record<SearchResult["kind"], string> = { city: "Cidade", place: "", coords: "Coordenada" };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Trecho digitado em negrito (sem diferenciar acento/maiúscula). */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = fold(query.trim());
  const i = q ? fold(text).indexOf(q) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <strong>{text.slice(i, i + q.length)}</strong>
      {text.slice(i + q.length)}
    </>
  );
}

/**
 * Busca com sugestões (docs/DESIGN.md · Molécula 2), flutuando no canto do mapa.
 * Setas navegam, Enter escolhe, Esc fecha.
 */
export function SearchBox({ search, onSelect }: { search: (query: string) => Promise<SearchResult[]>; onSelect: (result: SearchResult) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const ticket = ++latest.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      search(q)
        .then((r) => {
          if (ticket !== latest.current) return;
          setResults(r);
          setActive(0);
        })
        .catch(() => ticket === latest.current && setResults([]))
        .finally(() => ticket === latest.current && setLoading(false));
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, search]);

  const choose = (r: SearchResult | undefined) => {
    if (!r) return;
    onSelect(r);
    setOpen(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    choose(results[active]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showList = open && query.trim().length >= 2;

  return (
    <form className="search map-search" role="search" onSubmit={submit}>
      <Icon name="search" />
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        placeholder="Buscar lugar, cidade ou coordenada…"
        aria-label="Pesquisar"
        aria-expanded={showList}
        aria-controls="search-results"
        aria-autocomplete="list"
        role="combobox"
      />
      {query && (
        <button type="button" className="icon-button sm search-clear" aria-label="Limpar busca" onClick={() => setQuery("")}>
          <Icon name="close" size={16} />
        </button>
      )}
      {showList && (
        <ul id="search-results" className="search-results" role="listbox">
          {loading && results.length === 0 && <li className="search-status">Buscando perto daqui…</li>}
          {!loading && results.length === 0 && (
            <li className="search-status">Nada encontrado perto daqui. Tente o nome de uma cidade ou cole uma coordenada.</li>
          )}
          {results.map((r, i) => (
            <li
              key={r.key}
              role="option"
              aria-selected={i === active}
              className={i === active ? "is-active" : ""}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(r)}
            >
              <i className={`search-dot kind-${r.kind}`} style={r.color ? { background: r.color } : undefined} />
              <span className="search-text">
                <b>
                  <Highlight text={r.title} query={query} />
                </b>
                {(r.subtitle || KIND_LABEL[r.kind]) && <small>{r.subtitle ?? KIND_LABEL[r.kind]}</small>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
