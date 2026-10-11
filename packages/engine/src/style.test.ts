import { describe, expect, it } from "vitest";
import { BUILDINGS_3D_LAYER, TERRAIN_SOURCE, buildStyle } from "./style";

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

  it("só adiciona relevo quando há URL", () => {
    expect(buildStyle({ basemapUrl: "x" }).sources[TERRAIN_SOURCE]).toBeUndefined();
    expect(buildStyle({ basemapUrl: "x", terrainUrl: "/t.pmtiles" }).sources[TERRAIN_SOURCE]).toMatchObject({
      type: "raster-dem",
      encoding: "terrarium",
    });
  });
});
