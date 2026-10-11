import type { Camera, Theme } from "@cityview/engine";
import { useEffect, useState } from "react";
import { useCityMap } from "./useCityMap";

const INITIAL_CAMERA: Partial<Camera> = {
  center: [-46.6558, -23.5614], // Av. Paulista
  zoom: 15,
  pitch: 60,
  bearing: -20,
};

export function App() {
  const [theme, setTheme] = useState<Theme>("light");
  const [terrain, setTerrain] = useState(true);
  const [buildings, setBuildings] = useState(true);
  const [camera, setCamera] = useState<Camera | null>(null);

  const { containerRef, map } = useCityMap({
    basemapUrl: `${location.origin}/data/sao-paulo.pmtiles`,
    terrainUrl: `${location.origin}/data/sao-paulo-terrain.pmtiles`,
    theme,
    camera: INITIAL_CAMERA,
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

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    map?.setTheme(next);
  };

  return (
    <div className={`app theme-${theme}`}>
      <div ref={containerRef} className="map" />
      <aside className="panel">
        <h1>City View</h1>
        <label>
          <input type="checkbox" checked={terrain} onChange={(e) => setTerrain(e.target.checked)} />
          Relevo 3D
        </label>
        <label>
          <input type="checkbox" checked={buildings} onChange={(e) => setBuildings(e.target.checked)} />
          Prédios 3D
        </label>
        <button type="button" onClick={toggleTheme}>
          Tema {theme === "light" ? "escuro" : "claro"}
        </button>
        {camera && (
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
        )}
      </aside>
    </div>
  );
}
