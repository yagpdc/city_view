import { useState, type FormEvent } from "react";
import { Icon } from "./Icon";

interface TopBarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onSearch: (query: string) => void;
}

export function TopBar({ sidebarOpen, onToggleSidebar, onSearch }: TopBarProps) {
  const [query, setQuery] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (query.trim()) onSearch(query.trim());
  };

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
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Pesquisar lugares, endereços, coordenadas…"
          aria-label="Pesquisar"
        />
      </form>
    </header>
  );
}
