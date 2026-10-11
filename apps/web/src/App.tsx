import type { AreaSummary, BasemapLook, DatasetMeta, MapPick, Theme } from "@cityview/engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { areaAt, radiusArea, type Area } from "./areas";
import { DATAPACKS, OBJECTIVES, dataUrl, type Objective } from "./catalog";
import { DioramaPanel, type AreaChoice } from "./components/DioramaPanel";
import { Catalog } from "./components/Catalog";
import { PickDetails, type DatasetInfo } from "./components/PickDetails";
import { ServerDatasets } from "./components/ServerDatasets";
import { Sidebar, SidebarSection } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { UserDatasets } from "./components/UserDatasets";
import { DropZone } from "./import/DropZone";
import "./import/import.css";
import { ImportWizard, type ImportedDataset } from "./import/ImportWizard";
import { serverApi, type ImportSpec, type ServerDataset } from "./server/api";
import { useServerDatasets } from "./server/useServerDatasets";
import { loadActiveLayers, saveActiveLayers } from "./storage/datasets";
import { useUserDatasets, type UserDataset } from "./storage/useUserDatasets";
import { useCityMap } from "./useCityMap";

const CLIENT_DATASET = { id: "empresas", name: "Empresas (demonstração)", url: "/data/empresas/tiles.pmtiles" };
const DATASET_KEY = `dataset:${CLIENT_DATASET.id}`;
const EXPLORE = OBJECTIVES.find((o) => o.id === "explorar")!;
// Rótulos do dataset de demonstração (no produto real, vêm do mapeamento de colunas do cliente).
const SECTORS = [
  "Comércio varejista",
  "Comércio atacadista",
  "Alimentação",
  "Serviços profissionais",
  "Construção",
  "Indústria",
  "Saúde",
  "Educação",
  "Transporte e logística",
  "Tecnologia e informação",
];

const isNarrowScreen = () => window.matchMedia("(max-width: 767px)").matches;

interface Diorama {
  datasetId: string;
  lngLat: [number, number];
  area: Area;
  areaChoice: AreaChoice;
  summary: AreaSummary | null;
  columns: boolean;
  exaggeration: number;
  orbiting: boolean;
}
const without = (set: Set<string>, id: string) => {
  const next = new Set(set);
  next.delete(id);
  return next;
};

