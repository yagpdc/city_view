import type { Camera, Theme } from "@cityview/engine";
import { useEffect, useState } from "react";
import { Sidebar, SidebarSection } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { useCityMap } from "./useCityMap";

const INITIAL_CAMERA: Partial<Camera> = {
  center: [-46.6558, -23.5614], // Av. Paulista
  zoom: 15,
  pitch: 60,
  bearing: -20,
};

const isNarrowScreen = () => window.matchMedia("(max-width: 767px)").matches;

export function App() {
  const [sidebarOpen, setSidebarOpen] = useState(() => !isNarrowScreen());
  const [theme, setTheme] = useState<Theme>("light");
  const [terrain, setTerrain] = useState(true);
  const [buildings, setBuildings] = useState(true);
  const [camera, setCamera] = useState<Camera | null>(null);

  const { containerRef, map } = useCityMap({
    basemapUrl: `${location.origin}/data/sao-paulo.pmtiles`,
    terrainUrl: `${location.origin}/data/sao-paulo-terrain.pmtiles`,
    theme,
    camera: INITIAL_CAMERA,
    hash: true,
  });

  useEffect(() => map?.setTerrain(terrain), [map, terrain]);
  useEffect(() => map?.setBuildings3D(buildings), [map, buildings]);

  useEffect(() => {
    if (!map) return;
    // Câmera atualiza no máximo uma vez por frame, fora do ciclo do mapa.
    let frame = 0;
    const off = map.on("move", () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setCamera(map.camera));
    });
    setCamera(map.camera);
    return () => {
      off();
      cancelAnimationFrame(frame);
    };
  }, [map]);

  const changeTheme = (next: Theme) => {
    setTheme(next);
    map?.setTheme(next);
  };

  // TODO(fase 4): geocodificação local (Photon). Por enquanto a busca não faz nada.
  const search = (query: string) => console.info("[search]", query);

  return (
    <div className={`app theme-${theme} ${sidebarOpen ? "sidebar-open" : ""}`}>
      <TopBar sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((o) => !o)} onSearch={search} />

      <Sidebar open={sidebarOpen}>
        <SidebarSection title="Camadas">
          <label className="toggle">
            <input type="checkbox" checked={terrain} onChange={(e) => setTerrain(e.target.checked)} />
            Relevo 3D
          </label>
          <label className="toggle">
            <input type="checkbox" checked={buildings} onChange={(e) => setBuildings(e.target.checked)} />
            Prédios 3D
          </label>
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

        {camera && (
          <SidebarSection title="Câmera">
            <dl className="camera">
              <dt>Lon, Lat</dt>
              <dd>
                {camera.center[0].toFixed(5)}, {camera.center[1].toFixed(5)}
              </dd>
              <dt>Zoom</dt>
              <dd>{camera.zoom.toFixed(2)}</dd>
              <dt>Inclinação / Rumo</dt>
              <dd>
                {camera.pitch.toFixed(0)}° / {camera.bearing.toFixed(0)}°
              </dd>
            </dl>
          </SidebarSection>
        )}
      </Sidebar>

      <main className="map-area">
        <div ref={containerRef} className="map" />
      </main>
    </div>
  );
}
