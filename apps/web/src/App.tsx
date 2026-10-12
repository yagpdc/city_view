import type { AreaSummary, BasemapLook, BuildingPaintResult, DatasetMeta, MapPick, Theme } from "@cityview/engine";
import { CATEGORY_COLORS, categoryColor, geodesicDistanceM, normalizeText } from "@cityview/engine";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { areaAt, parseCoordinates, radiusArea, searchMunicipios, type Area } from "./areas";
import { SearchBox, type SearchResult } from "./components/SearchBox";
import { CategoryLegend, LayerCard, Panel, PanelCard, Rail, ScaleLegend, type LayerAction, type PanelId } from "./components/Shell";
import { WidgetsPanel, type ViewportWidget } from "./components/WidgetsPanel";
import { Icon } from "./components/Icon";
import { AddRow, DatapackMeta } from "./components/AddRow";
import { MeasurePanel } from "./components/MeasurePanel";
import type { MeasureMode, MeasureState } from "@cityview/engine";
import type { Comparison } from "./compare";
import { DATAPACKS, OBJECTIVES, dataUrl, type Objective } from "./catalog";
import { DioramaPanel, type AreaChoice } from "./components/DioramaPanel";
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
import { DropZone } from "./import/DropZone";
import "./import/import.css";
import { ImportWizard, type ImportedDataset } from "./import/ImportWizard";
import { ACCEPTED_EXTENSIONS } from "./import/protocol";
import { serverApi, type ImportSpec, type ServerDataset } from "./server/api";
import { useServerDatasets } from "./server/useServerDatasets";
import { deleteLibraryLayer, listLibraryLayers, loadActiveLayers, saveActiveLayers, saveLibraryLayer } from "./storage/datasets";
import { useUserDatasets, type UserDataset } from "./storage/useUserDatasets";
import { useCityMap } from "./useCityMap";

const CLIENT_DATASET = { id: "empresas", name: "Exemplo: 30 milhões de registros", url: "/data/empresas/tiles.pmtiles" };
const DATASET_KEY = `dataset:${CLIENT_DATASET.id}`;
/** Lugares do Overture Maps gerados por `pnpm places` (Brasil inteiro ou só a Grande SP). */
const PLACES = { id: "lugares", name: "Lugares (Overture Maps)", areas: ["brasil", "sao-paulo"] };
const PLACES_KEY = `dataset:${PLACES.id}`;
/** Camada de cobertura das fotos de rua (Mapillary). */
const STREET_KEY = "overlay:mapillary";
const PLACES_ATTRIBUTION = '<a href="https://docs.overturemaps.org/attribution/">Lugares: Overture Maps Foundation</a>';
/** Chave de visibilidade de um dataset vetorial (o exemplo e os lugares usam o prefixo "dataset:"). */
const datasetKey = (id: string) => (id === CLIENT_DATASET.id ? DATASET_KEY : id === PLACES.id ? PLACES_KEY : id);
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

