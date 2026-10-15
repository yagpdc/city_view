import { categoryColor, formatArea, formatDistance, lineLengthM, polygonMeasure, type AreaSummary, type CityMap } from "@cityview/engine";
import { useEffect, useState } from "react";
import { AGENTS, AgentFace } from "../components/Agents";
import { Icon } from "../components/Icon";
import type { DatasetInfo } from "../components/PickDetails";
import { ANNOTATION_COLORS, agentOf, isArea, kindLabel, type AnnotationFeature } from "./model";

const int = new Intl.NumberFormat("pt-BR");
const dec = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, notation: "compact" });
const perKm2 = (v: number) => (v >= 1000 ? compact.format(v) : dec.format(v));

/** Camada de pontos ligada, para contar o que cai dentro de uma área. */
export interface CountLayer {
  id: string;
  name: string;
  info: DatasetInfo;
}

/**
 * Cartão da anotação escolhida: texto/título/nota, cor e apagar. Área mostra tamanho e o que tem dentro (cada
 * camada de pontos ligada); linha mostra o comprimento. Tudo geodésico.
 */
export function AnnotationCard({
  map,
  feature,
  layers,
  onUpdate,
  onDelete,
  onClose,
}: {
  map: CityMap;
  feature: AnnotationFeature;
  layers: CountLayer[];
  onUpdate: (props: Record<string, string | undefined>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const p = feature.properties;
  const agent = agentOf(feature);
  const ring = feature.geometry.type === "Polygon" ? (feature.geometry.coordinates[0] as [number, number][]) : null;
  const measure = ring ? polygonMeasure(ring.slice(0, -1)) : null;
  const length = feature.geometry.type === "LineString" ? lineLengthM(feature.geometry.coordinates as [number, number][]) : null;

  // Contagem por camada dentro da área (refaz quando a forma muda).
  const geomKey = JSON.stringify(feature.geometry);
  const layerKey = layers.map((l) => l.id).join("|");
  const [counts, setCounts] = useState<Record<string, AreaSummary | null | "loading">>({});
  useEffect(() => {
    if (!isArea(feature)) return;
    let live = true;
    setCounts(Object.fromEntries(layers.map((l) => [l.id, "loading" as const])));
    const area = { type: "Polygon" as const, coordinates: (feature.geometry as GeoJSON.Polygon).coordinates as [number, number][][] };
    for (const l of layers) {
      map
        .areaSummary(l.id, area)
        .then((s) => live && setCounts((c) => ({ ...c, [l.id]: s })))
        .catch(() => live && setCounts((c) => ({ ...c, [l.id]: null })));
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, geomKey, layerKey]);

  const km2 = measure ? measure.areaM2 / 1e6 : 0;
  return (
    <section className="annot-card" aria-label={`${kindLabel(feature)} selecionado`}>
      <header className="annot-card-head">
        <AgentFace kind={agent} mood="happy" size={36} />
        <span className="annot-card-title">
          <b>{kindLabel(feature)}</b>
          <span className="muted">com {AGENTS[agent].name}</span>
        </span>
        <button type="button" className="icon-button sm" onClick={onDelete} aria-label="Apagar anotação" title="Apagar">
          <Icon name="trash" size={18} />
        </button>
        <button type="button" className="icon-button sm" onClick={onClose} aria-label="Fechar" title="Fechar">
          <Icon name="close" size={18} />
        </button>
      </header>

      {p.kind === "text" ? (
        <label className="widget-field">
          <span>Texto</span>
          <input autoFocus value={p.label ?? ""} onChange={(e) => onUpdate({ label: e.target.value })} placeholder="Escreva o texto…" maxLength={120} />
        </label>
      ) : (
        <label className="widget-field">
          <span>{p.kind === "pin" ? "Título" : "Rótulo no mapa"}</span>
          <input autoFocus={p.kind === "pin"} value={p.label ?? ""} onChange={(e) => onUpdate({ label: e.target.value })} placeholder={p.kind === "pin" ? "Ex.: visitar na segunda" : "Ex.: zona de expansão"} maxLength={80} />
        </label>
      )}
      {p.kind === "pin" && (
        <label className="widget-field">
          <span>Nota</span>
          <textarea value={p.note ?? ""} onChange={(e) => onUpdate({ note: e.target.value })} placeholder="O que lembrar deste lugar…" rows={3} maxLength={1000} />
        </label>
      )}

      <span className="annot-colors" role="radiogroup" aria-label="Cor">
        {ANNOTATION_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={p.color === c.hex}
            aria-label={c.label}
            title={c.label}
            className={`annot-color ${p.color === c.hex ? "is-on" : ""}`}
            style={{ background: c.hex }}
            onClick={() => onUpdate({ color: c.hex })}
          />
        ))}
      </span>

      {measure && (
        <>
          <dl className="widget-stats">
            <div>
              <dt>Área</dt>
              <dd className="num">{formatArea(measure.areaM2)}</dd>
            </div>
            <div>
              <dt>Perímetro</dt>
              <dd className="num">{formatDistance(measure.perimeterM)}</dd>
            </div>
          </dl>
          <section className="annot-inside">
            <h5>Dentro desta área</h5>
            {layers.length === 0 && <p className="muted">Ligue uma camada de pontos (seus dados ou Estabelecimentos) para contar o que tem aqui.</p>}
            <ul>
              {layers.map((l) => {
                const s = counts[l.id];
                const top =
                  s && s !== "loading"
                    ? l.info.categories
                        .map((c, i) => ({ label: l.info.label ? l.info.label(c) : c, n: s.byCategory[i] ?? 0, color: categoryColor(i, l.info.categories) }))
                        .filter((x) => x.n > 0)
                        .sort((a, b) => b.n - a.n)
                        .slice(0, 3)
                    : [];
                return (
                  <li key={l.id}>
                    <span className="annot-inside-row">
                      <span>{l.name}</span>
                      <b className="num">{s === "loading" || s === undefined ? "…" : s === null ? "–" : int.format(s.count)}</b>
                    </span>
                    {s && s !== "loading" && s.count > 0 && (
                      <span className="annot-inside-sub">
                        {km2 > 0 && <span>{perKm2(s.count / km2)} por km²</span>}
                        {top.map((t) => (
                          <span key={t.label}>
                            <i style={{ background: t.color }} />
                            {t.label} <b className="num">{int.format(t.n)}</b>
                          </span>
                        ))}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
      {length !== null && (
        <dl className="widget-stats">
          <div>
            <dt>Comprimento</dt>
            <dd className="num">{formatDistance(length)}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
