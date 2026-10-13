import {
  DEFAULT_DATA_STYLE,
  PALETTES,
  PALETTE_LABELS,
  SHAPE_DEFAULT_SIZE,
  normalizeDataStyle,
  type DataShape,
  type DataStyle,
  type PaletteName,
} from "@cityview/engine";
import { useRef, useState } from "react";
import { Icon } from "./Icon";

const SHAPES: { id: DataShape; label: string; hint: string }[] = [
  { id: "points", label: "Pontos", hint: "Uma bolinha por registro" },
  { id: "circles", label: "Círculos", hint: "Área em volta de cada ponto, em metros" },
  { id: "squares", label: "Quadrados", hint: "Quadrado em volta de cada ponto, em metros" },
  { id: "heatmap", label: "Mancha de calor", hint: "Onde há mais registros, mais forte" },
  { id: "hex", label: "Hexágonos", hint: "Densidade em hexágonos (o tamanho acompanha o zoom)" },
  { id: "regions", label: "Regiões", hint: "Estados e municípios com o número de registros" },
];

const SWATCHES = ["#4a50d6", "#e8590c", "#2b9348", "#c2255c", "#1098ad", "#7048e8", "#b08900", "#151a24"];

/** Faixa do controle de tamanho de cada forma (mínimo, máximo, unidade). */
const SIZE_RANGE: Partial<Record<DataShape, { min: number; max: number; unit: string; log?: boolean; label: string }>> = {
  points: { min: 1.5, max: 16, unit: "px", label: "Tamanho do ponto" },
  circles: { min: 10, max: 5000, unit: "m", log: true, label: "Raio" },
  squares: { min: 10, max: 5000, unit: "m", log: true, label: "Lado" },
  heatmap: { min: 4, max: 80, unit: "px", label: "Raio da mancha" },
};

const fmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function ShapeGlyph({ shape }: { shape: DataShape }) {
  const c = "currentColor";
  return (
    <svg width="34" height="26" viewBox="0 0 34 26" aria-hidden="true">
      {shape === "points" && [[7, 8], [17, 15], [26, 7], [12, 19], [25, 19]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="2.6" fill={c} />)}
      {shape === "circles" && [[10, 10], [22, 14], [14, 18]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="6.5" fill={c} fillOpacity="0.25" stroke={c} strokeWidth="1.2" />)}
      {shape === "squares" && [[5, 4], [17, 9], [9, 14]].map(([x, y]) => <rect key={`${x}${y}`} x={x} y={y} width="11" height="11" fill={c} fillOpacity="0.3" stroke={c} strokeWidth="1" />)}
      {shape === "heatmap" && (
        <>
          <defs>
            <radialGradient id="hm">
              <stop offset="0" stopColor={c} stopOpacity="0.9" />
              <stop offset="1" stopColor={c} stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse cx="14" cy="13" rx="12" ry="10" fill="url(#hm)" />
          <ellipse cx="24" cy="10" rx="8" ry="7" fill="url(#hm)" />
        </>
      )}
      {shape === "hex" &&
        ([[9, 8], [19, 8], [14, 16.5], [24, 16.5]] as const).map(([x, y]) => (
          <polygon key={`${x}${y}`} points={[0, 1, 2, 3, 4, 5].map((i) => `${x + 5 * Math.cos((Math.PI / 3) * i + Math.PI / 6)},${y + 5 * Math.sin((Math.PI / 3) * i + Math.PI / 6)}`).join(" ")} fill={c} fillOpacity={0.25 + ((x + y) % 3) * 0.2} />
        ))}
      {shape === "regions" && <path d="M3 5 L14 3 L18 10 L13 15 L4 13 Z M18 10 L30 6 L31 18 L20 22 L13 15 Z" fill={c} fillOpacity="0.3" stroke={c} strokeWidth="1" />}
    </svg>
  );
}

/**
 * Editor de estilo de uma camada (sandbox): cada mudança aparece no mapa na hora; "Salvar" guarda na aba,
 * "Descartar" volta ao que estava. O estilo pode ser baixado e aplicado em outra camada.
 */