/** Estado de um link compartilhado, lido uma vez ao abrir. */
const SHARED = readShared();

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
const HIDDEN_KEY = "cityview.hidden-layers";
function loadHiddenLayers(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
const FILTERS_KEY = "cityview.category-filters";
/** Filtro de categorias por camada (id da camada no mapa → índices visíveis). */
type CategoryFilters = Record<string, number[]>;
function loadFilters(): CategoryFilters {
  try {
    return JSON.parse(localStorage.getItem(FILTERS_KEY) ?? "{}") as CategoryFilters;
  } catch {
    return {};
  }
}
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
  const [hidden, setHidden] = useState<Set<string>>(loadHiddenLayers);
  const [filters, setFilters] = useState<CategoryFilters>(loadFilters);
  const [widgetsOpen, setWidgetsOpen] = useState(() => window.innerWidth >= 1280);
  const [widgets, setWidgets] = useState<ViewportWidget[]>([]);
  const [perspective, setPerspective] = useState<"2d" | "3d">("2d");
  const [measuring, setMeasuring] = useState(false);
  const [measureMode, setMeasureMode] = useState<MeasureMode>("distance");
  const [measureState, setMeasureState] = useState<MeasureState | null>(null);
  const [theme, setTheme] = useState<Theme>(SHARED?.theme ?? "light");
  const [look, setLook] = useState<BasemapLook>(SHARED?.look ?? "data");
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [columns3d, setColumns3d] = useState(false);
  const [municipios3d, setMunicipios3d] = useState(false);
  const [diorama, setDiorama] = useState<Diorama | null>(null);
  const [comparisonId, setComparisonId] = useState("populacao");
  const [paintBuildingsOn, setPaintBuildingsOn] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryLayers, setLibraryLayers] = useState<LibraryLayer[]>([]);
  const [buildingResult, setBuildingResult] = useState<BuildingPaintResult | null>(null);
  const [objective, setObjective] = useState<string | null>(null);
  const [active, setActive] = useState<Set<string>>(() => (SHARED?.layers ? new Set(SHARED.layers) : loadActiveLayers()));
  const [demoMeta, setDemoMeta] = useState<DatasetMeta | null>(null);
  const [places, setPlaces] = useState<{ meta: DatasetMeta; release: string; area: string } | null>(null);
  const [serverMetas, setServerMetas] = useState<Record<string, DatasetMeta>>({});
  const [pick, setPick] = useState<MapPick | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
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
    basemapUrl: `${location.origin}/data/brasil.pmtiles`,
    // Locais com `pnpm assets`; sem eles o servidor de dev redireciona para o Protomaps.
    assetsUrl: `${location.origin}/data/assets`,
    terrain: false,
    look,
    // Prédios 3D vêm do extrato detalhado (Grande SP); o mapa do Brasil vai só até z12.
    buildingsUrl: `${location.origin}/data/sao-paulo.pmtiles`,
    theme,
    camera: { ...EXPLORE.camera, pitch: 0, bearing: 0 },
    hash: CAMERA_PARAM,
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
    // Lugares: o recorte mais amplo que tiver sido gerado.
    void (async () => {
      for (const area of PLACES.areas) {
        // Arquivo ausente: o Vite responde a página HTML com 200, então confere o tipo.
        const info = (await fetch(`/data/places/${area}.release.json`)
          .then((r) => (r.ok && r.headers.get("content-type")?.includes("json") ? r.json() : null))
          .catch(() => null)) as { release: string } | null;
        if (!info) continue;
        const layer = await map.addDataset(PLACES.id, `${location.origin}/data/places/${area}/tiles.pmtiles`, {
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
      if (active.has(d.id)) map.showCatalogLayer(d.manifest, d.dataUrl);
      else map.hideCatalogLayer(d.id);
    }
    for (const l of libraryLayers) {
      if (active.has(l.manifest.id)) map.showCatalogLayer(l.manifest, l.data as never);
      else map.hideCatalogLayer(l.manifest.id);
    }
  }, [map, active, demoMeta, places, serverMetas, user.datasets, libraryLayers]);

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
    const url = shareUrl({ layers: shareable, lib, theme, look });
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

  useEffect(() => saveActiveLayers(active), [active]);
  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
    } catch {
      // Modo privado: segue sem lembrar.
    }
  }, [filters]);
  // Filtros lembrados valem assim que o mapa existe (o motor guarda até a camada carregar).
  useEffect(() => {
    if (!map) return;
    for (const [id, categories] of Object.entries(loadFilters())) map.setCategoryFilter(id, categories);
  }, [map]);
  const setCategoryFilter = (id: string, categories: number[] | null) => {
    map?.setCategoryFilter(id, categories);
    setFilters((prev) => {
      const { [id]: _, ...rest } = prev;
      return categories ? { ...rest, [id]: categories } : rest;
    });
  };
  useEffect(() => {
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
    } catch {
      // Modo privado: segue sem lembrar.
    }
  }, [hidden]);
  // O aviso de "link copiado" some sozinho.
  useEffect(() => {
    if (!shareStatus) return;
    const t = window.setTimeout(() => setShareStatus(null), 6000);
    return () => window.clearTimeout(t);
  }, [shareStatus]);

  // Prédios dos seus dados: o dataset da maquete ou o primeiro dos seus dados que estiver ligado.
  const paintTarget = diorama?.datasetId
    ?? (active.has(DATASET_KEY) && demoMeta
      ? CLIENT_DATASET.id
      : (Object.keys(serverMetas).find((id) => active.has(id)) ?? (active.has(PLACES_KEY) && places ? PLACES.id : undefined)));
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
    return infos;
  }, [demoMeta, places, server.datasets, serverMetas]);

  useEffect(() => {
    if (!map || !widgetsOpen) return;
    const sources = [
      demoMeta && active.has(DATASET_KEY) ? CLIENT_DATASET.id : null,
      places && active.has(PLACES_KEY) ? PLACES.id : null,
      ...Object.keys(serverMetas).filter((id) => active.has(id)),
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
            .filter((b) => b.n > 0 && (!filters[id] || filters[id]!.includes(b.i)))
            .sort((a, b) => b.n - a.n);
          return [{ key: id, title: info.name, count: summary.count, mode: summary.mode, bars, filtered: filters[id]?.length }];
        }),
      );
    compute();
    return map.onViewChange(compute);
  }, [map, widgetsOpen, active, demoMeta, places, serverMetas, datasetInfos, filters]);

  const nearbySource: NearbySource | null =
    places && datasetInfos[PLACES.id] ? { datasetId: PLACES.id, name: "Lugares", info: datasetInfos[PLACES.id]!, categories: filters[PLACES.id] ?? null } : null;


  const openImport = useCallback((file: File) => setImportFile(file), []);

  const finishImport = (dataset: ImportedDataset) => {
    setImportFile(null);
    void user.add({ id: dataset.manifest.id, ...dataset, createdAt: Date.now() });
    setActive((prev) => new Set(prev).add(dataset.manifest.id));
    setPanel("layers");
    map?.fitBounds(dataset.bounds);
  };

  const sendToServer = async (file: File, spec: ImportSpec) => {
    setImportFile(null);
    setPanel("layers");
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

  /** Olho do cartão / adicionar: visível ↔ escondida (a camada continua no projeto). */
  const toggle = (id: string, on: boolean) => {
    setObjective(null);
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
    if (measuring) stopMeasure();
    const exaggeration = diorama?.exaggeration ?? 1.8;
    setDiorama({ datasetId, lngLat, area, areaChoice, summary: null, columns: diorama?.columns ?? false, exaggeration, orbiting: false });
    setActive((prev) => new Set(prev).add(datasetKey(datasetId)));
    if (isNarrowScreen()) setPanel(null);
    await map.enterDiorama(area.geometry, {
      datasetId,
      maxZoom: area.kind === "raio" && (area.radiusKm ?? 10) <= 1 ? 16.5 : 13.5,
      exaggeration,
      columns: diorama?.columns ?? false,
      // Na tela larga, o painel ocupa a esquerda do mapa.
      padding: isNarrowScreen() ? 40 : { top: 50, bottom: 50, left: 360, right: 50 },
      onSummary: (summary) => setDiorama((d) => (d && d.area === area ? { ...d, summary } : d)),
    });
    map.startOrbit(4, orbitStopped);
    setDiorama((d) => (d && d.area === area ? { ...d, orbiting: true } : d));
  };

  /** A pessoa mexeu no mapa: a câmera para de girar e o controle desmarca. */
  const orbitStopped = () => setDiorama((d) => (d ? { ...d, orbiting: false } : d));

  const startAdvanced = async (p: MapPick) => {
    if (!p.dataset) return;
    const area = await areaAt(p.lngLat);
    void openDiorama(p.dataset.datasetId, p.lngLat, area, area.kind === "municipio" ? "municipio" : 5);
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
    if (on) map?.startOrbit(4, orbitStopped);
    else map?.stopOrbit();
    setDiorama((d) => (d ? { ...d, orbiting: on } : d));
  };

  const setExaggeration = (value: number) => {
    map?.setTerrainExaggeration(value);
    setDiorama((d) => (d ? { ...d, exaggeration: value } : d));
  };

  /** Grandezas do município da maquete: população (IBGE) + camadas da biblioteca no mapa. */
  const comparisons = useMemo<Comparison[]>(() => {
    const area = diorama?.area;
    if (!area || area.kind !== "municipio" || !area.code) return [];
    const list: Comparison[] = [];
    if (area.population) list.push({ id: "populacao", label: "População (IBGE 2022)", unit: "pessoas", value: area.population });
    for (const layer of libraryLayers) {
      const feature = (layer.data.features as { properties: { codigo: string | number; valor: number } }[]).find(
        (f) => String(f.properties.codigo) === area.code,
      );
      if (feature) list.push({ id: layer.manifest.id, label: `${layer.variable} · ${layer.period}`, unit: layer.unit, value: feature.properties.valor });
    }
    return list;
  }, [diorama?.area, libraryLayers]);

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
        items={info.categories.map((c, i) => ({ label: info.label ? info.label(c) : c, color: categoryColor(i, info.categories) }))}
        selected={filters[id] ?? null}
        onChange={(categories) => setCategoryFilter(id, categories)}
      />
    );
  };
  const datasetOptions = (
    <div className="layer-options">
      <button type="button" className={`chip-toggle ${columns3d ? "is-on" : ""}`} aria-pressed={columns3d} onClick={() => toggleColumns(!columns3d)}>
        <Icon name="box3d" size={16} />
        Colunas 3D
      </button>
      <button type="button" className={`chip-toggle ${paintBuildingsOn ? "is-on" : ""}`} aria-pressed={paintBuildingsOn} onClick={() => setPaintBuildingsOn(!paintBuildingsOn)}>
        <Icon name="pin" size={16} />
        Prédios acesos
      </button>
    </div>
  );
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
        <LayerCard badge={badge} tone={tone} title={d.name} origin="user" meta={meta} visible={active.has(d.id)} onVisible={d.status === "ready" ? (v) => toggle(d.id, v) : undefined} actions={actions} status={working ? "working" : d.status === "error" ? "error" : undefined} progress={working ? d.progress : undefined}>
          {datasetLegend(d.id)}
          {datasetOptions}
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
          actions={[
            { label: "Enquadrar no mapa", icon: "frame", onClick: () => focusUserDataset(d) },
            { label: "Renomear", icon: "rename", onClick: () => renameUserDataset(d.id) },
            { label: "Tirar do mapa", icon: "eyeOff", onClick: () => removeFromMap(d.id) },
            { label: "Apagar deste navegador", icon: "trash", onClick: () => removeUserDataset(d.id), danger: true },
          ]}
        >
          {r.type === "points" && r.colorBy ? (
            <CategoryLegend
              items={r.colorBy.categories.map((c, i) => ({ label: c, color: r.colorBy!.colors[i] ?? r.color }))}
              selected={filters[d.id] ?? null}
              onChange={(categories) => setCategoryFilter(d.id, categories)}
            />
          ) : (
            <CategoryLegend items={[{ label: "Registros", color: r.type === "points" ? r.color : "#6b7485" }]} />
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
          title="Lugares"
          origin="public"
          meta={<>Overture Maps · <span className="num">{int.format(places.meta.records)}</span> · versão {places.release}</>}
          visible={active.has(PLACES_KEY)}
          onVisible={(v) => toggle(PLACES_KEY, v)}
          actions={[
            { label: "Sobre a fonte", icon: "external", onClick: () => window.open("https://docs.overturemaps.org/attribution/", "_blank", "noreferrer") },
            { label: "Tirar do mapa", icon: "eyeOff", onClick: () => removeFromMap(PLACES_KEY) },
          ]}
        >
          {datasetLegend(PLACES.id)}
          {datasetOptions}
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
          actions={[{ label: "Tirar do mapa", icon: "eyeOff", onClick: () => removeFromMap(DATASET_KEY) }]}
        >
          {datasetLegend(CLIENT_DATASET.id)}
          {datasetOptions}
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
            title="Lugares"
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

  const explorePanel = (
    <Panel title="Explorar" onClose={() => setPanel(null)}>
      <PanelCard title="Pontos de partida">
        <p className="panel-text">Cada um liga as camadas certas e leva o mapa até a região.</p>
        <div className="objectives">
          {OBJECTIVES.map((o) => (
            <button key={o.id} type="button" className={`objective ${objective === o.id ? "is-active" : ""}`} onClick={() => chooseObjective(o)} title={o.description}>
              <strong>{o.name}</strong>
              <span>{o.description}</span>
            </button>
          ))}
        </div>
      </PanelCard>
      <PanelCard title="Visualização avançada">
        <p className="panel-text">Clique nos seus dados no mapa e escolha "Maquete 3D" para ver a área em relevo, com colunas e prédios acesos.</p>
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
            {buildingResult ? `${int.format(buildingResult.features.length)} prédios acesos na tela` : "Aproxime até o nível da rua (zoom 14+). Por enquanto, prédios só na Grande SP."}
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

  const panels: Record<PanelId, ReactNode> = { layers: layersPanel, add: addPanel, explore: explorePanel, details: detailsPanel, settings: settingsPanel };

  return (
    <div className={`app theme-${theme}`}>
      <TopBar perspective={perspective} onPerspective={changePerspective} onShare={() => void copyShareLink()} widgetsOpen={widgetsOpen} onToggleWidgets={() => setWidgetsOpen((o) => !o)} measuring={measuring} onToggleMeasure={() => (measuring ? stopMeasure() : startMeasure())} />

      <div className="workspace">
        <Rail panel={panel} onPanel={setPanel} badges={{ layers: [...active].length || undefined, details: pick ? 1 : undefined }} />
        {panel && panels[panel]}

        <main className="map-area">
          <div ref={containerRef} className="map" />
          <SearchBox search={search} onSelect={selectSearch} />
          <DropZone onFile={openImport} />
          {shareStatus && (
            <div className="toast" role="status">
              <Icon name="share" size={18} />
              {shareStatus}
            </div>
          )}
          {map &&
            pick &&
            createPortal(
              <MapPopup
                map={map}
                pick={pick}
                datasets={datasetInfos}
                nearbySource={nearbySource}
                onDetails={showPickDetails}
                onStreetView={streetImageryEnabled ? openStreetView : undefined}
                onAdvanced={(p) => void startAdvanced(p)}
              />,
              popupEl,
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
          {diorama && (
            <DioramaPanel
              area={diorama.area}
              areaChoice={diorama.areaChoice}
              dataset={datasetInfos[diorama.datasetId]}
              summary={diorama.summary}
              columns={diorama.columns}
              exaggeration={diorama.exaggeration}
              orbiting={diorama.orbiting}
              comparisons={comparisons}
              comparisonId={comparisonId}
              onComparison={setComparisonId}
              buildings={paintBuildingsOn}
              buildingResult={buildingResult}
              onBuildings={setPaintBuildingsOn}
              onAreaChoice={(c) => {
                // Nível da rua: liga os prédios dos dados por padrão.
                if (c === 0.5 || c === 1) setPaintBuildingsOn(true);
                void changeDioramaArea(c);
              }}
              onColumns={toggleDioramaColumns}
              onExaggeration={setExaggeration}
              onOrbit={setOrbit}
              onExit={exitDiorama}
            />
          )}
        </main>

        {widgetsOpen && <WidgetsPanel widgets={widgets} onClose={() => setWidgetsOpen(false)} />}
      </div>

      {libraryOpen && <LibraryPanel onClose={() => setLibraryOpen(false)} onAddLayer={addLibraryLayer} />}

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
