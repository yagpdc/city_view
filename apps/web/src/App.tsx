import type { MapPick, Theme } from "@cityview/engine";
import { useEffect, useState } from "react";
import { DATAPACKS, OBJECTIVES, dataUrl, type Objective } from "./catalog";
import { Catalog } from "./components/Catalog";
import { PickDetails } from "./components/PickDetails";
import { Sidebar, SidebarSection } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { useCityMap } from "./useCityMap";

const CLIENT_DATASET = { id: "empresas", name: "Empresas (demonstração)", url: "/data/empresas.pmtiles" };
const DATASET_KEY = `dataset:${CLIENT_DATASET.id}`;
const EXPLORE = OBJECTIVES.find((o) => o.id === "explorar")!;

const isNarrowScreen = () => window.matchMedia("(max-width: 767px)").matches;

export function App() {
  const [sidebarOpen, setSidebarOpen] = useState(() => !isNarrowScreen());
  const [theme, setTheme] = useState<Theme>("light");
  const [objective, setObjective] = useState<string | null>(null);
  const [active, setActive] = useState<Set<string>>(new Set());
  const [datasetReady, setDatasetReady] = useState(false);
  const [datasetRecords, setDatasetRecords] = useState<number | null>(null);
  const [pick, setPick] = useState<MapPick | null>(null);

  const { containerRef, map } = useCityMap({
    basemapUrl: `${location.origin}/data/brasil.pmtiles`,
    terrainUrl: `${location.origin}/data/sao-paulo-terrain.pmtiles`,
    terrain: false,
    theme,
    camera: { ...EXPLORE.camera, pitch: 0, bearing: 0 },
    hash: true,
  });

  // Dados do cliente: carregados uma vez, visibilidade controlada pelo conjunto ativo.
  useEffect(() => {
    if (!map) return;
    map.enableHoverCursor();
    let cancelled = false;
    map
      .addDataset(CLIENT_DATASET.id, `${location.origin}${CLIENT_DATASET.url}`)
      .then((layer) => {
        if (cancelled) return;
        setDatasetRecords(layer.meta.records);
        setDatasetReady(true);
      })
      .catch(() => setDatasetReady(false));
    const off = map.onMapPick(setPick);
    return () => {
      cancelled = true;
      off();
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    for (const d of DATAPACKS) {
      if (active.has(d.id)) map.showCatalogLayer(d, dataUrl(d.id));
      else map.hideCatalogLayer(d.id);
    }
    if (datasetReady) map.setDatasetVisible(CLIENT_DATASET.id, active.has(DATASET_KEY));
  }, [map, active, datasetReady]);

  const toggle = (id: string, on: boolean) => {
    setObjective(null);
    setActive((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const chooseObjective = (o: Objective) => {
    setObjective(o.id);
    setActive(new Set(o.layers));
    map?.flyTo({ center: o.camera.center, zoom: o.camera.zoom, pitch: 0, bearing: 0 });
  };

  const changeTheme = (next: Theme) => {
    setTheme(next);
    map?.setTheme(next);
  };

  // TODO(fase 2b): geocodificação local (Photon). Por enquanto a busca não faz nada.
  const search = (query: string) => console.info("[search]", query);

  return (
    <div className={`app theme-${theme} ${sidebarOpen ? "sidebar-open" : ""}`}>
      <TopBar sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((o) => !o)} onSearch={search} />

      <Sidebar open={sidebarOpen}>
        <SidebarSection title="Ponto de partida">
          <div className="objectives">
            {OBJECTIVES.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`objective ${objective === o.id ? "is-active" : ""}`}
                onClick={() => chooseObjective(o)}
                title={o.description}
              >
                <strong>{o.name}</strong>
                <span>{o.description}</span>
              </button>
            ))}
          </div>
        </SidebarSection>

        <SidebarSection title="Seus dados">
          <label className="toggle">
            <input
              type="checkbox"
              checked={active.has(DATASET_KEY)}
              disabled={!datasetReady}
              onChange={(e) => toggle(DATASET_KEY, e.target.checked)}
            />
            <span>{CLIENT_DATASET.name}</span>
          </label>
          <p className="catalog-meta">
            {datasetRecords !== null
              ? `${new Intl.NumberFormat("pt-BR").format(datasetRecords)} registros`
              : datasetReady
                ? ""
                : "Gere com pnpm synth && pnpm tiles"}
          </p>
        </SidebarSection>

        <SidebarSection title="Catálogo de dados">
          <Catalog datapacks={DATAPACKS} active={active} onToggle={toggle} />
        </SidebarSection>

        <SidebarSection title="Neste ponto">
          <PickDetails pick={pick} />
        </SidebarSection>

        <SidebarSection title="Aparência">
          <div className="segmented" role="radiogroup" aria-label="Tema">
            {(["light", "dark"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={theme === t}
                className={theme === t ? "is-active" : ""}
                onClick={() => changeTheme(t)}
              >
                {t === "light" ? "Claro" : "Escuro"}
              </button>
            ))}
          </div>
        </SidebarSection>
      </Sidebar>

      <main className="map-area">
        <div ref={containerRef} className="map" />
      </main>
    </div>
  );
}
