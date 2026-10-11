import { describe, expect, it } from "vitest";
import { BUILDINGS_3D_LAYER, HILLSHADE_LAYER, PUBLIC_DEM_TILES, TERRAIN_SOURCE, buildStyle } from "./style";

describe("buildStyle", () => {
  it("usa PMTiles local como fonte do mapa base", () => {
    const style = buildStyle({ basemapUrl: "/data/sp.pmtiles" });
    expect(style.sources.basemap).toMatchObject({ type: "vector", url: "pmtiles:///data/sp.pmtiles" });
  });

  it("troca os prédios 2D por extrusão 3D antes dos rótulos", () => {
    const { layers } = buildStyle({ basemapUrl: "x" });
    const ids = layers.map((l) => l.id);
    expect(ids).not.toContain("buildings");
    const idx = ids.indexOf(BUILDINGS_3D_LAYER);
    expect(idx).toBeGreaterThan(-1);
    expect(layers.slice(idx + 1).some((l) => l.type === "symbol")).toBe(true);
    expect(layers.slice(0, idx).some((l) => l.type === "symbol")).toBe(false);
  });

  it("relevo: tiles públicos por padrão, PMTiles local quando informado", () => {
    expect(buildStyle({ basemapUrl: "x" }).sources[TERRAIN_SOURCE]).toMatchObject({
      type: "raster-dem",
      tiles: [PUBLIC_DEM_TILES],
    });
    expect(buildStyle({ basemapUrl: "x", terrainUrl: "/t.pmtiles" }).sources[TERRAIN_SOURCE]).toMatchObject({
      url: "pmtiles:///t.pmtiles",
      encoding: "terrarium",
    });
  });

  it("relevo sombreado fica abaixo da água e das estradas", () => {
    const ids = buildStyle({ basemapUrl: "x" }).layers.map((l) => l.id);
    expect(ids.indexOf(HILLSHADE_LAYER)).toBeLessThan(ids.indexOf("water"));
    expect(buildStyle({ basemapUrl: "x", hillshade: false }).layers.map((l) => l.id)).not.toContain(HILLSHADE_LAYER);
  });

  it("globo e céu ligados por padrão", () => {
    const style = buildStyle({ basemapUrl: "x" });
    expect(style.projection).toMatchObject({ type: "globe" });
    expect(style.sky).toBeDefined();
    expect(buildStyle({ basemapUrl: "x", globe: false }).projection).toBeUndefined();
  });
});
