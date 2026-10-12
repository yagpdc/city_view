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

interface TopBarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  /** Busca assíncrona; chamada com atraso enquanto a pessoa digita. */
  search: (query: string) => Promise<SearchResult[]>;
  onSelect: (result: SearchResult) => void;
}

const DEBOUNCE_MS = 250;
const KIND_LABEL: Record<SearchResult["kind"], string> = { city: "Cidade", place: "", coords: "Coordenada" };

export function TopBar({ sidebarOpen, onToggleSidebar, search, onSelect }: TopBarProps) {
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
    <header className="topbar">
      <button
        type="button"
        className="icon-button"
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? "Fechar opções" : "Abrir opções"}
        aria-expanded={sidebarOpen}
        aria-controls="sidebar"
      >
        <Icon name={sidebarOpen ? "close" : "sliders"} />
      </button>
      <form className="search" role="search" onSubmit={submit}>
        <Icon name="search" size={18} />
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
        {showList && (
          <ul id="search-results" className="search-results" role="listbox">
            {loading && results.length === 0 && <li className="search-status">Buscando…</li>}
            {!loading && results.length === 0 && (
              <li className="search-status">Nada encontrado perto daqui. Tente o nome de uma cidade.</li>
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
                  <b>{r.title}</b>
                  {(r.subtitle || KIND_LABEL[r.kind]) && <small>{r.subtitle ?? KIND_LABEL[r.kind]}</small>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </form>
    </header>
  );
}
