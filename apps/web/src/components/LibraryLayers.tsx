import type { LibraryLayer } from "../library/mapLayer";

const fmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2, notation: "compact" });

/** Camadas criadas a partir da biblioteca, com legenda. */
export function LibraryLayers({
  layers,
  active,
  onToggle,
  onRemove,
}: {
  layers: LibraryLayer[];
  active: Set<string>;
  onToggle: (id: string, on: boolean) => void;
  onRemove: (id: string) => void;
}) {
  if (layers.length === 0) return null;
  return (
    <div className="catalog-group library-layers">
      <h3>Da biblioteca</h3>
      {layers.map((l) => (
        <div key={l.manifest.id} className="user-dataset">
          <label className="toggle">
            <input type="checkbox" checked={active.has(l.manifest.id)} onChange={(e) => onToggle(l.manifest.id, e.target.checked)} />
            <span>{l.variable}</span>
          </label>
          <div className="user-dataset-actions">
            <button type="button" className="link danger" onClick={() => onRemove(l.manifest.id)}>
              remover
            </button>
          </div>
          <p className="catalog-meta">
            {l.item.sourceName} · {l.period} · {new Intl.NumberFormat("pt-BR").format(l.matched)} municípios
            {l.missing > 0 ? ` (${l.missing} sem par na malha)` : ""}
          </p>
          <div className="legend-scale" aria-label="Legenda">
            {l.colors.map((c, i) => (
              <span key={c} style={{ background: c }} title={i === 0 ? `até ${fmt.format(l.breaks[0] ?? 0)}` : `a partir de ${fmt.format(l.breaks[i - 1] ?? 0)}`} />
            ))}
          </div>
          <p className="legend-labels">
            <span>{fmt.format(l.breaks[0] ?? 0)}</span>
            <span>{l.unit}</span>
            <span>{fmt.format(l.breaks.at(-1) ?? 0)}+</span>
          </p>
        </div>
      ))}
    </div>
  );
}
