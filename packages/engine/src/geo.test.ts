import { describe, expect, it } from "vitest";
import { areaBounds, circleArea, pointInArea, ringCentroid, worldMask, type AreaGeometry } from "./geo";

const square: AreaGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
    [
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
      [4, 4],
    ],
  ],
};

describe("geo", () => {
  it("ponto dentro respeita buracos", () => {
    expect(pointInArea([1, 1], square)).toBe(true);
    expect(pointInArea([5, 5], square)).toBe(false);
    expect(pointInArea([11, 5], square)).toBe(false);
  });

  it("limites e centroide", () => {
    expect(areaBounds(square)).toEqual([0, 0, 10, 10]);
    expect(ringCentroid(square.coordinates[0]!)).toEqual([5, 5]);
  });

  it("círculo de 10 km tem ~0,09° de raio em latitude", () => {
    const c = circleArea([-46.63, -23.55], 10);
    const [, s, , n] = areaBounds(c);
    expect((n - s) / 2).toBeCloseTo(10 / 111.2, 2);
    expect(pointInArea([-46.63, -23.55], c)).toBe(true);
    expect(pointInArea([-46.4, -23.55], c)).toBe(false);
  });

  it("máscara do mundo tem a área como buraco", () => {
    const mask = worldMask(square);
    expect(mask.geometry.type).toBe("Polygon");
    expect(mask.geometry.coordinates).toHaveLength(2);
  });
});
