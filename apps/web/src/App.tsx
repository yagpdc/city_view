import { data } from "./dataUrl";
import type { BasemapLook, BuildingPaintResult, Camera, DatasetMeta, MapPick, Theme } from "@cityview/engine";
import { CATEGORY_COLORS, categoryColor, geodesicDistanceM, normalizeText } from "@cityview/engine";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { areaAt, parseCoordinates, searchMunicipios } from "./areas";
import type { Comparison, PlaceFacts } from "./compare";
import { SearchBox, type SearchResult } from "./components/SearchBox";
import { CategoryLegend, LayerCard, Panel, PanelCard, Rail, ScaleLegend, type LayerAction, type PanelId } from "./components/Shell";
import { WidgetsPanel, type ViewportWidget } from "./components/WidgetsPanel";
import { ValueFilter, type FilterColumn } from "./components/ValueFilter";
import { placeIcon, placeIconSvgs } from "./placeIcons";
import { Icon } from "./components/Icon";
import { AddRow, DatapackMeta } from "./components/AddRow";
import { MeasurePanel } from "./components/MeasurePanel";
import type { DataStyle, DatasetFilter, MeasureMode, MeasureState, Where } from "@cityview/engine";
import { DEFAULT_DATA_STYLE, normalizeDataStyle } from "@cityview/engine";
import { DATAPACKS, dataUrl } from "./catalog";
import { PickDetails, type DatasetInfo } from "./components/PickDetails";
import { MapPopup, type NearbySource } from "./components/MapPopup";
import { createPortal } from "react-dom";
import { LibraryPanel } from "./library/LibraryPanel";
import { LIBRARY_SOURCES, LIBRARY_TOTAL } from "./library/load";
import { layerFromRecipe, recipeOf, restoreMapLayer, type LibraryLayer } from "./library/mapLayer";
import { CAMERA_PARAM, clearShared, readShared, shareUrl } from "./share";
import { StreetViewer } from "./components/StreetViewer";
import { coverageOverlay, nearestStreetImage, streetImageryEnabled } from "./streetImagery";
import { TopBar } from "./components/TopBar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { StyleEditor } from "./components/StyleEditor";
import { MapLegend, type LegendLayer } from "./components/MapLegend";
import { MapTabs } from "./components/MapTabs";
import { createTab, loadTabs, saveTabs, type MapTab } from "./mapTabs";
import { DropZone } from "./import/DropZone";
import "./import/import.css";
import { ImportWizard, type ImportRestore, type ImportedDataset } from "./import/ImportWizard";
import { ACCEPTED_EXTENSIONS } from "./import/protocol";
import { serverApi, type ImportSpec, type ServerDataset } from "./server/api";
import { useServerDatasets } from "./server/useServerDatasets";
import { deleteLibraryLayer, listLibraryLayers, loadActiveLayers, saveLibraryLayer } from "./storage/datasets";
import { useUserDatasets, type UserDataset } from "./storage/useUserDatasets";
import { useCityMap } from "./useCityMap";

const CLIENT_DATASET = { id: "empresas", name: "Exemplo: 30 milhões de registros", url: data("empresas/tiles.pmtiles") };
const DATASET_KEY = `dataset:${CLIENT_DATASET.id}`;
/** Lugares do Overture Maps gerados por `pnpm places` (Brasil inteiro ou só a Grande SP). */
const PLACES = { id: "lugares", name: "Estabelecimentos (Overture Maps)", areas: ["brasil", "sao-paulo"] };
const PLACES_KEY = `dataset:${PLACES.id}`;
/** Camada de cobertura das fotos de rua (Mapillary). */
const STREET_KEY = "overlay:mapillary";
const PLACES_ATTRIBUTION = '<a href="https://docs.overturemaps.org/attribution/">Estabelecimentos: Overture Maps Foundation</a>';
/** Chave de visibilidade de um dataset vetorial (o exemplo e os lugares usam o prefixo "dataset:"). */
const datasetKey = (id: string) => (id === CLIENT_DATASET.id ? DATASET_KEY : id === PLACES.id ? PLACES_KEY : id);
/** Câmera inicial: o Brasil inteiro. */
const START_CAMERA = { center: [-52, -14.5] as [number, number], zoom: 3.8 };
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

/** Estado de um link compartilhado, lido uma vez ao abrir. */
const SHARED = readShared();

/**
 * Coropléticos (municípios, UFs, camadas da biblioteca) pintam o mapa inteiro: nunca abrem ligados.
 * Ficam no projeto com o olho fechado; só um link compartilhado os mostra direto.
 */
const isChoropleth = (id: string) => id.startsWith("lib-") || DATAPACKS.some((d) => d.id === id && d.geometry === "polygon");
/** Abrem ligadas por padrão: fotos de rua e estabelecimentos (Lugares). */
const RESTORED = loadActiveLayers([PLACES_KEY, STREET_KEY]);

/** Maquete 3D (three.js) só é baixada quando abre. */
const MaqueteView = lazy(() => import("./components/MaqueteView").then((m) => ({ default: m.MaqueteView })));

const isNarrowScreen = () => window.matchMedia("(max-width: 767px)").matches;

const HIDDEN_KEY = "cityview.hidden-layers";
function loadHiddenLayers(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
const FILTERS_KEY = "cityview.category-filters";
/** Filtro por camada (id da camada no mapa → categorias visíveis e condições por coluna). */
type LayerFilters = Record<string, DatasetFilter>;
function loadFilters(): LayerFilters {
  try {
    const raw = JSON.parse(localStorage.getItem(FILTERS_KEY) ?? "{}") as Record<string, DatasetFilter | number[]>;
    // Versão anterior guardava só a lista de categorias.
    return Object.fromEntries(Object.entries(raw).map(([id, f]) => [id, Array.isArray(f) ? { categories: f } : f]));
  } catch {
    return {};
  }
}
/** Câmera de uma aba nova. */
const BLANK_CAMERA: Camera = { ...START_CAMERA, pitch: 0, bearing: 0 };

/**
 * Abas de mapa salvas. A primeira vez monta a aba 1 com o que era guardado antes das abas; um link
 * compartilhado abre numa aba nova, sem mexer nas abas que a pessoa já tinha.
 */
const INITIAL_TABS = (() => {
  const state = loadTabs(() => ({
    active: [...RESTORED].filter((id) => !isChoropleth(id)),
    hidden: [...new Set([...loadHiddenLayers(), ...[...RESTORED].filter(isChoropleth)])],
    filters: loadFilters(),
  }));
  if (!SHARED?.layers) return state;
  const shared = createTab(state.tabs, {
    title: SHARED.n || "Link compartilhado",
    active: SHARED.layers,
    filters: SHARED.f ?? {},
    ...(SHARED.st && { styles: Object.fromEntries(Object.entries(SHARED.st).map(([id, s]) => [id, normalizeDataStyle(s)])) }),
    ...(SHARED.theme && { theme: SHARED.theme }),
    ...(SHARED.look && { look: SHARED.look }),
  });
  return { tabs: [...state.tabs, shared], current: shared.id };
})();
const INITIAL_TAB = INITIAL_TABS.tabs.find((t) => t.id === INITIAL_TABS.current)!;

/** Estilos salvos de uma aba (abas da versão anterior só tinham a lista de "Regiões"). */
function tabStyles(t: MapTab): Record<string, DataStyle> {
  const out: Record<string, DataStyle> = {};
  for (const id of t.regionViews ?? []) out[id] = { ...DEFAULT_DATA_STYLE, shape: "regions" };
  for (const [id, s] of Object.entries(t.styles ?? {})) out[id] = normalizeDataStyle(s);
  return out;
}

/** Id da camada no mapa a partir da chave de camada do projeto. */
const mapIdOf = (key: string) => (key === DATASET_KEY ? CLIENT_DATASET.id : key === PLACES_KEY ? PLACES.id : key);
/** Onde o filtro por valor vale num dataset em tiles. */
const POINTS_ONLY_NOTE = "As condições valem para os pontos: aproxime o mapa. A densidade em hexágonos não muda.";
const int = new Intl.NumberFormat("pt-BR");
const compact = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, notation: "compact" });

const without = (set: Set<string>, id: string) => {
  const next = new Set(set);
  next.delete(id);
  return next;
};

