import { PALETTES, classColors, type DataStyle } from "@cityview/engine";
import { useState, type ReactNode } from "react";
import { Icon } from "./Icon";

export interface LegendLayer {
  id: string;
  title: string;
  style: DataStyle;
  categories: { label: string; color: string }[];
  /** Menor e maior valor da coluna de cor (degradê). */
  range?: { min: number; max: number } | null;
}

const num = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, notation: "compact" });
const LEGEND_KEY = "cityview.legend-open";

function readOpen(): boolean {
  try {
    return localStorage.getItem(LEGEND_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Legenda sobre o mapa: o estilo de cada camada ligada (cores, faixas, tamanho). Recolhe num clique. */
export function MapLegend({ layers }: { layers: LegendLayer[] }) {
  const [open, setOpen] = useState(readOpen);
  if (layers.length === 0) return null;
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(LEGEND_KEY, o ? "0" : "1");
      } catch {
        // Modo privado: segue sem lembrar.
      }
      return !o;
    });
  };
  return (
    <aside className="map-legend" aria-label="Legenda">
      <button type="button" className="map-legend-head" aria-expanded={open} onClick={toggle}>
        Legenda
        <Icon name={open ? "chevronDown" : "chevronUp"} size={16} />
      </button>
      {open && (
        <div className="map-legend-body">
          {layers.map((l) => (
            <LegendEntry key={l.id} layer={l} />
          ))}
        </div>
      )}
    </aside>
  );
}

function LegendEntry({ layer: l }: { layer: LegendLayer }) {
  const s = l.style;
  const square = s.shape === "squares";
  const sizeNote =
    s.shape === "circles" ? `Círculos de ${num.format(s.size)} m de raio` : s.shape === "squares" ? `Quadrados de ${num.format(s.size)} m de lado` : null;
  let body: ReactNode;
  if (s.shape === "hex" || s.shape === "regions" || s.shape === "heatmap") {
    const pal = s.shape === "heatmap" && (s.color.mode === "value" || s.color.mode === "classes") ? PALETTES[s.color.palette] : PALETTES.densidade;
    body = (
      <>
        <div className="map-legend-bar" style={{ background: `linear-gradient(90deg, ${pal.join(", ")})` }} />
        <div className="map-legend-ends">
          <span>menos</span>
          <span>{s.shape === "regions" ? "mais registros por km²" : s.shape === "hex" ? "mais registros" : "mais"}</span>
        </div>
      </>
    );
  } else if (s.color.mode === "single") {
    body = (
      <ul>
        <li>
          <i className={square ? "sq" : ""} style={{ background: s.color.value }} />
          Registros
        </li>
      </ul>
    );
  } else if (s.color.mode === "value") {
    body = (
      <>
        <div className="map-legend-bar" style={{ background: `linear-gradient(90deg, ${PALETTES[s.color.palette].join(", ")})` }} />
        <div className="map-legend-ends">
          <span>{l.range ? num.format(l.range.min) : "menor"}</span>
          <span>{s.color.column}</span>
          <span>{l.range ? num.format(l.range.max) : "maior"}</span>
        </div>
      </>
    );
  } else if (s.color.mode === "classes") {
    const colors = classColors(s.color.palette, s.color.breaks.length + 1);
    const b = s.color.breaks;
    body = (
      <ul>
        {colors.map((c, i) => (
          <li key={i}>
            <i className={square ? "sq" : ""} style={{ background: c }} />
            {i === 0 ? `até ${num.format(b[0]!)}` : i === colors.length - 1 ? `${num.format(b[i - 1]!)} ou mais` : `${num.format(b[i - 1]!)} a ${num.format(b[i]!)}`}
          </li>
        ))}
      </ul>
    );
  } else {
    const hl = s.highlight;
    body = (
      <ul>
        {l.categories.slice(0, 10).map((c, i) => (
          <li key={c.label} className={hl?.length && !hl.includes(i) ? "is-dim" : ""}>
            <i className={square ? "sq" : ""} style={{ background: c.color }} />
            {c.label}
          </li>
        ))}
        {l.categories.length > 10 && <li>+ {l.categories.length - 10} categorias</li>}
      </ul>
    );
  }
  return (
    <div className="map-legend-layer">
      <b>{l.title}</b>
      {body}
      {sizeNote && <p className="map-legend-note">{sizeNote}</p>}
      {s.sizeBy && <p className="map-legend-note">Tamanho: {s.sizeBy}</p>}
      {s.color.mode === "classes" && <p className="map-legend-note">Faixas de {s.color.column}</p>}
    </div>
  );
}
