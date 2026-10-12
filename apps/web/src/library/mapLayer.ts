import type { DatapackManifest } from "@cityview/engine";
import { dataUrl } from "../catalog";
import type { SavedLibraryLayer } from "../storage/datasets";
import { MAP_LEVELS, type LibraryItem, type MapData, type MapLevel, type MapVariable } from "./types";

/** Camada do mapa criada a partir de um item da biblioteca. */
export interface LibraryLayer {
  manifest: DatapackManifest;
  data: { type: "FeatureCollection"; features: unknown[] };
  item: { sourceName: string; title: string; url: string | null };
  variable: string;
  unit: string;
  period: string;
  level: MapLevel;
  matched: number;
  missing: number;
  /** Quebras e cores da legenda. */
  breaks: number[];
  colors: string[];
  /** O que vai para o armazenamento do navegador. */
  saved: SavedLibraryLayer;
}

const COLORS = ["#f1eef6", "#d0d1e6", "#a6bddb", "#74a9cf", "#3690c0", "#0570b0", "#034e7b"];

type MeshFeature = { type: "Feature"; id?: number; geometry: unknown; properties: Record<string, string | number> };
const meshes = new Map<MapLevel, Promise<MeshFeature[]>>();

/** Malhas do catálogo (geradas por datapacks/build.py). */
function loadMesh(level: MapLevel): Promise<MeshFeature[]> {
  let mesh = meshes.get(level);
  if (!mesh) {
    mesh = fetch(dataUrl(MAP_LEVELS[level].datapack))
      .then((r) => {
        if (!r.ok) throw new Error(`malha de ${MAP_LEVELS[level].name.toLowerCase()} não encontrada: rode \`pnpm datapacks\``);
        return r.json() as Promise<{ features: MeshFeature[] }>;
      })
      .then((fc) => fc.features);
    mesh.catch(() => meshes.delete(level));
    meshes.set(level, mesh);
  }
  return mesh;
}

/** Valor "redondo" para a legenda (2 algarismos significativos). */
function nice(v: number): number {
  if (v === 0) return 0;
  const p = 10 ** (Math.floor(Math.log10(Math.abs(v))) - 1);
  return Math.round(v / p) * p;
}

/** Quebras por quantis (cada cor com ~o mesmo número de municípios). */
function quantileBreaks(values: number[], classes: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const breaks = Array.from({ length: classes - 1 }, (_, i) => nice(sorted[Math.floor(((i + 1) * sorted.length) / classes)]!));
  return [...new Set(breaks)].sort((a, b) => a - b);
}

export async function buildMapLayer(item: LibraryItem, data: MapData, variable: MapVariable): Promise<LibraryLayer> {
  const features = await loadMesh(data.level);
  const joined: MeshFeature[] = [];
  for (const f of features) {
    const value = variable.values.get(String(f.properties.codigo));
    if (value === undefined) continue;
    joined.push({ ...f, properties: { nome: f.properties.nome!, uf: f.properties.uf!, codigo: f.properties.codigo!, valor: value } });
  }
  if (joined.length === 0) throw new Error("nenhum território da tabela bateu com a malha do IBGE");

  const breaks = quantileBreaks(
    joined.map((f) => Number(f.properties.valor)),
    COLORS.length,
  );
  const colors = COLORS.slice(0, breaks.length + 1);
  const label = variable.name === data.title ? data.title : `${variable.name}`;
  const manifest: DatapackManifest = {
    id: `lib-${item.source.id}-${item.id}-${variable.id}-${data.period}${data.level === "uf" ? "-uf" : ""}`.replace(/[^\w-]/g, "_"),
    name: `${label} · ${data.period}${data.level === "uf" ? " · por estado" : ""}`,
    description: `${data.title} · ${data.period}`,
    category: "Biblioteca",
    geometry: "polygon",
    source: { name: `${item.source.name} — ${item.title}`, url: item.url ?? item.source.homepage },
    license: { name: item.source.license, url: item.source.homepage, commercial: true },
    attribution: `${item.source.publisher}`,
    refresh: `Período: ${data.period}`,
    render: { type: "choropleth", property: "valor", breaks, colors, opacity: 0.75 },
    fields: [
      { key: "nome", label: data.level === "uf" ? "Estado" : "Município" },
      { key: "uf", label: "UF" },
      { key: "valor", label: `${variable.name} (${data.period})`, format: "decimal", ...(variable.unit ? { unit: variable.unit } : {}) },
    ],
  };
  return {
    saved: {
      id: manifest.id,
      savedAt: Date.now(),
      source: item.source,
      item: { id: item.id, title: item.title, url: item.url, group: item.group, subject: item.subject },
      title: data.title,
      period: data.period,
      level: data.level,
      variable: { id: variable.id, name: variable.name, unit: variable.unit },
      values: [...variable.values],
    },
    manifest,
    data: { type: "FeatureCollection", features: joined },
    item: { sourceName: item.source.name, title: item.title, url: item.url },
    variable: variable.name,
    unit: variable.unit,
    period: data.period,
    level: data.level,
    matched: joined.length,
    missing: Math.max(0, variable.values.size - joined.length),
    breaks,
    colors,
  };
}

/** Remonta uma camada salva (valores + malha do recorte). */
export function restoreMapLayer(saved: SavedLibraryLayer): Promise<LibraryLayer> {
  const item: LibraryItem = {
    source: saved.source,
    id: saved.item.id,
    title: saved.item.title,
    group: saved.item.group,
    subject: saved.item.subject,
    yearFrom: null,
    yearTo: null,
    flags: 0,
    url: saved.item.url,
  };
  const variable = { ...saved.variable, values: new Map(saved.values) };
  return buildMapLayer(item, { title: saved.title, period: saved.period, level: saved.level ?? "municipio", variables: [variable] }, variable).then((layer) => ({
    ...layer,
    saved: { ...layer.saved, savedAt: saved.savedAt },
  }));
}