export function App() {
  const [sidebarOpen, setSidebarOpen] = useState(() => !isNarrowScreen());
  const [theme, setTheme] = useState<Theme>("light");
  const [look, setLook] = useState<BasemapLook>("data");
  const [columns3d, setColumns3d] = useState(false);
  const [municipios3d, setMunicipios3d] = useState(false);
  const [diorama, setDiorama] = useState<Diorama | null>(null);
  const [objective, setObjective] = useState<string | null>(null);
  const [active, setActive] = useState<Set<string>>(loadActiveLayers);
  const [demoMeta, setDemoMeta] = useState<DatasetMeta | null>(null);
  const [serverMetas, setServerMetas] = useState<Record<string, DatasetMeta>>({});
  const [pick, setPick] = useState<MapPick | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const user = useUserDatasets();
  const server = useServerDatasets();
  const fileInput = useRef<HTMLInputElement>(null);
  const loadingServer = useRef(new Set<string>());
  /** Datasets enviados nesta sessão: ao ficarem prontos, a câmera vai até eles. */
  const focusWhenReady = useRef(new Set<string>());

  const { containerRef, map } = useCityMap({
    basemapUrl: `${location.origin}/data/brasil.pmtiles`,
    terrain: false,
    look: "data",
    theme,
    camera: { ...EXPLORE.camera, pitch: 0, bearing: 0 },
    hash: true,
  });

  // Dataset de demonstração e clique: uma vez por mapa.
  useEffect(() => {
    if (!map) return;
    map.enableHoverCursor();
    let cancelled = false;
    map
      .addDataset(CLIENT_DATASET.id, `${location.origin}${CLIENT_DATASET.url}`)
      .then((layer) => !cancelled && setDemoMeta(layer.meta))
      .catch(() => setDemoMeta(null));
    const off = map.onMapPick(setPick);
    return () => {
      cancelled = true;
      off();
    };
  }, [map]);

  // Datasets do servidor: carrega os prontos no mapa e tira os removidos.
  useEffect(() => {
    if (!map) return;
    for (const d of server.datasets) {
      if (d.status !== "ready" || map.hasDataset(d.id) || loadingServer.current.has(d.id)) continue;
      loadingServer.current.add(d.id);
      map
        .addDataset(d.id, serverApi.tilesUrl(d.id))
        .then((layer) => {
          setServerMetas((m) => ({ ...m, [d.id]: layer.meta }));
          if (focusWhenReady.current.delete(d.id) && d.report) {
            setActive((prev) => new Set(prev).add(d.id));
            map.fitBounds(d.report.bounds);
          }
        })
        .catch((e: Error) => console.warn("[server] não foi possível carregar", d.id, e))
        .finally(() => loadingServer.current.delete(d.id));
    }
    for (const id of Object.keys(serverMetas)) {
      if (server.datasets.some((d) => d.id === id)) continue;
      map.removeDataset(id);
      setServerMetas(({ [id]: _, ...rest }) => rest);
    }
  }, [map, server.datasets, serverMetas]);

  // Visibilidade de tudo a partir do conjunto de camadas ligadas.
  useEffect(() => {
    if (!map) return;
    for (const d of DATAPACKS) {
      if (active.has(d.id)) map.showCatalogLayer(d, dataUrl(d.id));
      else map.hideCatalogLayer(d.id);
    }
    if (demoMeta) map.setDatasetVisible(CLIENT_DATASET.id, active.has(DATASET_KEY));
    for (const id of Object.keys(serverMetas)) map.setDatasetVisible(id, active.has(id));
    for (const d of user.datasets) {
      if (active.has(d.id)) map.showCatalogLayer(d.manifest, d.dataUrl);
      else map.hideCatalogLayer(d.id);
    }
  }, [map, active, demoMeta, serverMetas, user.datasets]);

  useEffect(() => saveActiveLayers(active), [active]);

  /** O que o painel "Neste ponto" precisa saber de cada dataset vetorial. */
  const datasetInfos = useMemo(() => {
    const infos: Record<string, DatasetInfo> = {};
    if (demoMeta) {
      infos[CLIENT_DATASET.id] = {
        name: CLIENT_DATASET.name,
        categories: demoMeta.categories,
        colorBy: demoMeta.colorBy,
        label: (code) => SECTORS[Number(code)] ?? code,
      };
    }
    for (const d of server.datasets) {
      const meta = serverMetas[d.id];
      if (!meta) continue;
      infos[d.id] = {
        name: d.name,
        categories: meta.categories,
        colorBy: meta.colorBy,
        title: meta.title,
        rowUrl: meta.hasRowIndex ? serverApi.rowUrl(d.id) : undefined,
      };
    }
    return infos;
  }, [demoMeta, server.datasets, serverMetas]);

  const openImport = useCallback((file: File) => setImportFile(file), []);

  const finishImport = (dataset: ImportedDataset) => {
    setImportFile(null);
    void user.add({ id: dataset.manifest.id, ...dataset, createdAt: Date.now() });
    setActive((prev) => new Set(prev).add(dataset.manifest.id));
    setSidebarOpen(true);
    map?.fitBounds(dataset.bounds);
  };

  const sendToServer = async (file: File, spec: ImportSpec) => {
    setImportFile(null);
    setSidebarOpen(true);
    const created = await server.upload(file, spec);
    if (created) focusWhenReady.current.add(created.id);
  };

  const removeUserDataset = (id: string) => {
    const target = user.datasets.find((d) => d.id === id);
    if (!target || !window.confirm(`Remover "${target.manifest.name}"? O dado salvo neste navegador será apagado.`)) return;
    map?.removeCatalogLayer(id);
    void user.remove(id);
    setActive((prev) => without(prev, id));
  };

  const renameUserDataset = (id: string) => {
    const target = user.datasets.find((d) => d.id === id);
    const name = target && window.prompt("Novo nome do dataset:", target.manifest.name)?.trim();
    if (!name || name === target.manifest.name) return;
    // A camada guarda o manifesto; recria com o nome novo (o efeito acima religa).
    map?.removeCatalogLayer(id);
    void user.rename(id, name);
  };

  const removeServerDataset = (id: string) => {
    const target = server.datasets.find((d) => d.id === id);
    if (!target || !window.confirm(`Remover "${target.name}"? O arquivo e o mapa gerados no servidor serão apagados.`)) return;
    void server.remove(id);
    setActive((prev) => without(prev, id));
  };

  const renameServerDataset = (id: string) => {
    const target = server.datasets.find((d) => d.id === id);
    const name = target && window.prompt("Novo nome do dataset:", target.name)?.trim();
    if (name && name !== target.name) void server.rename(id, name);
  };

  const focusUserDataset = (d: UserDataset) => {
    setActive((prev) => new Set(prev).add(d.id));
    map?.fitBounds(d.bounds);
  };

  const focusServerDataset = (d: ServerDataset) => {
    setActive((prev) => new Set(prev).add(d.id));
    if (d.report) map?.fitBounds(d.report.bounds);
  };

  const toggle = (id: string, on: boolean) => {
    setObjective(null);
    setActive((prev) => (on ? new Set(prev).add(id) : without(prev, id)));
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

  const changeLook = (next: BasemapLook) => {
    setLook(next);
    map?.setLook(next);
  };

  const toggleColumns = (on: boolean) => {
    setColumns3d(on);
    map?.setDatasetsExtruded(on);
  };

  const toggleDioramaColumns = (on: boolean) => {
    map?.setDioramaColumns(on);
    setDiorama((d) => (d ? { ...d, columns: on } : d));
  };

  const toggleMunicipios3d = (on: boolean) => {
    setMunicipios3d(on);
    if (on) setActive((prev) => new Set(prev).add("municipios-populacao"));
    map?.setCatalogExtruded("municipios-populacao", on);
  };

  // ---------- Visualização avançada (maquete) ----------

  const openDiorama = async (datasetId: string, lngLat: [number, number], area: Area, areaChoice: AreaChoice) => {
    if (!map) return;
    const exaggeration = diorama?.exaggeration ?? 1.8;
    setDiorama({ datasetId, lngLat, area, areaChoice, summary: null, columns: diorama?.columns ?? false, exaggeration, orbiting: false });
    setActive((prev) => new Set(prev).add(datasetId === CLIENT_DATASET.id ? DATASET_KEY : datasetId));
    if (isNarrowScreen()) setSidebarOpen(false);
    await map.enterDiorama(area.geometry, {
      datasetId,
      exaggeration,
      columns: diorama?.columns ?? false,
      // Na tela larga, o painel ocupa a esquerda do mapa.
      padding: isNarrowScreen() ? 40 : { top: 50, bottom: 50, left: 360, right: 50 },
      onSummary: (summary) => setDiorama((d) => (d && d.area === area ? { ...d, summary } : d)),
    });
    map.startOrbit(4);
    setDiorama((d) => (d && d.area === area ? { ...d, orbiting: true } : d));
  };

  const startAdvanced = async (p: MapPick) => {
    if (!p.dataset) return;
    const area = await areaAt(p.lngLat);
    void openDiorama(p.dataset.datasetId, p.lngLat, area, area.kind === "municipio" ? "municipio" : 10);
  };

  const changeDioramaArea = async (choice: AreaChoice) => {
    if (!diorama) return;
    const area = choice === "municipio" ? await areaAt(diorama.lngLat) : radiusArea(diorama.lngLat, choice);
    void openDiorama(diorama.datasetId, diorama.lngLat, area, choice);
  };

  const exitDiorama = () => {
    map?.exitDiorama();
    setDiorama(null);
  };

  const setOrbit = (on: boolean) => {
    if (on) map?.startOrbit(4);
    else map?.stopOrbit();
    setDiorama((d) => (d ? { ...d, orbiting: on } : d));
  };

  const setExaggeration = (value: number) => {
    map?.setTerrainExaggeration(value);
    setDiorama((d) => (d ? { ...d, exaggeration: value } : d));
  };

  // TODO(fase 2b): geocodificação local (Photon). Por enquanto a busca não faz nada.
  const search = (query: string) => console.info("[search]", query);

  const errors = [user.error && { text: user.error, clear: user.clearError }, server.error && { text: server.error, clear: server.clearError }].filter(
    (e): e is { text: string; clear: () => void } => Boolean(e),
  );

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
              disabled={!demoMeta}
              onChange={(e) => toggle(DATASET_KEY, e.target.checked)}
            />
            <span>{CLIENT_DATASET.name}</span>
          </label>
          <p className="catalog-meta">
            {demoMeta ? `${new Intl.NumberFormat("pt-BR").format(demoMeta.records)} registros` : "Gere com pnpm synth && pnpm tiles"}
          </p>
          <ServerDatasets
            datasets={server.datasets}
            uploads={server.uploads}
            active={active}
            onToggle={toggle}
            onRename={renameServerDataset}
            onRemove={removeServerDataset}
            onFocus={focusServerDataset}
          />
          <UserDatasets
            datasets={user.datasets}
            active={active}
            usage={user.usage}
            onToggle={toggle}
            onRename={renameUserDataset}
            onRemove={removeUserDataset}
            onFocus={focusUserDataset}
          />
          {errors.map((e) => (
            <p key={e.text} className="warn user-error">
              {e.text}{" "}
              <button type="button" className="link" onClick={e.clear}>
                ok
              </button>
            </p>
          ))}
          <button type="button" className="btn btn-block" onClick={() => fileInput.current?.click()}>
            Importar arquivo…
          </button>
          <p className="hint">ou arraste um CSV para o mapa</p>
          <p className={`server-status ${server.available ? "is-on" : ""}`}>
            <i />
            {server.available
              ? "Servidor local conectado: arquivos de qualquer tamanho"
              : "Servidor local desligado: arquivos até 2 milhões de linhas (pnpm api para ligar)"}
          </p>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.tsv,.txt"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) openImport(file);
              e.target.value = "";
            }}
          />
        </SidebarSection>

        <SidebarSection title="Catálogo de dados">
          <Catalog datapacks={DATAPACKS} active={active} onToggle={toggle} />
        </SidebarSection>

        <SidebarSection title="Neste ponto">
          <PickDetails pick={pick} datasets={datasetInfos} onAdvanced={(p) => void startAdvanced(p)} />
        </SidebarSection>

        <SidebarSection title="Visualização">
          <label className="toggle">
            <input type="checkbox" checked={columns3d} onChange={(e) => toggleColumns(e.target.checked)} />
            Seus dados em colunas 3D
          </label>
          <label className="toggle">
            <input type="checkbox" checked={municipios3d} onChange={(e) => toggleMunicipios3d(e.target.checked)} />
            Municípios em 3D (densidade)
          </label>
          <p className="hint left">Dica: clique nos seus dados e use “Visualização avançada” para ver a área em maquete 3D.</p>
        </SidebarSection>

        <SidebarSection title="Aparência">
          <div className="segmented" role="radiogroup" aria-label="Mapa base">
            {(["data", "classic"] as const).map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={look === l}
                className={look === l ? "is-active" : ""}
                onClick={() => changeLook(l)}
              >
                {l === "data" ? "Para dados" : "Clássico"}
              </button>
            ))}
          </div>
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
        <DropZone onFile={openImport} />
        {diorama && (
          <DioramaPanel
            area={diorama.area}
            areaChoice={diorama.areaChoice}
            dataset={datasetInfos[diorama.datasetId]}
            summary={diorama.summary}
            columns={diorama.columns}
            exaggeration={diorama.exaggeration}
            orbiting={diorama.orbiting}
            onAreaChoice={(c) => void changeDioramaArea(c)}
            onColumns={toggleDioramaColumns}
            onExaggeration={setExaggeration}
            onOrbit={setOrbit}
            onExit={exitDiorama}
          />
        )}
      </main>

      {importFile && (
        <ImportWizard
          file={importFile}
          serverAvailable={server.available}
          onCancel={() => setImportFile(null)}
          onImport={finishImport}
          onSendToServer={(file, spec) => void sendToServer(file, spec)}
        />
      )}
    </div>
  );
}
