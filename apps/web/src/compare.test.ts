import { describe, expect, it } from "vitest";
import { ratio } from "./compare";

describe("ratio", () => {
  it("população: registros por 1.000 pessoas", () => {
    const r = ratio(1_926_827, { id: "p", label: "População", unit: "pessoas", value: 11_451_999 })!;
    expect(r.per).toBe("por 1.000 pessoas");
    expect(r.value).toBeCloseTo(168.25, 1);
  });

  it("PIB em mil reais vira reais e escala em milhões", () => {
    // 1.000 registros / R$ 700 bilhões (700.000.000 mil reais) → 1,43 por R$ 1 bilhão
    const r = ratio(1000, { id: "pib", label: "PIB", unit: "Mil Reais", value: 700_000_000 })!;
    expect(r.per).toBe("por R$ 1 bilhão");
    expect(r.value).toBeCloseTo(1.43, 2);
  });

  it("valores grandes ficam sem escala", () => {
    const r = ratio(5000, { id: "d", label: "Área", unit: "km²", value: 10 })!;
    expect(r.per).toBe("por 1 km²");
    expect(r.value).toBe(500);
  });

  it("sem valor ou sem registros: nada a mostrar", () => {
    expect(ratio(10, { id: "x", label: "x", unit: "", value: 0 })).toBeNull();
    expect(ratio(0, { id: "x", label: "x", unit: "", value: 10 })).toBeNull();
  });
});
