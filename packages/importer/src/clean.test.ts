import { describe, expect, it } from "vitest";
import { detectHeaderRow, normalizeCep, parseBoolean, parseLooseDate, parseLooseNumber, uniqueHeaders } from "./clean";
import { applyCoordinateFix, parseCoordinate, splitLatLon, suggestCoordinateFix } from "./coords";

describe("números de planilha", () => {
  it.each([
    ["R$ 1.234,56", "br", 1234.56],
    ["R$ 1,2 mil", "br", 1200],
    ["3,5 mi", "br", 3_500_000],
    ["(1.234,00)", "br", -1234],
    ["12 %", "br", 12],
    ["1 234,5", "br", 1234.5],
    ["2 bilhões", "br", 2e9],
  ] as const)("%s → %d", (raw, locale, expected) => {
    expect(parseLooseNumber(raw, locale)).toBeCloseTo(expected);
  });
  it("texto não vira número", () => {
    expect(parseLooseNumber("milho")).toBeNull();
    expect(parseLooseNumber("São Paulo")).toBeNull();
  });
});

describe("booleanos, CEP e datas", () => {
  it("sim/não", () => {
    expect(parseBoolean("Sim")).toBe(true);
    expect(parseBoolean("N")).toBe(false);
    expect(parseBoolean("talvez")).toBeNull();
  });
  it("CEP sem zero à esquerda", () => {
    expect(normalizeCep("1310200")).toBe("01310-200");
    expect(normalizeCep("01310-200")).toBe("01310-200");
    expect(normalizeCep(1310200)).toBe("01310-200");
    expect(normalizeCep("123")).toBeNull();
  });
  it("datas em vários formatos", () => {
    const d = (y: number, m: number, day: number) => Date.UTC(y, m - 1, day);
    expect(parseLooseDate("01/03/2024")).toBe(d(2024, 3, 1));
    expect(parseLooseDate("1/3/24")).toBe(d(2024, 3, 1));
    expect(parseLooseDate("2024/03/01")).toBe(d(2024, 3, 1));
    expect(parseLooseDate("31/02/2024")).toBeNull();
    expect(parseLooseDate("45352", true)).toBe(d(2024, 3, 1));
    expect(parseLooseDate("45352")).toBeNull();
  });
});

describe("coordenadas", () => {
  it("graus/minutos/segundos e hemisfério", () => {
    expect(parseCoordinate(`23°33'01"S`)).toBeCloseTo(-23.55028, 4);
    expect(parseCoordinate("46° 38' 02\" W")).toBeCloseTo(-46.63389, 4);
    expect(parseCoordinate("23 33 01 S")).toBeCloseTo(-23.55028, 4);
    expect(parseCoordinate("46,65 O")).toBeCloseTo(-46.65);
    expect(parseCoordinate("S 23.55")).toBeCloseTo(-23.55);
    expect(parseCoordinate("-23,55", "br")).toBeCloseTo(-23.55);
    expect(parseCoordinate("Rua A")).toBeNull();
  });
  it("as duas numa coluna só", () => {
    expect(splitLatLon("-23.55, -46.63")).toEqual([-23.55, -46.63]);
    expect(splitLatLon("(-23,55; -46,63)")).toEqual([-23.55, -46.63]);
    expect(splitLatLon("-23.55 -46.63")).toEqual([-23.55, -46.63]);
    expect(splitLatLon("POINT(-46.63 -23.55)")).toEqual([-23.55, -46.63]);
    expect(splitLatLon("São Paulo")).toBeNull();
  });
  it("sugere trocar colunas invertidas", () => {
    const pairs: [number, number][] = [[-46.6, -23.5], [-43.2, -22.9], [-49.3, -25.4]];
    const fix = suggestCoordinateFix(pairs);
    expect(fix).toEqual({ kind: "swap" });
    expect(applyCoordinateFix(fix, -46.6, -23.5)).toEqual([-23.5, -46.6]);
  });
  it("sugere colocar o ponto decimal", () => {
    const pairs: [number, number][] = [[-2355052, -4663331], [-2290000, -4320000]];
    expect(suggestCoordinateFix(pairs)).toEqual({ kind: "scale", divisor: 100000 });
  });
  it("não mexe no que já está certo", () => {
    expect(suggestCoordinateFix([[-23.5, -46.6], [-22.9, -43.2]])).toEqual({ kind: "none" });
  });
});

describe("cabeçalho", () => {
  it("acha o cabeçalho abaixo do título", () => {
    const lines = [
      ["Relatório de lojas", "", ""],
      ["Emitido em 01/10/2026", "", ""],
      ["", "", ""],
      ["Loja", "Cidade", "Faturamento"],
      ["A", "São Paulo", "100"],
      ["B", "Campinas", "200"],
      ["C", "Santos", "300"],
    ];
    expect(detectHeaderRow(lines)).toBe(3);
  });
  it("cabeçalho na primeira linha", () => {
    expect(detectHeaderRow([["a", "b"], ["1", "2"], ["3", "4"]])).toBe(0);
  });
  it("nomes únicos", () => {
    expect(uniqueHeaders(["valor", "", "valor", "﻿id"])).toEqual(["valor", "coluna_2", "valor_2", "id"]);
  });
});