export function StyleEditor({
  title,
  style,
  numericColumns,
  hasCategories,
  hasRegions,
  onChange,
  onSave,
  onDiscard,
}: {
  title: string;
  style: DataStyle;
  numericColumns: { name: string; label: string }[];
  hasCategories: boolean;
  hasRegions: boolean;
  onChange: (s: DataStyle) => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const set = (patch: Partial<DataStyle>) => onChange({ ...style, ...patch });
  const range = SIZE_RANGE[style.shape];
  const toSlider = (v: number) => (range?.log ? (Math.log(v / range.min) / Math.log(range.max / range.min)) * 100 : ((v - range!.min) / (range!.max - range!.min)) * 100);
  const fromSlider = (t: number) => {
    const v = range!.log ? range!.min * (range!.max / range!.min) ** (t / 100) : range!.min + ((range!.max - range!.min) * t) / 100;
    return range!.log ? Math.round(v / (v > 500 ? 50 : 5)) * (v > 500 ? 50 : 5) : Math.round(v * 2) / 2;
  };
  const colorMode = style.color.mode;
  const numericNames = numericColumns.map((c) => c.name);

  const download = () => {
    const blob = new Blob([JSON.stringify({ cityview: "estilo", version: 1, style }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[^\p{L}\p{N}_-]+/gu, "_")}.estilo.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const load = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as { style?: unknown };
      let next = normalizeDataStyle(parsed.style ?? parsed);
      const missing: string[] = [];
      // Colunas que esta camada não tem: o estilo vem sem elas.
      if (next.sizeBy && !numericNames.includes(next.sizeBy)) {
        missing.push(next.sizeBy);
        next = { ...next, sizeBy: null };
      }
      if (next.color.mode === "value" && !numericNames.includes(next.color.column)) {
        missing.push(next.color.column);
        next = { ...next, color: { mode: "category" } };
      }
      if (next.shape === "regions" && !hasRegions) next = { ...next, shape: "points", size: SHAPE_DEFAULT_SIZE.points };
      onChange(next);
      setNote(missing.length ? `Aplicado. Esta camada não tem ${missing.map((m) => `"${m}"`).join(", ")}: essa parte ficou de fora.` : "Estilo aplicado. Salve para manter.");
    } catch {
      setNote("Esse arquivo não é um estilo do City View.");
    }
  };

  return (
    <aside className="style-editor" aria-label={`Estilo de ${title}`}>
      <header className="style-editor-head">
        <div>
          <span className="kicker">Estilo · prévia ao vivo</span>
          <h3 title={title}>{title}</h3>
        </div>
        <button type="button" className="icon-button sm" onClick={onDiscard} aria-label="Fechar sem salvar" title="Fechar sem salvar">
          <Icon name="close" size={18} />
        </button>
      </header>

      <div className="style-editor-body">
        <section>
          <h4>Forma</h4>
          <div className="style-shapes" role="radiogroup" aria-label="Forma">
            {SHAPES.map((s) => {
              const disabled = s.id === "regions" && !hasRegions;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={style.shape === s.id}
                  className={style.shape === s.id ? "is-on" : ""}
                  disabled={disabled}
                  title={disabled ? "Esta camada foi gerada antes da contagem por região: importe de novo" : s.hint}
                  onClick={() => set({ shape: s.id, size: s.id === style.shape ? style.size : SHAPE_DEFAULT_SIZE[s.id] })}
                >
                  <ShapeGlyph shape={s.id} />
                  <span>{s.label}</span>
                </button>
              );
            })}
          </div>
          <p className="style-hint">{SHAPES.find((s) => s.id === style.shape)?.hint}</p>
        </section>

        {range && (
          <section>
            <h4>
              {range.label} <span className="num">{fmt.format(style.size)} {range.unit}</span>
            </h4>
            <input
              type="range"
              min={0}
              max={100}
              step={0.5}
              value={toSlider(style.size)}
              onChange={(e) => set({ size: fromSlider(Number(e.target.value)) })}
              aria-label={range.label}
            />
            {numericColumns.length > 0 && (
              <label className="style-row">
                {style.shape === "heatmap" ? "Peso por coluna" : "Tamanho por coluna"}
                <select value={style.sizeBy ?? ""} onChange={(e) => set({ sizeBy: e.target.value || null })}>
                  <option value="">Nenhuma (igual para todos)</option>
                  {numericColumns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>
        )}

        {style.shape !== "hex" && style.shape !== "regions" && (
          <section>
            <h4>Cor</h4>
            <div className="segmented" role="radiogroup" aria-label="Cor">
              {(
                [
                  ["category", "Por categoria", !hasCategories || style.shape === "heatmap"],
                  ["single", "Uma cor", style.shape === "heatmap"],
                  ["value", "Por valor", numericColumns.length === 0],
                ] as const
              ).map(([mode, label, disabled]) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={colorMode === mode}
                  className={colorMode === mode ? "is-active" : ""}
                  disabled={disabled}
                  onClick={() =>
                    set({
                      color:
                        mode === "category"
                          ? { mode }
                          : mode === "single"
                            ? { mode, value: SWATCHES[0]! }
                            : { mode, column: numericColumns[0]!.name, palette: "densidade" },
                    })
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            {style.color.mode === "single" && (
              <div className="style-swatches">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={style.color.mode === "single" && style.color.value === c ? "is-on" : ""}
                    style={{ background: c }}
                    aria-label={`Cor ${c}`}
                    onClick={() => set({ color: { mode: "single", value: c } })}
                  />
                ))}
                <label className="style-color-pick" title="Outra cor">
                  <input type="color" value={style.color.value} onChange={(e) => set({ color: { mode: "single", value: e.target.value } })} aria-label="Escolher outra cor" />
                </label>
              </div>
            )}
            {style.color.mode === "value" && (
              <>
                <label className="style-row">
                  Coluna
                  <select value={style.color.column} onChange={(e) => style.color.mode === "value" && set({ color: { ...style.color, column: e.target.value } })}>
                    {numericColumns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="style-palettes" role="radiogroup" aria-label="Paleta">
                  {(Object.keys(PALETTES) as PaletteName[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={style.color.mode === "value" && style.color.palette === p}
                      className={style.color.mode === "value" && style.color.palette === p ? "is-on" : ""}
                      onClick={() => style.color.mode === "value" && set({ color: { ...style.color, palette: p } })}
                    >
                      <span style={{ background: `linear-gradient(90deg, ${PALETTES[p].join(", ")})` }} />
                      {PALETTE_LABELS[p]}
                    </button>
                  ))}
                </div>
              </>
            )}
            {style.shape === "heatmap" && style.color.mode !== "value" && <p className="style-hint">A mancha usa a escala de densidade.</p>}
          </section>
        )}

        <section>
          <h4>
            Transparência <span className="num">{Math.round((1 - style.opacity) * 100)}%</span>
          </h4>
          <input type="range" min={0} max={95} value={Math.round((1 - style.opacity) * 100)} onChange={(e) => set({ opacity: 1 - Number(e.target.value) / 100 })} aria-label="Transparência" />
          <div className="style-toggles">
            {style.shape !== "heatmap" && style.shape !== "hex" && style.shape !== "regions" && (
              <label className="toggle">
                <input type="checkbox" checked={style.stroke} onChange={(e) => set({ stroke: e.target.checked })} />
                Contorno
              </label>
            )}
            <label className="toggle">
              <input type="checkbox" checked={style.labels} onChange={(e) => set({ labels: e.target.checked })} />
              Nomes ao aproximar
            </label>
          </div>
        </section>

        {note && <p className="style-note">{note}</p>}
      </div>

      <footer className="style-editor-foot">
        <div className="style-file">
          <button type="button" className="link" onClick={download}>
            Baixar estilo
          </button>
          <button type="button" className="link" onClick={() => fileRef.current?.click()}>
            Usar estilo de arquivo
          </button>
          <button type="button" className="link" onClick={() => onChange(DEFAULT_DATA_STYLE)}>
            Padrão
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void load(f);
            }}
          />
        </div>
        <div className="style-actions">
          <button type="button" className="btn" onClick={onDiscard}>
            Descartar
          </button>
          <button type="button" className="btn btn-primary" onClick={onSave}>
            Salvar
          </button>
        </div>
      </footer>
    </aside>
  );
}
