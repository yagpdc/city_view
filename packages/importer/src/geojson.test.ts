import { describe, expect, it } from "vitest";
import { detectColumns, geoJsonToRows, guessLocation } from "./index";

describe("geoJsonToRows", () => {
  it("pontos viram colunas de longitude/latitude detectáveis", () => {
    const r = geoJsonToRows({
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [-46.63, -23.55] }, properties: { nome: "A", tags: { x: 1 } } },
        { type: "Feature", geometry: null, properties: { nome: "B" } },
      ],
    });
    expect(r.rows[0]).toEqual({ nome: "A", tags: '{"x":1}', longitude: "-46.63", latitude: "-23.55" });
    expect(r.withoutGeometry).toBe(1);
    const loc = guessLocation(detectColumns(Object.keys(r.rows[0]!), r.rows));
    expect(loc).toMatchObject({ lat: "latitude", lon: "longitude" });
  });

  it("polígonos viram o centro da extensão; não sobrescreve propriedade 'latitude'", () => {
    const r = geoJsonToRows({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 4], [0, 4], [0, 0]]] },
      properties: { latitude: "x" },
    });
    expect(r.lat).toBe("latitude_2");
    expect(r.rows[0]).toMatchObject({ latitude: "x", longitude: "1", latitude_2: "2" });
    expect(r.converted).toBe(1);
  });

  it("recusa JSON que não é GeoJSON", () => {
    expect(() => geoJsonToRows({ foo: 1 })).toThrow();
  });
});