export function App() {
  /** Painel aberto pelo trilho (null = só o mapa). */
  const [panel, setPanel] = useState<PanelId | null>(() => (isNarrowScreen() ? null : "layers"));
  /** Camadas no projeto mas escondidas (o olho fechado); "active" são as visíveis. */
  /** Abas de mapa (cada uma com as próprias camadas, filtros e câmera) e a aberta. */
  const [tabs, setTabs] = useState<MapTab[]>(INITIAL_TABS.tabs);
  const [currentTab, setCurrentTab] = useState(INITIAL_TABS.current);
  /** Última aba fechada, para "Reabrir". */
  const [closedTab, setClosedTab] = useState<{ tab: MapTab; index: number } | null>(null);
  /** Câmera de cada aba (atualizada ao parar de mexer, sem re-renderizar o app). */
  const cameras = useRef(new Map<string, Camera>());
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(INITIAL_TAB.hidden));
  const [filters, setFilters] = useState<LayerFilters>(INITIAL_TAB.filters);
  const initialFilters = useRef(filters);
  const [widgetsOpen, setWidgetsOpen] = useState(() => window.innerWidth >= 1280);
  const [widgets, setWidgets] = useState<ViewportWidget[]>([]);
  const [perspective, setPerspective] = useState<"2d" | "3d">("2d");
  const [measuring, setMeasuring] = useState(false);
  /** Maquete holográfica aberta (cobre o mapa). */
  const [maquete, setMaquete] = useState<{ center: [number, number]; title?: string; datasetIds: string[]; radius: number } | null>(null);
  const [measureMode, setMeasureMode] = useState<MeasureMode>("distance");
  const [measureState, setMeasureState] = useState<MeasureState | null>(null);
  const [theme, setTheme] = useState<Theme>(INITIAL_TAB.theme ?? "light");
  const [look, setLook] = useState<BasemapLook>(INITIAL_TAB.look ?? "data");
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [columns3d, setColumns3d] = useState(false);
  const [municipios3d, setMunicipios3d] = useState(false);
  /** Camada (id no mapa) que acende os prédios; null = desligado. */
  const [paintDataset, setPaintDataset] = useState<string | null>(INITIAL_TAB.paintDataset ?? null);
  /** Estilo salvo de cada camada (editor de estilo); sem estilo = bolinhas por categoria. */
  const [styles, setStyles] = useState<Record<string, DataStyle>>(() => tabStyles(INITIAL_TAB));
  /** Editor de estilo aberto: camada e o rascunho (aparece no mapa na hora, só fica se salvar). */
  const [styleEditing, setStyleEditing] = useState<{ id: string; title: string; draft: DataStyle } | null>(null);
  const appliedStyles = useRef<Record<string, string>>({});
  const paintBuildingsOn = paintDataset !== null;
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryLayers, setLibraryLayers] = useState<LibraryLayer[]>([]);
  const [buildingResult, setBuildingResult] = useState<BuildingPaintResult | null>(null);
  const [active, setActive] = useState<Set<string>>(() => new Set(INITIAL_TAB.active));
  const [demoMeta, setDemoMeta] = useState<DatasetMeta | null>(null);
  const [places, setPlaces] = useState<{ meta: DatasetMeta; release: string; area: string } | null>(null);
  const [serverMetas, setServerMetas] = useState<Record<string, DatasetMeta>>({});
  /** Seus arquivos processados no navegador (PMTiles em memória): id → metadados. */
  const [localMetas, setLocalMetas] = useState<Record<string, DatasetMeta>>({});
  const loadingLocal = useRef(new Set<string>());
  /** Todos os datasets em tiles que são dados do usuário (servidor local ou navegador). */
  const tileMetas = useMemo(() => ({ ...serverMetas, ...localMetas }), [serverMetas, localMetas]);
  const [pick, setPick] = useState<MapPick | null>(null);
  /** Assistente aberto: arquivo e, ao reabrir uma camada, o que restaurar. */
  const [importJob, setImportJob] = useState<{ file: File; restore?: ImportRestore } | null>(null);
  /** "Atualizar com nova planilha" / "Editar dados" sem o arquivo guardado: camada esperando o arquivo escolhido. */
  const pendingReopen = useRef<{ dataset: UserDataset; mode: ImportRestore["mode"] } | null>(null);
  const reopenInput = useRef<HTMLInputElement>(null);
  const [streetImageId, setStreetImageId] = useState<string | null>(null);
  /** Elemento do cartão sobre o mapa (o conteúdo vem por portal React). */
  const popupEl = useMemo(() => document.createElement("div"), []);
  const user = useUserDatasets();
  const server = useServerDatasets();
  const fileInput = useRef<HTMLInputElement>(null);
  const loadingServer = useRef(new Set<string>());
  /** Datasets enviados nesta sessão: ao ficarem prontos, a câmera vai até eles. */
  const focusWhenReady = useRef(new Set<string>());

  const { containerRef, map } = useCityMap({
    basemapUrl: data("brasil.pmtiles"),
    // Locais com `pnpm assets`; sem eles o servidor de dev redireciona para o Protomaps.
    assetsUrl: data("assets"),
    terrain: false,
    look,
    // Prédios 3D vêm do extrato detalhado das principais cidades (`pnpm cidades`); o mapa do Brasil vai só até z12.
    buildingsUrl: data("cidades.pmtiles"),
    // Vista "Regiões": estados afastado, municípios ao aproximar (malhas do IBGE do catálogo).
    regionLevels: [
      { id: "uf", url: dataUrl("estados-populacao"), minzoom: 0, maxzoom: 5.5 },
      { id: "mun", url: dataUrl("municipios-populacao"), minzoom: 5.5, maxzoom: 12 },
    ],
    theme,
    camera: INITIAL_TAB.camera ?? BLANK_CAMERA,
    hash: CAMERA_PARAM,
  });
  // Só no desenvolvimento: o mapa no console (window.__cityMap) para depurar camadas e dados.
  useEffect(() => {
    if (import.meta.env.DEV && map) (window as unknown as { __cityMap?: unknown }).__cityMap = map;
  }, [map]);

  // Dataset de demonstração e clique: uma vez por mapa.
  useEffect(() => {
    if (!map) return;
    map.enableHoverCursor();
    let cancelled = false;
    map
      .addDataset(CLIENT_DATASET.id, `${location.origin}${CLIENT_DATASET.url}`)
      .then((layer) => !cancelled && setDemoMeta(layer.meta))
      .catch(() => setDemoMeta(null));
    // Lugares: o recorte mais amplo que tiver sido gerado.
    void (async () => {
      for (const area of PLACES.areas) {
        // Arquivo ausente: o Vite responde a página HTML com 200, então confere o tipo.
        const info = (await fetch(data(`places/${area}.release.json`))
          .then((r) => (r.ok && r.headers.get("content-type")?.includes("json") ? r.json() : null))
          .catch(() => null)) as { release: string } | null;
        if (!info) continue;
        const layer = await map.addDataset(PLACES.id, data(`places/${area}/tiles.pmtiles`), {
          attribution: PLACES_ATTRIBUTION,
        });
        if (!cancelled) setPlaces({ meta: layer.meta, release: info.release, area });
        return;
      }
    })().catch((e: Error) => console.warn("[places]", e.message));
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
    if (places) map.setDatasetVisible(PLACES.id, active.has(PLACES_KEY));
    if (streetImageryEnabled && active.has(STREET_KEY)) map.setOverlay(coverageOverlay());
    else map.removeOverlay("mapillary");
    for (const id of Object.keys(serverMetas)) map.setDatasetVisible(id, active.has(id));
    for (const d of user.datasets) {
      if (d.format === "pmtiles") {
        if (localMetas[d.id]) map.setDatasetVisible(d.id, active.has(d.id));
      } else if (active.has(d.id)) map.showCatalogLayer(d.manifest, d.dataUrl);
      else map.hideCatalogLayer(d.id);
    }
    for (const l of libraryLayers) {
      if (active.has(l.manifest.id)) map.showCatalogLayer(l.manifest, l.data as never);
      else map.hideCatalogLayer(l.manifest.id);
    }
  }, [map, active, demoMeta, places, serverMetas, localMetas, user.datasets, libraryLayers]);

  // Arquivos processados no navegador: abre o PMTiles guardado como um dataset do mapa.
  useEffect(() => {
    if (!map) return;
    for (const d of user.datasets) {
      if (d.format !== "pmtiles" || map.hasDataset(d.id) || loadingLocal.current.has(d.id)) continue;
      loadingLocal.current.add(d.id);
      map
        .addDataset(d.id, d.data)
        .then((layer) => setLocalMetas((m) => ({ ...m, [d.id]: layer.meta })))
        .catch((e: Error) => console.warn("[local] não deu para abrir", d.id, e.message))
        .finally(() => loadingLocal.current.delete(d.id));
    }
  }, [map, user.datasets]);

  // Camadas da biblioteca salvas neste navegador: remonta com a malha ao abrir.
  useEffect(() => {
    let cancelled = false;
    void listLibraryLayers()
      .then((saved) => Promise.all(saved.map((s) => restoreMapLayer(s).catch(() => null))))
      .then((layers) => {
        if (!cancelled) setLibraryLayers(layers.filter((l): l is LibraryLayer => l !== null));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Link compartilhado: refaz as camadas da biblioteca na fonte e limpa o estado do hash.
  useEffect(() => {
    clearShared();
    if (!SHARED?.lib?.length) return;
    void Promise.all(SHARED.lib.map((r) => layerFromRecipe(r).catch((e: Error) => (console.warn("[share]", e.message), null)))).then(
      (layers) => {
        const ok = layers.filter((l): l is LibraryLayer => l !== null);
        for (const l of ok) void saveLibraryLayer(l.saved);
        setLibraryLayers((list) => [...list.filter((x) => !ok.some((l) => l.manifest.id === x.manifest.id)), ...ok]);
        setActive((prev) => new Set([...prev, ...ok.map((l) => l.manifest.id)]));
      },
    );
  }, []);

  // Com o visualizador aberto, clicar no mapa leva à foto mais próxima do clique.
  useEffect(() => {
    if (!streetImageId || !pick) return;
    let cancelled = false;
    void nearestStreetImage(pick.lngLat)
      .then((img) => !cancelled && img && setStreetImageId(img.id))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando o clique muda
  }, [pick]);

  // Cartão no mapa acompanha o clique; fechar o cartão limpa a seleção.
  useEffect(() => {
    if (!map) return;
    if (pick) map.showPopup(pick.dataset?.lngLat ?? pick.lngLat, popupEl, () => setPick(null));
    else map.hidePopup();
  }, [map, pick, popupEl]);

  const showPickDetails = () => setPanel("details");

  const openStreetView = (imageId: string) => {
    setStreetImageId(imageId);
    setActive((prev) => new Set(prev).add(STREET_KEY));
  };

  const closeStreetView = () => {
    setStreetImageId(null);
    map?.setLocationMarker(null);
  };

  const copyShareLink = async () => {
    // Só vai o que quem abrir consegue ver: catálogo, exemplo, servidor e biblioteca (os arquivos do navegador ficam de fora).
    const shareable = [...active].filter(
      (id) =>
        DATAPACKS.some((d) => d.id === id) || id === DATASET_KEY || id === PLACES_KEY || id === STREET_KEY || id in serverMetas,
    );
    const lib = libraryLayers.filter((l) => active.has(l.manifest.id)).map(recipeOf);
    const f = Object.fromEntries(shareable.map(mapIdOf).filter((id) => filters[id]).map((id) => [id, filters[id]!]));
    // Estilo do editor das camadas que vão no link (quem abrir vê do mesmo jeito).
    const st = Object.fromEntries(shareable.map(mapIdOf).filter((id) => styles[id]).map((id) => [id, styles[id]!]));
    const round = (n: number) => Math.round(n * 1e6) / 1e6;
    const title = tabs.find((t) => t.id === currentTab)?.title;
    const url = shareUrl({
      // O nome dado pela pessoa vai junto; "Mapa N" não diz nada a quem recebe.
      ...(title && !/^Mapa \d+$/.test(title) ? { n: title } : {}),
      layers: shareable,
      lib,
      theme,
      look,
      ...(Object.keys(f).length ? { f } : {}),
      ...(Object.keys(st).length ? { st } : {}),
      ...(maquete ? { maquete: { c: [round(maquete.center[0]), round(maquete.center[1])], r: maquete.radius, ...(maquete.title ? { t: maquete.title } : {}) } } : {}),
    });
    const local = user.datasets.filter((d) => active.has(d.id)).length;
    try {
      await navigator.clipboard.writeText(url);
      setShareStatus(local ? `Link copiado. ${local} camada(s) importada(s) neste navegador não vão junto.` : "Link copiado.");
    } catch {
      window.prompt("Copie o link:", url);
    }
  };

  const addLibraryLayer = (layer: LibraryLayer) => {
    void saveLibraryLayer(layer.saved);
    // A mesma variável e período de novo substitui a anterior.
    map?.removeCatalogLayer(layer.manifest.id);
    setLibraryLayers((list) => [...list.filter((l) => l.manifest.id !== layer.manifest.id), layer]);
    setActive((prev) => new Set(prev).add(layer.manifest.id));
    setLibraryOpen(false);
    setPanel("layers");
    map?.flyTo({ center: [-52, -14.5], zoom: 3.8, pitch: 0, bearing: 0 });
  };

  const removeLibraryLayer = (id: string) => {
    void deleteLibraryLayer(id);
    map?.removeCatalogLayer(id);
    setLibraryLayers((list) => list.filter((l) => l.manifest.id !== id));
    setActive((prev) => without(prev, id));
  };

  // O que está na tela é a aba atual: cada mudança vai para ela.
  useEffect(() => {
    setTabs((list) =>
      list.map((t) => (t.id === currentTab ? { ...t, active: [...active], hidden: [...hidden], filters, paintDataset, theme, look, styles, regionViews: undefined } : t)),
    );
  }, [currentTab, active, hidden, filters, paintDataset, theme, look, styles]);
  // Estilos no mapa: os salvos e, por cima, o rascunho do editor. Aplica só o que mudou.
  useEffect(() => {
    if (!map) return;
    const effective: Record<string, DataStyle> = { ...styles, ...(styleEditing ? { [styleEditing.id]: styleEditing.draft } : {}) };
    for (const id of new Set([...Object.keys(appliedStyles.current), ...Object.keys(effective)])) {
      const next = effective[id] ? JSON.stringify(effective[id]) : "";
      if (appliedStyles.current[id] === next) continue;
      map.setDatasetStyle(id, effective[id] ?? null);
      if (next) appliedStyles.current[id] = next;
      else delete appliedStyles.current[id];
    }
  }, [map, styles, styleEditing]);
  const tabsRef = useRef({ tabs, currentTab });
  tabsRef.current = { tabs, currentTab };
  const persistTabs = useCallback(() => {
    const { tabs: list, currentTab: current } = tabsRef.current;
    saveTabs({ tabs: list.map((t) => ({ ...t, camera: cameras.current.get(t.id) ?? t.camera })), current });
  }, []);
  useEffect(persistTabs, [tabs, currentTab, persistTabs]);
  useEffect(() => {
    if (!map) return;
    // A câmera de abertura (link ou hash) já conta, mesmo sem mexer no mapa.
    cameras.current.set(tabsRef.current.currentTab, map.camera);
    return map.onViewChange(() => {
      cameras.current.set(tabsRef.current.currentTab, map.camera);
      persistTabs();
    });
  }, [map, persistTabs]);
  // Estabelecimentos: ao aproximar, cada ponto vira marcador com o ícone do tipo de lugar.
  useEffect(() => {
    if (map && places) void placeIconSvgs([...places.meta.categories, "outros"]).then((svgs) => map.setDatasetIcons(PLACES.id, svgs));
  }, [map, places]);
  // Filtros lembrados valem assim que o mapa existe (o motor guarda até a camada carregar).
  useEffect(() => {
    if (!map) return;
    for (const [id, filter] of Object.entries(initialFilters.current)) map.setLayerFilter(id, filter);
  }, [map]);
  const updateFilter = (id: string, change: Partial<DatasetFilter>) => {
    const merged: DatasetFilter = { ...filters[id], ...change };
    const next: DatasetFilter = {};
    if (merged.categories) next.categories = merged.categories;
    if (merged.where && Object.keys(merged.where).length) next.where = merged.where;
    map?.setLayerFilter(id, next);
    setFilters((prev) => {
      const { [id]: _, ...rest } = prev;
      return Object.keys(next).length ? { ...rest, [id]: next } : rest;
    });
  };
  const setCategoryFilter = (id: string, categories: number[] | null) => updateFilter(id, { categories: categories ?? undefined });
  const setWhere = (id: string, where: Where | null) => updateFilter(id, { where: where ?? undefined });
  // "Reabrir" a aba fechada fica um tempo e some.
  useEffect(() => {
    if (!closedTab) return;
    const t = window.setTimeout(() => setClosedTab(null), 8000);
    return () => window.clearTimeout(t);
  }, [closedTab]);
  // O aviso de "link copiado" some sozinho.
  useEffect(() => {
    if (!shareStatus) return;
    const t = window.setTimeout(() => setShareStatus(null), 6000);
    return () => window.clearTimeout(t);
  }, [shareStatus]);

  // Prédios acesos: pela camada escolhida no cartão; na maquete, pelo dataset dela.
  const firstDataset =
    active.has(DATASET_KEY) && demoMeta
      ? CLIENT_DATASET.id
      : (Object.keys(serverMetas).find((id) => active.has(id)) ?? (active.has(PLACES_KEY) && places ? PLACES.id : undefined));
  const paintTarget = paintDataset ?? undefined;
  /** Liga/desliga sem escolher camada (Ajustes, maquete): usa a da maquete ou a primeira ligada. */
  const setPaintBuildingsOn = (on: boolean) => setPaintDataset(on ? (paintDataset ?? firstDataset ?? null) : null);
  useEffect(() => {
    if (!map) return;
    map.setBuildingPaint(paintBuildingsOn && paintTarget ? paintTarget : null, setBuildingResult);
    if (!paintBuildingsOn) setBuildingResult(null);
  }, [map, paintBuildingsOn, paintTarget]);

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
    if (places) {
      infos[PLACES.id] = {
        name: PLACES.name,
        categories: places.meta.categories,
        colorBy: places.meta.colorBy,
        title: places.meta.title,
        fieldLabels: {
          nome: "Nome",
          endereco: "Endereço",
          telefone: "Telefone",
          site: "Site",
          cidade: "Cidade",
          categoria: "Categoria",
          marca: "Marca",
          uf: "UF",
          cep: "CEP",
          email: "E-mail",
          redes: "Redes sociais",
          grupo: "Grupo",
          origem: "Fonte do dado",
          atualizado: "Atualizado na fonte",
          confianca: "Confiança (0–1)",
        },
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
    for (const d of user.datasets) {
      const meta = localMetas[d.id];
      if (!meta) continue;
      infos[d.id] = { name: d.manifest.name, categories: meta.categories, colorBy: meta.colorBy, title: meta.title };
    }
    return infos;
  }, [demoMeta, places, server.datasets, serverMetas, user.datasets, localMetas]);

  useEffect(() => {
    if (!map || !widgetsOpen) return;
    const sources = [
      demoMeta && active.has(DATASET_KEY) ? CLIENT_DATASET.id : null,
      places && active.has(PLACES_KEY) ? PLACES.id : null,
      ...Object.keys(tileMetas).filter((id) => active.has(id)),
    ].filter((id): id is string => Boolean(id));
    const compute = () =>
      setWidgets(
        sources.flatMap((id) => {
          const info = datasetInfos[id];
          const summary = map.viewportSummary(id);
          if (!info || !summary) return [];
          const bars = info.categories
            .map((c, i) => ({ label: info.label ? info.label(c) : c, color: categoryColor(i, info.categories), n: summary.byCategory[i] ?? 0, i }))
            // Nos hexágonos a contagem por categoria vem completa; o filtro do cartão decide o que aparece.
            .filter((b) => b.n > 0 && (!filters[id]?.categories || filters[id]!.categories!.includes(b.i)))
            .sort((a, b) => b.n - a.n);
          return [{ key: id, title: info.name, count: summary.count, mode: summary.mode, bars, filtered: Boolean(filters[id]) }];
        }),
      );
    compute();
    // Recém-ligada, a camada ainda não tem tiles: conta de novo quando o mapa termina de carregar.
    let live = true;
    void map.whenIdle().then(() => live && compute());
    const off = map.onViewChange(compute);
    return () => {
      live = false;
      off();
    };
  }, [map, widgetsOpen, active, demoMeta, places, tileMetas, datasetInfos, filters]);

  const nearbySource: NearbySource | null =
    places && datasetInfos[PLACES.id] ? { datasetId: PLACES.id, name: "Estabelecimentos", info: datasetInfos[PLACES.id]!, categories: filters[PLACES.id]?.categories ?? null, where: filters[PLACES.id]?.where ?? null } : null;


  const openImport = useCallback((file: File) => setImportJob({ file }), []);

  const finishImport = (dataset: ImportedDataset) => {
    setImportJob(null);
    const id = dataset.manifest.id;
    const previous = user.datasets.find((d) => d.id === id);
    if (previous) {
      // Editar / atualizar: a camada antiga sai do mapa e a nova entra no lugar (mesmo id, filtros e cartão).
      map?.removeCatalogLayer(id);
      map?.removeDataset(id);
      setLocalMetas(({ [id]: _, ...rest }) => rest);
    }
    void user.add({ id, ...dataset, createdAt: previous?.createdAt ?? Date.now(), ...(previous ? { updatedAt: Date.now() } : {}) });
    setActive((prev) => new Set(prev).add(dataset.manifest.id));
    setPanel("layers");
    map?.fitBounds(dataset.bounds);
  };

  /** Reabre o assistente de uma camada: com o arquivo guardado (editar) ou com um arquivo novo (atualizar). */
  const reopenDataset = (d: UserDataset, mode: ImportRestore["mode"], file?: File) => {
    if (!d.source) return;
    const chosen = file ?? (mode === "edit" ? d.source.file : undefined);
    if (!chosen) {
      pendingReopen.current = { dataset: d, mode };
      reopenInput.current?.click();
      return;
    }
    setImportJob({ file: chosen, restore: { datasetId: d.id, saved: d.source, mode } });
  };

  const sendToServer = async (file: File, spec: ImportSpec) => {
    setImportJob(null);
    setPanel("layers");
    const created = await server.upload(file, spec);
    if (created) focusWhenReady.current.add(created.id);
  };

  const removeUserDataset = (id: string) => {
    const target = user.datasets.find((d) => d.id === id);
    if (!target || !window.confirm(`Remover "${target.manifest.name}"? O dado salvo neste navegador será apagado.`)) return;
    map?.removeCatalogLayer(id);
    map?.removeDataset(id);
    setLocalMetas(({ [id]: _, ...rest }) => rest);
    setStyles(({ [id]: _, ...rest }) => rest);
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

  /** Olho do cartão / adicionar: visível ↔ escondida (a camada continua no projeto). */
  const toggle = (id: string, on: boolean) => {
    setActive((prev) => (on ? new Set(prev).add(id) : without(prev, id)));
    setHidden((prev) => (on ? without(prev, id) : new Set(prev).add(id)));
  };

  /** Tira a camada do projeto (o dado em si continua disponível em "Adicionar"). */
  const removeFromMap = (id: string) => {
    setActive((prev) => without(prev, id));
    setHidden((prev) => without(prev, id));
  };

  const inProject = (id: string) => active.has(id) || hidden.has(id);

  const startMeasure = (mode: MeasureMode = measureMode) => {
    if (!map) return;
    setPick(null);
    setMeasuring(true);
    setMeasureState(null);
    map.startMeasure(mode, setMeasureState, () => setMeasuring(false));
  };
  const stopMeasure = () => {
    map?.stopMeasure();
    setMeasuring(false);
    setMeasureState(null);
  };
  const changeMeasureMode = (mode: MeasureMode) => {
    setMeasureMode(mode);
    map?.setMeasureMode(mode);
  };

  const changePerspective = (mode: "2d" | "3d") => {
    setPerspective(mode);
    map?.setPerspective(mode);
  };

  // ---------- Abas de mapa ----------

  /** Mostra outra aba: camadas, filtros, prédios e câmera dela. O que é do momento (clique, medição, maquete) fecha. */
  const switchTab = (id: string, list: MapTab[] = tabs) => {
    const target = list.find((t) => t.id === id);
    if (!target || (id === currentTab && list === tabs)) return;
    if (map) cameras.current.set(currentTab, map.camera);
    setPick(null);
    if (measuring) stopMeasure();
    setMaquete(null);
    if (streetImageId) closeStreetView();
    for (const fid of Object.keys(filters)) if (!target.filters[fid]) map?.setLayerFilter(fid, null);
    for (const [fid, f] of Object.entries(target.filters)) map?.setLayerFilter(fid, f);
    setActive(new Set(target.active));
    setHidden(new Set(target.hidden));
    setFilters(target.filters);
    setPaintDataset(target.paintDataset ?? null);
    setStyles(tabStyles(target));
    setStyleEditing(null);
    if ((target.theme ?? "light") !== theme) changeTheme(target.theme ?? "light");
    if ((target.look ?? "data") !== look) changeLook(target.look ?? "data");
    setCurrentTab(id);
    const camera = cameras.current.get(id) ?? target.camera ?? BLANK_CAMERA;
    map?.jumpTo(camera);
    setPerspective(camera.pitch > 1 ? "3d" : "2d");
  };

  /** Mapa zerado: sem camadas, no Brasil inteiro. A biblioteca e os seus dados continuam em "Adicionar". */
  const newTab = () => {
    // A aparência vem da aba atual (é mais gosto do que dado); o resto começa vazio.
    const tab = createTab(tabs, { camera: BLANK_CAMERA, theme, look });
    const list = [...tabs, tab];
    setTabs(list);
    switchTab(tab.id, list);
    setClosedTab(null);
    if (!isNarrowScreen()) setPanel("add");
  };

  const closeTab = (id: string) => {
    if (tabs.length < 2) return;
    const index = tabs.findIndex((t) => t.id === id);
    const tab = tabs[index]!;
    const camera = id === currentTab && map ? map.camera : (cameras.current.get(id) ?? tab.camera);
    const rest = tabs.filter((t) => t.id !== id);
    setTabs(rest);
    // Como no navegador: fechando a aberta, vai para a vizinha da direita (ou da esquerda, se era a última).
    if (id === currentTab) switchTab((rest[index] ?? rest[index - 1])!.id, rest);
    cameras.current.delete(id);
    setClosedTab({ tab: { ...tab, camera }, index });
  };

  const reopenTab = () => {
    if (!closedTab) return;
    const list = [...tabs];
    list.splice(Math.min(closedTab.index, list.length), 0, closedTab.tab);
    setTabs(list);
    switchTab(closedTab.tab.id, list);
    setClosedTab(null);
  };

  /** Cópia da aba logo ao lado, já aberta: para variar um mapa sem montar tudo de novo. */
  const duplicateTab = (id: string) => {
    const index = tabs.findIndex((t) => t.id === id);
    const source = tabs[index];
    if (!source) return;
    const live = id === currentTab;
    const copy = createTab(tabs, {
      ...(live ? { active: [...active], hidden: [...hidden], filters, paintDataset, theme, look, styles } : source),
      title: `${source.title} (cópia)`,
      camera: live && map ? map.camera : (cameras.current.get(id) ?? source.camera),
    });
    const list = [...tabs];
    list.splice(index + 1, 0, copy);
    setTabs(list);
    switchTab(copy.id, list);
  };

  const closeOtherTabs = (id: string) => {
    const keep = tabs.filter((t) => t.id === id);
    if (!keep.length || tabs.length < 2) return;
    setTabs(keep);
    if (id !== currentTab) switchTab(id, keep);
    for (const t of tabs) if (t.id !== id) cameras.current.delete(t.id);
    setClosedTab(null);
  };

  const renameTab = (id: string, title: string) => setTabs((list) => list.map((t) => (t.id === id ? { ...t, title } : t)));

  const moveTab = (id: string, toIndex: number) =>
    setTabs((list) => {
      const from = list.findIndex((t) => t.id === id);
      if (from < 0 || from === toIndex) return list;
      const next = [...list];
      next.splice(toIndex, 0, ...next.splice(from, 1));
      return next;
    });

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

  const toggleMunicipios3d = (on: boolean) => {
    setMunicipios3d(on);
    if (on) setActive((prev) => new Set(prev).add("municipios-populacao"));
    map?.setCatalogExtruded("municipios-populacao", on);
  };

  // ---------- Visualização avançada (maquete) ----------

  /** Maquete do ponto clicado, com os pontos das camadas de dados ligadas. */
  /** Município do ponto: população (IBGE 2022), área e valores das camadas da biblioteca no projeto. */
  const placeFacts = async (center: [number, number]): Promise<PlaceFacts> => {
    const area = await areaAt(center);
    const comparisons: Comparison[] = [];
    if (area.kind === "municipio" && area.code) {
      for (const layer of libraryLayers) {
        if (!inProject(layer.manifest.id)) continue;
        const feature = (layer.data.features as { properties: { codigo: string | number; valor: number } }[]).find(
          (f) => String(f.properties.codigo) === area.code,
        );
        if (feature) comparisons.push({ id: layer.manifest.id, label: `${layer.variable} · ${layer.period}`, unit: layer.unit, value: feature.properties.valor });
      }
    }
    return { name: area.name, kind: area.kind, population: area.population, areaKm2: area.areaKm2, comparisons };
  };

  const startAdvanced = async (p: MapPick) => {
    if (measuring) stopMeasure();
    const record = p.dataset?.kind === "record" ? p.dataset : null;
    const info = record ? datasetInfos[record.datasetId] : undefined;
    const title = record && info?.title ? String(record.properties[info.title] ?? "") || undefined : undefined;
    const datasetIds = [
      demoMeta && active.has(DATASET_KEY) ? CLIENT_DATASET.id : null,
      places && active.has(PLACES_KEY) ? PLACES.id : null,
      ...Object.keys(tileMetas).filter((id) => active.has(id)),
    ].filter((id): id is string => Boolean(id));
    setPick(null);
    // Imersiva: a maquete ganha a área toda do mapa.
    setPanel(null);
    setWidgetsOpen(false);
    setMaquete({ center: p.dataset?.lngLat ?? p.lngLat, title, datasetIds, radius: 300 });
  };

  // Link com maquete: abre assim que o mapa (e os Estabelecimentos, se estão no link) estiverem prontos.
  const sharedMaquete = useRef(SHARED?.maquete ?? null);
  useEffect(() => {
    const shared = sharedMaquete.current;
    if (!map || !shared) return;
    const open = () => {
      if (!sharedMaquete.current) return;
      sharedMaquete.current = null;
      setPanel(null);
      setWidgetsOpen(false);
      setMaquete({ center: shared.c, title: shared.t, radius: shared.r, datasetIds: places && active.has(PLACES_KEY) ? [PLACES.id] : [] });
    };
    if (places || !active.has(PLACES_KEY)) return open();
    const timer = window.setTimeout(open, 5000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, places]);

  // TODO(fase 2b): geocodificação local (Photon). Por enquanto a busca não faz nada.
  /** O que cada resultado da busca faz ao ser escolhido. */
  const searchActions = useRef(new Map<string, () => void>());

  const search = useCallback(
    async (query: string): Promise<SearchResult[]> => {
      const actions = new Map<string, () => void>();
      const results: SearchResult[] = [];
      const coords = parseCoordinates(query);
      if (coords) {
        results.push({ key: "coords", kind: "coords", title: `${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}` });
        actions.set("coords", () => {
          map?.flyTo({ center: coords, zoom: 17 });
          setPick({ lngLat: coords, dataset: null, catalog: [], building: null });
        });
      }
      const [cities, hits] = await Promise.all([
        coords ? Promise.resolve([]) : searchMunicipios(query, 3),
        coords || !map ? Promise.resolve([]) : map.searchDatasets(query, { limit: 8 }),
      ]);
      // A mesma coisa vinda de fontes diferentes (mesmo nome a poucos metros) aparece uma vez só.
      const unique: typeof hits = [];
      for (const h of hits.sort((a, b) => a.rank - b.rank || a.distanceM - b.distanceM)) {
        const name = normalizeText(h.title);
        if (unique.some((u) => normalizeText(u.title) === name && geodesicDistanceM(u.lngLat, h.lngLat) < 50)) continue;
        unique.push(h);
      }
      // Cidade cujo nome começa com a busca vem antes dos lugares ("curitiba" → a cidade, não a Rua Curitiba).
      const q = normalizeText(query);
      const leading = cities.filter((c) => normalizeText(c.name).startsWith(q));
      const trailing = cities.filter((c) => !leading.includes(c));
      const addCity = (c: (typeof cities)[number]) => {
        const key = `city:${c.code}`;
        results.push({ key, kind: "city", title: c.name, subtitle: `Cidade · ${new Intl.NumberFormat("pt-BR").format(c.population)} hab.` });
        actions.set(key, () => map?.fitBounds(c.bounds, 13));
      };
      leading.forEach(addCity);
      for (const h of unique.slice(0, 8 - leading.length)) {
        const key = `${h.datasetId}:${h.id}`;
        const info = datasetInfos[h.datasetId];
        const where = [h.properties.endereco, h.properties.cidade].filter(Boolean).join(" · ");
        const dist = h.distanceM < 1000 ? `${Math.round(h.distanceM)} m` : `${(h.distanceM / 1000).toFixed(1).replace(".", ",")} km`;
        results.push({
          key,
          kind: "place",
          title: h.title,
          subtitle: [where || info?.name, dist].filter(Boolean).join(" · "),
          color: h.category !== null && info ? categoryColor(h.category, info.categories) : undefined,
        });
        actions.set(key, () => {
          setActive((prev) => new Set(prev).add(datasetKey(h.datasetId)));
          map?.flyTo({ center: h.lngLat, zoom: 17.5 });
          setPick({
            lngLat: h.lngLat,
            dataset: { kind: "record", datasetId: h.datasetId, id: h.id, category: h.category, properties: h.properties, lngLat: h.lngLat },
            catalog: [],
            building: null,
          });
        });
      }
      trailing.forEach(addCity);
      searchActions.current = actions;
      return results;
    },
    [map, datasetInfos],
  );

  const selectSearch = (r: SearchResult) => searchActions.current.get(r.key)?.();

  const errors = [user.error && { text: user.error, clear: user.clearError }, server.error && { text: server.error, clear: server.clearError }].filter(
    (e): e is { text: string; clear: () => void } => Boolean(e),
  );

  // ---------- Painel "Camadas": um cartão por camada no projeto ----------
  const datasetLegend = (id: string) => {
    const info = datasetInfos[id];
    if (!info) return null;
    return (
      <CategoryLegend
        items={info.categories.map((c, i) => {
          const PlaceIcon = id === PLACES.id ? placeIcon(c) : null;
          return {
            label: info.label ? info.label(c) : c,
            color: categoryColor(i, info.categories),
            ...(PlaceIcon && { icon: <PlaceIcon size={12} strokeWidth={2.25} aria-hidden="true" /> }),
          };
        })}
        selected={filters[id]?.categories ?? null}
        onChange={(categories) => setCategoryFilter(id, categories)}
      />
    );
  };
  const datasetMeta = (id: string): DatasetMeta | undefined =>
    id === CLIENT_DATASET.id ? (demoMeta ?? undefined) : id === PLACES.id ? places?.meta : tileMetas[id];
  /** Filtro por valor de um dataset em tiles: colunas que vão nos pontos. */
  const datasetValueFilter = (id: string) => {
    const meta = datasetMeta(id);
    if (!meta) return null;
    const labels = datasetInfos[id]?.fieldLabels ?? {};
    const columns: FilterColumn[] = meta.columns
      .filter((c) => c.name !== meta.categoryProperty)
      .map((c) => ({ key: c.name, label: labels[c.name] ?? c.name, type: c.type === "number" ? "number" : "text" }));
    return (
      <ValueFilter
        columns={columns}
        where={filters[id]?.where ?? null}
        onChange={(where) => setWhere(id, where)}
        range={(column) => map?.columnRange(id, column) ?? null}
        note={POINTS_ONLY_NOTE}
      />
    );
  };
  const datasetOptions = (id: string) => {
    const painting = paintDataset === id;
    // Arquivo antigo: sem contagem por região (e só hexágonos no zoom afastado).
    const loaded = Boolean(map && datasetMeta(id));
    const canRegions = loaded && Boolean(map?.datasetHasRegions(id));
    const regions = canRegions && !columns3d && styles[id]?.shape === "regions";
    return (
      <>
        <div className="layer-options">
          <button
            type="button"
            className={`chip-toggle ${regions ? "is-on" : ""}`}
            aria-pressed={regions}
            disabled={!canRegions || columns3d}
            onClick={() =>
              setStyles((prev) => ({ ...prev, [id]: { ...(prev[id] ?? DEFAULT_DATA_STYLE), ...(regions ? { shape: "points", size: DEFAULT_DATA_STYLE.size } : { shape: "regions" }) } }))
            }
            title={
              !loaded
                ? "Abrindo…"
                : !canRegions
                  ? "Esta camada foi gerada antes da contagem por região: importe de novo para ver estados e municípios com o número de registros"
                  : "Estados (afastado) e municípios (ao aproximar) com quantos registros há em cada um"
            }
          >
            <Icon name="map" size={16} />
            Regiões
          </button>
          <button type="button" className={`chip-toggle ${columns3d ? "is-on" : ""}`} aria-pressed={columns3d} onClick={() => toggleColumns(!columns3d)}>
            <Icon name="box3d" size={16} />
            Colunas 3D
          </button>
          <button
            type="button"
            className={`chip-toggle ${painting ? "is-on" : ""}`}
            aria-pressed={painting}
            onClick={() => setPaintDataset(painting ? null : id)}
            title="Pinta cada prédio com a categoria que mais aparece nele"
          >
            <Icon name="pin" size={16} />
            Prédios acesos
          </button>
        </div>
        {painting && (
          <p className="layer-hint muted">
            {buildingResult
              ? `${int.format(buildingResult.features.length)} prédios acesos na tela`
              : "Aproxime até o nível da rua (zoom 14+) para ver os prédios. Por enquanto, prédios em 3D nas principais cidades."}
          </p>
        )}
      </>
    );
  };
  const datapackLegend = (d: (typeof DATAPACKS)[number]) => {
    const r = d.render;
    if (r.type === "choropleth") {
      return <ScaleLegend colors={r.colors} min={compact.format(r.breaks[0] ?? 0)} max={`${compact.format(r.breaks.at(-1) ?? 0)}+`} unit={d.fields.find((f) => f.key === r.property)?.unit} />;
    }
    if (r.colorBy) return <CategoryLegend items={r.colorBy.categories.map((c, i) => ({ label: c, color: r.colorBy!.colors[i] ?? r.color }))} />;
    return <CategoryLegend items={[{ label: d.name, color: r.color }]} />;
  };

  const layerCards: { key: string; node: (badge: string, tone: string) => ReactNode }[] = [];
  for (const u of server.uploads) {
    layerCards.push({
      key: `upload:${u.key}`,
      node: (badge, tone) => <LayerCard badge={badge} tone={tone} title={u.name} meta={`enviando ao servidor… ${Math.round(u.fraction * 100)}%`} visible={false} status="working" progress={u.fraction} />,
    });
  }
  for (const d of server.datasets) {
    const working = d.status === "queued" || d.status === "processing";
    if (!working && d.status !== "error" && !inProject(d.id)) continue;
    const actions: LayerAction[] = [
      ...(d.report ? [{ label: "Enquadrar no mapa", icon: "frame" as const, onClick: () => focusServerDataset(d) }] : []),
      { label: "Renomear", icon: "rename", onClick: () => renameServerDataset(d.id) },
      { label: "Tirar do mapa", icon: "eyeOff", onClick: () => removeFromMap(d.id) },
      ...(!working ? [{ label: "Apagar do servidor", icon: "trash" as const, onClick: () => removeServerDataset(d.id), danger: true }] : []),
    ];
    const meta = working
      ? d.status === "queued" ? "na fila do servidor…" : `processando… ${Math.round(d.progress * 100)}%`
      : d.status === "error" ? <span className="warn">{d.error}</span>
      : d.report ? <><span className="num">{int.format(d.report.records)}</span> registros · servidor local</>
      : "servidor local";
    layerCards.push({
      key: d.id,
      node: (badge, tone) => (
        <LayerCard badge={badge} tone={tone} title={d.name} origin="user" meta={meta} visible={active.has(d.id)} onVisible={d.status === "ready" ? (v) => toggle(d.id, v) : undefined} onStyle={serverMetas[d.id] ? () => openStyle(d.id, d.name) : undefined} actions={actions} status={working ? "working" : d.status === "error" ? "error" : undefined} progress={working ? d.progress : undefined}>
          {datasetLegend(d.id)}
          {datasetValueFilter(d.id)}
          {datasetOptions(d.id)}
        </LayerCard>
      ),
    });
  }
  for (const d of user.datasets) {
    if (!inProject(d.id)) continue;
    const r = d.manifest.render;
    layerCards.push({
      key: d.id,
      node: (badge, tone) => (
        <LayerCard
          badge={badge}
          tone={tone}
          title={d.manifest.name}
          origin="user"
          meta={<><span className="num">{int.format(d.count)}</span> pontos · neste navegador</>}
          visible={active.has(d.id)}
          onVisible={(v) => toggle(d.id, v)}
          onStyle={d.format === "pmtiles" && localMetas[d.id] ? () => openStyle(d.id, d.manifest.name) : undefined}
          actions={[
            { label: "Enquadrar no mapa", icon: "frame", onClick: () => focusUserDataset(d) },
            ...(d.source
              ? [
                  { label: "Editar dados", icon: "sliders" as const, onClick: () => reopenDataset(d, "edit") },
                  { label: "Atualizar com nova planilha", icon: "upload" as const, onClick: () => reopenDataset(d, "update") },
                ]
              : []),
            { label: "Renomear", icon: "rename", onClick: () => renameUserDataset(d.id) },
            { label: "Tirar do mapa", icon: "eyeOff", onClick: () => removeFromMap(d.id) },
            { label: "Apagar deste navegador", icon: "trash", onClick: () => removeUserDataset(d.id), danger: true },
          ]}
        >
          {d.format === "pmtiles" ? (
            <>
              {localMetas[d.id] ? datasetLegend(d.id) : <p className="layer-hint muted">Abrindo…</p>}
              {datasetValueFilter(d.id)}
              {datasetOptions(d.id)}
            </>
          ) : r.type === "points" && r.colorBy ? (
            <CategoryLegend
              items={r.colorBy.categories.map((c, i) => ({ label: c, color: r.colorBy!.colors[i] ?? r.color }))}
              selected={filters[d.id]?.categories ?? null}
              onChange={(categories) => setCategoryFilter(d.id, categories)}
            />
          ) : (
            <CategoryLegend items={[{ label: "Registros", color: r.type === "points" ? r.color : "#6b7485" }]} />
          )}
          {d.format !== "pmtiles" && (
            <ValueFilter
              columns={d.manifest.fields.map((f) => ({ key: f.key, label: f.label, type: f.format === "decimal" || f.format === "int" ? "number" : "text" }))}
              where={filters[d.id]?.where ?? null}
              onChange={(where) => setWhere(d.id, where)}
              range={(column) => map?.columnRange(d.id, column) ?? null}
            />
          )}
        </LayerCard>
      ),
    });
  }
  for (const l of libraryLayers) {
    if (!inProject(l.manifest.id)) continue;
    layerCards.push({
      key: l.manifest.id,
      node: (badge, tone) => (
        <LayerCard
          badge={badge}
          tone={tone}
          title={`${l.variable} · ${l.period}`}
          origin="public"
          meta={<>{l.item.sourceName} · <span className="num">{int.format(l.matched)}</span> {l.level === "uf" ? "estados" : "municípios"}</>}
          visible={active.has(l.manifest.id)}
          onVisible={(v) => toggle(l.manifest.id, v)}
          actions={[
            ...(l.item.url ? [{ label: "Abrir na fonte", icon: "external" as const, onClick: () => window.open(l.item.url!, "_blank", "noreferrer") }] : []),
            { label: "Tirar do mapa", icon: "eyeOff", onClick: () => removeFromMap(l.manifest.id) },
            { label: "Apagar", icon: "trash", onClick: () => removeLibraryLayer(l.manifest.id), danger: true },
          ]}
        >
          <ScaleLegend colors={l.colors} min={compact.format(l.breaks[0] ?? 0)} max={`${compact.format(l.breaks.at(-1) ?? 0)}+`} unit={l.unit} />
        </LayerCard>
      ),
    });
  }
  if (places && inProject(PLACES_KEY)) {
    layerCards.push({
      key: PLACES_KEY,
      node: (badge, tone) => (
        <LayerCard
          badge={badge}
          tone={tone}
          title="Estabelecimentos"
          origin="public"
          meta={<>Overture Maps · <span className="num">{int.format(places.meta.records)}</span> · versão {places.release}</>}
          visible={active.has(PLACES_KEY)}
          onVisible={(v) => toggle(PLACES_KEY, v)}
          onStyle={() => openStyle(PLACES.id, "Estabelecimentos")}
          actions={[
            { label: "Sobre a fonte", icon: "external", onClick: () => window.open("https://docs.overturemaps.org/attribution/", "_blank", "noreferrer") },
            { label: "Tirar do mapa", icon: "eyeOff", onClick: () => removeFromMap(PLACES_KEY) },
          ]}
        >
          {datasetLegend(PLACES.id)}
          {datasetValueFilter(PLACES.id)}
          {datasetOptions(PLACES.id)}
        </LayerCard>
      ),
    });
  }
  if (demoMeta && inProject(DATASET_KEY)) {
    layerCards.push({
      key: DATASET_KEY,
      node: (badge, tone) => (
        <LayerCard
          badge={badge}
          tone={tone}
          title={CLIENT_DATASET.name}
          origin="sample"
          meta={<><span className="num">{int.format(demoMeta.records)}</span> registros</>}
          visible={active.has(DATASET_KEY)}
          onVisible={(v) => toggle(DATASET_KEY, v)}
          onStyle={() => openStyle(CLIENT_DATASET.id, CLIENT_DATASET.name)}
          actions={[{ label: "Tirar do mapa", icon: "eyeOff", onClick: () => removeFromMap(DATASET_KEY) }]}
        >
          {datasetLegend(CLIENT_DATASET.id)}
          {datasetValueFilter(CLIENT_DATASET.id)}
          {datasetOptions(CLIENT_DATASET.id)}
        </LayerCard>
      ),
    });
  }
  for (const d of DATAPACKS) {
    if (!inProject(d.id)) continue;
    layerCards.push({
      key: d.id,
      node: (badge, tone) => (
        <LayerCard
          badge={badge}
          tone={tone}
          title={d.name}
          origin="public"
          meta={<DatapackMeta datapack={d} />}
          visible={active.has(d.id)}
          onVisible={(v) => toggle(d.id, v)}
          actions={[
            { label: "Abrir na fonte", icon: "external", onClick: () => window.open(d.source.url, "_blank", "noreferrer") },
            { label: "Tirar do mapa", icon: "eyeOff", onClick: () => removeFromMap(d.id) },
          ]}
        >
          {datapackLegend(d)}
          {d.id === "municipios-populacao" && (
            <div className="layer-options">
              <button type="button" className={`chip-toggle ${municipios3d ? "is-on" : ""}`} aria-pressed={municipios3d} onClick={() => toggleMunicipios3d(!municipios3d)}>
                <Icon name="box3d" size={16} />
                Em 3D
              </button>
            </div>
          )}
        </LayerCard>
      ),
    });
  }
  if (streetImageryEnabled && inProject(STREET_KEY)) {
    layerCards.push({
      key: STREET_KEY,
      node: (badge, tone) => (
        <LayerCard
          badge={badge}
          tone={tone}
          title="Fotos de rua"
          origin="public"
          meta="Mapillary · CC BY-SA"
          visible={active.has(STREET_KEY)}
          onVisible={(v) => toggle(STREET_KEY, v)}
          actions={[{ label: "Tirar do mapa", icon: "eyeOff", onClick: () => removeFromMap(STREET_KEY) }]}
        >
          <CategoryLegend items={[{ label: "Ruas com foto (clique para ver)", color: "#05cb63" }]} />
        </LayerCard>
      ),
    });
  }

  const letter = (i: number) => String.fromCharCode(65 + (i % 26));

  /** Legenda no mapa: camadas em tiles ligadas, com o estilo em uso (o rascunho, se o editor está aberto). */
  const legendLayers: LegendLayer[] = Object.entries(datasetInfos)
    .filter(([id]) => active.has(datasetKey(id)))
    .map(([id, info]) => {
      const style = styleEditing?.id === id ? styleEditing.draft : (styles[id] ?? DEFAULT_DATA_STYLE);
      return {
        id,
        title: id === PLACES.id ? "Estabelecimentos" : info.name,
        style,
        categories: info.categories.map((c, i) => ({ label: info.label ? info.label(c) : c, color: categoryColor(i, info.categories) })),
        range: style.color.mode === "value" ? (map?.datasetColumnRange(id, style.color.column) ?? null) : null,
      };
    });

  /** Abre o editor de estilo de uma camada (o rascunho começa no estilo salvo). */
  function openStyle(id: string, title: string) {
    setStyleEditing({ id, title, draft: styles[id] ?? DEFAULT_DATA_STYLE });
    // A camada precisa estar visível para ver a prévia.
    setActive((prev) => new Set(prev).add(datasetKey(id)));
  }
  const editingMeta = styleEditing ? datasetMeta(styleEditing.id) : undefined;
  const styleEditor = styleEditing && editingMeta && (
    <StyleEditor
      key={styleEditing.id}
      title={styleEditing.title}
      style={styleEditing.draft}
      numericColumns={editingMeta.columns
        .filter((c) => c.type === "number")
        .map((c) => ({ name: c.name, label: datasetInfos[styleEditing.id]?.fieldLabels?.[c.name] ?? c.name }))}
      hasCategories={editingMeta.categories.length > 0}
      categories={editingMeta.categories.map((c, i) => ({
        label: datasetInfos[styleEditing.id]?.label?.(c) ?? c,
        color: categoryColor(i, editingMeta.categories),
      }))}
      columnRange={(column) => map?.datasetColumnRange(styleEditing.id, column) ?? null}
      columnValues={(column) => map?.datasetColumnValues(styleEditing.id, column) ?? []}
      hasRegions={Boolean(map?.datasetHasRegions(styleEditing.id))}
      onChange={(draft) => setStyleEditing((e) => (e ? { ...e, draft } : e))}
      onSave={() => {
        const { id, draft } = styleEditing;
        setStyles((prev) => {
          const { [id]: _, ...rest } = prev;
          return JSON.stringify(draft) === JSON.stringify(DEFAULT_DATA_STYLE) ? rest : { ...rest, [id]: draft };
        });
        setStyleEditing(null);
      }}
      onDiscard={() => setStyleEditing(null)}
    />
  );

  const layersPanel = (
    <Panel
      title="Camadas"
      onClose={() => setPanel(null)}
      action={
        <button type="button" className="btn btn-ghost" onClick={() => setPanel("add")}>
          <Icon name="plus" size={16} />
          Adicionar
        </button>
      }
      footer={
        <button type="button" className="panel-footer-row" onClick={() => setPanel("settings")}>
          <span className="muted">Mapa base</span>
          <b>
            {look === "data" ? "Para dados" : "Clássico"} · {theme === "light" ? "Claro" : "Escuro"}
          </b>
        </button>
      }
    >
      {errors.map((e) => (
        <div key={e.text} className="wizard-error panel-alert">
          {e.text}{" "}
          <button type="button" className="link" onClick={e.clear}>
            ok
          </button>
        </div>
      ))}
      {layerCards.length === 0 ? (
        <PanelCard>
          <div className="empty-card">
            <span className="empty-icon">
              <Icon name="layers" size={24} />
            </span>
            <b>Nenhuma camada no mapa</b>
            <span className="muted">Importe seus registros ou escolha dados do catálogo e da biblioteca.</span>
            <button type="button" className="btn btn-primary" onClick={() => setPanel("add")}>
              Adicionar dados
            </button>
          </div>
        </PanelCard>
      ) : (
        layerCards.map((c, i) => <div key={c.key}>{c.node(letter(i), CATEGORY_COLORS[i % CATEGORY_COLORS.length]!)}</div>)
      )}
    </Panel>
  );

  const addPanel = (
    <Panel title="Adicionar dados" onClose={() => setPanel(null)}>
      <p className="panel-intro">Visualize no mesmo mapa os seus próprios dados e dados públicos.</p>
      <PanelCard title="Seus dados" aside={<span className="origin-tag origin-user">Seu dado</span>}>
        <p className="panel-text">CSV, Excel, Parquet ou GeoJSON com localização. Também dá para arrastar o arquivo direto para o mapa.</p>
        <button type="button" className="btn btn-primary btn-block" onClick={() => fileInput.current?.click()}>
          <Icon name="fileUp" size={18} />
          Importar arquivo
        </button>
        <p className={`server-status ${server.available ? "is-on" : ""}`}>
          <i />
          {server.available ? "Servidor local conectado: arquivos de qualquer tamanho" : "Servidor local desligado: arquivos até 2 milhões de linhas"}
        </p>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) openImport(file);
            e.target.value = "";
          }}
        />
        {(user.datasets.length > 0 || server.datasets.some((d) => d.status === "ready")) && (
          <div className="add-list">
            {server.datasets
              .filter((d) => d.status === "ready")
              .map((d) => (
                <AddRow key={d.id} title={d.name} meta={d.report ? `${int.format(d.report.records)} registros · servidor local` : "servidor local"} added={inProject(d.id)} onAdd={() => toggle(d.id, true)} />
              ))}
            {user.datasets.map((d) => (
              <AddRow key={d.id} title={d.manifest.name} meta={`${int.format(d.count)} pontos · neste navegador`} added={inProject(d.id)} onAdd={() => toggle(d.id, true)} />
            ))}
          </div>
        )}
        {user.usage && (
          <p className="hint left">
            {compact.format(user.usage.usedBytes / 1e6)} MB usados de {compact.format(user.usage.quotaBytes / 1e6)} MB neste navegador
          </p>
        )}
      </PanelCard>

      <PanelCard title="Dados públicos" aside={<span className="origin-tag origin-public">Público</span>}>
        <p className="panel-text">Fontes abertas prontas para o mapa. Os dados vêm direto de cada fonte.</p>
        <div className="add-list">
          <AddRow
            title="Estabelecimentos"
            meta={places ? `Overture Maps · ${int.format(places.meta.records)} · comércio, serviços, saúde, turismo` : "Gere com pnpm places"}
            added={inProject(PLACES_KEY)}
            disabled={!places}
            onAdd={() => toggle(PLACES_KEY, true)}
          />
          {streetImageryEnabled && (
            <AddRow title="Fotos de rua" meta="Mapillary · ruas com foto, andar pela rua em 3D" added={inProject(STREET_KEY)} onAdd={() => toggle(STREET_KEY, true)} />
          )}
          {DATAPACKS.map((d) => (
            <AddRow key={d.id} title={d.name} meta={<DatapackMeta datapack={d} />} added={inProject(d.id)} onAdd={() => toggle(d.id, true)} />
          ))}
        </div>
        <div className="panel-subsection">
          <h4>Biblioteca</h4>
          <p className="panel-text">
          {int.format(LIBRARY_TOTAL)} tabelas e séries de {LIBRARY_SOURCES.map((s) => s.name).join(", ")}. Baixe direto da fonte ou ponha no mapa por município ou estado.
        </p>
          <button type="button" className="btn btn-block" onClick={() => setLibraryOpen(true)}>
            <Icon name="library" size={18} />
            Abrir biblioteca
          </button>
        </div>
      </PanelCard>

      <PanelCard title="Exemplo" aside={<span className="origin-tag origin-sample">Exemplo</span>}>
        <div className="add-list">
          <AddRow title={CLIENT_DATASET.name} meta={demoMeta ? "Dados sintéticos para testar volume" : "Gere com pnpm synth && pnpm tiles"} added={inProject(DATASET_KEY)} disabled={!demoMeta} onAdd={() => toggle(DATASET_KEY, true)} />
        </div>
      </PanelCard>
    </Panel>
  );

  const detailsPanel = (
    <Panel title="Detalhes" onClose={() => setPanel(null)}>
      <PanelCard>
        <PickDetails pick={pick} datasets={datasetInfos} onAdvanced={(p) => void startAdvanced(p)} onStreetView={streetImageryEnabled ? openStreetView : undefined} />
      </PanelCard>
    </Panel>
  );

  const settingsPanel = (
    <Panel title="Ajustes" onClose={() => setPanel(null)}>
      <PanelCard title="Mapa base">
        <div className="segmented" role="radiogroup" aria-label="Estilo do mapa">
          {(["data", "classic"] as const).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={look === l} className={look === l ? "is-active" : ""} onClick={() => changeLook(l)}>
              {l === "data" ? "Para dados" : "Clássico"}
            </button>
          ))}
        </div>
        <div className="segmented" role="radiogroup" aria-label="Tema">
          {(["light", "dark"] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={theme === t} className={theme === t ? "is-active" : ""} onClick={() => changeTheme(t)}>
              <Icon name={t === "light" ? "sun" : "moon"} size={16} />
              {t === "light" ? "Claro" : "Escuro"}
            </button>
          ))}
        </div>
      </PanelCard>
      <PanelCard title="Visualização">
        <label className="toggle">
          <input type="checkbox" checked={columns3d} onChange={(e) => toggleColumns(e.target.checked)} />
          Seus dados em colunas 3D
        </label>
        <label className="toggle">
          <input type="checkbox" checked={paintBuildingsOn} onChange={(e) => setPaintBuildingsOn(e.target.checked)} />
          Acender prédios com os seus dados
        </label>
        {paintBuildingsOn && (
          <p className="hint left">
            {buildingResult ? `${int.format(buildingResult.features.length)} prédios acesos na tela` : "Aproxime até o nível da rua (zoom 14+). Por enquanto, prédios em 3D nas principais cidades."}
          </p>
        )}
      </PanelCard>
      <PanelCard title="Compartilhar">
        <p className="panel-text">O link leva a posição do mapa, as camadas visíveis, as da biblioteca (buscadas de novo na fonte) e a aparência.</p>
        <button type="button" className="btn btn-block" onClick={() => void copyShareLink()}>
          <Icon name="share" size={18} />
          Copiar link desta visão
        </button>
      </PanelCard>
    </Panel>
  );

  const panels: Record<PanelId, ReactNode> = { layers: layersPanel, add: addPanel, details: detailsPanel, settings: settingsPanel };

  return (
    <div className={`app theme-${theme}`}>
      <TopBar perspective={perspective} onPerspective={changePerspective} onShare={() => void copyShareLink()} widgetsOpen={widgetsOpen} onToggleWidgets={() => setWidgetsOpen((o) => !o)} measuring={measuring} onToggleMeasure={() => (measuring ? stopMeasure() : startMeasure())} />

      <MapTabs tabs={tabs} current={currentTab} onSelect={(id) => switchTab(id)} onNew={newTab} onClose={closeTab} onRename={renameTab} onMove={moveTab} onDuplicate={duplicateTab} onCloseOthers={closeOtherTabs} />

      <div className="workspace">
        <Rail panel={panel} onPanel={setPanel} badges={{ layers: [...active].length || undefined, details: pick ? 1 : undefined }} />
        {panel && panels[panel]}

        <main className="map-area">
          <div ref={containerRef} className="map" />
          <SearchBox search={search} onSelect={selectSearch} />
          {styleEditor}
          {!maquete && <MapLegend layers={legendLayers} />}
          <DropZone onFile={openImport} />
          {shareStatus && !maquete && (
            <div className="toast" role="status">
              <Icon name="share" size={18} />
              {shareStatus}
            </div>
          )}
          {map &&
            pick &&
            createPortal(
              <ErrorBoundary key={`${pick.lngLat[0]},${pick.lngLat[1]}`} fallback={() => <p className="map-popup-error">Não deu para mostrar os detalhes deste ponto.</p>}>
              <MapPopup
                map={map}
                pick={pick}
                datasets={datasetInfos}
                nearbySource={nearbySource}
                onDetails={showPickDetails}
                onStreetView={streetImageryEnabled ? openStreetView : undefined}
                onAdvanced={(p) => void startAdvanced(p)}
                userLayers={Object.entries(datasetInfos)
                  .filter(([id]) => active.has(datasetKey(id)))
                  .map(([id, info]) => ({ id, info, user: id !== PLACES.id && id !== CLIENT_DATASET.id }))}
              />
              </ErrorBoundary>,
              popupEl,
            )}
          {maquete && map && (
            <Suspense fallback={null}>
            <MaqueteView map={map} center={maquete.center} title={maquete.title} datasetIds={maquete.datasetIds} theme={`${theme}-${look}`} datasets={datasetInfos} placeFacts={placeFacts} radius={maquete.radius} onRadius={(r) => setMaquete((m) => (m ? { ...m, radius: r } : m))} onShare={() => void copyShareLink()} onClose={() => setMaquete(null)} />
            </Suspense>
          )}
          {closedTab && !shareStatus && (
            <div className="toast" role="status">
              <Icon name="map" size={18} />
              “{closedTab.tab.title}” fechado.
              <button type="button" className="link" onClick={reopenTab}>
                Reabrir
              </button>
            </div>
          )}
          {shareStatus && maquete && (
            <div className="toast toast-over" role="status">
              <Icon name="share" size={18} />
              {shareStatus}
            </div>
          )}
          {measuring && (
            <MeasurePanel
              state={measureState}
              mode={measureMode}
              onMode={changeMeasureMode}
              onUndo={() => map?.undoMeasure()}
              onClear={() => map?.clearMeasure()}
              onClose={stopMeasure}
            />
          )}
          {streetImageId && <StreetViewer imageId={streetImageId} onCamera={(c) => map?.setLocationMarker(c)} onClose={closeStreetView} />}
        </main>

        {widgetsOpen && <WidgetsPanel widgets={widgets} onClose={() => setWidgetsOpen(false)} />}
      </div>

      {libraryOpen && <LibraryPanel onClose={() => setLibraryOpen(false)} onAddLayer={addLibraryLayer} />}

      <input
        ref={reopenInput}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          const pending = pendingReopen.current;
          pendingReopen.current = null;
          if (file && pending) reopenDataset(pending.dataset, pending.mode, file);
        }}
      />
      {importJob && (
        <ErrorBoundary
          fallback={(e) => (
            <div className="wizard-backdrop" role="presentation">
              <div className="wizard wizard-crash" role="alertdialog" aria-labelledby="wizard-crash-title">
                <h2 id="wizard-crash-title">O assistente encontrou um erro</h2>
                <p className="muted">Nada foi alterado no mapa nem nos seus dados. Feche e tente de novo; se repetir, nos conte o que estava fazendo.</p>
                <p className="wizard-error">{e.message}</p>
                <button type="button" className="btn btn-primary" onClick={() => setImportJob(null)}>
                  Fechar
                </button>
              </div>
            </div>
          )}
        >
        <ImportWizard
          key={`${importJob.file.name}:${importJob.restore?.datasetId ?? ""}:${importJob.restore?.mode ?? ""}`}
          file={importJob.file}
          restore={importJob.restore}
          serverAvailable={server.available}
          onCancel={() => setImportJob(null)}
          onImport={finishImport}
          onSendToServer={(file, spec) => void sendToServer(file, spec)}
        />
        </ErrorBoundary>
      )}
    </div>
  );
}
