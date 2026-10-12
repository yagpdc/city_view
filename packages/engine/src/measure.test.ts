import { describe, expect, it } from "vitest";
import { geodesicDistanceM } from "./geo";
import { formatArea, formatDistance, lineLengthM, polygonMeasure } from "./measure";

describe("medição no elipsoide", () => {
  it("comprimento bate com a soma das geodésicas (Vincenty) e com o grau de latitude no equador", () => {
    expect(lineLengthM([[0, 0], [0, 1]])).toBeCloseTo(110574.389, 2);
    const route: [number, number][] = [[-46.6333, -23.5505], [-46.6558, -23.5614], [-46.6911, -23.5874]];
    const vincenty = geodesicDistanceM(route[0]!, route[1]!) + geodesicDistanceM(route[1]!, route[2]!);
    expect(lineLengthM(route)).toBeCloseTo(vincenty, 3);
  });

  it("área de 1° × 1° no equador ≈ 12.308 km² (WGS84), independente do sentido", () => {
    const square: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const { areaM2, perimeterM } = polygonMeasure(square);
    expect(areaM2 / 1e6).toBeCloseTo(12308.78, 0);
    expect(polygonMeasure([...square].reverse()).areaM2).toBeCloseTo(areaM2, 0);
    expect(perimeterM).toBeGreaterThan(440_000);
  });

  it("menos de 3 pontos não tem área", () => {
    expect(polygonMeasure([[0, 0], [1, 0]]).areaM2).toBe(0);
  });

  it("formata em pt-BR com a unidade que faz sentido", () => {
    expect(formatDistance(850)).toBe("850 m");
    expect(formatDistance(12_400)).toBe("12,4 km");
    expect(formatArea(640)).toBe("640 m²");
    expect(formatArea(32_000)).toBe("3,2 ha");
    expect(formatArea(12_400_000)).toBe("12,4 km²");
  });
});
