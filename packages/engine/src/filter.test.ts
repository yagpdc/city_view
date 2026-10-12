import { describe, expect, it } from "vitest";
import { cleanWhere, matchesWhere } from "./filter";

describe("matchesWhere", () => {
  const row = { area: 120, nome: "Farmácia São João", vazio: null };

  it("faixa numérica inclui as pontas e recusa sem valor", () => {
    expect(matchesWhere(row, { area: { gte: 120, lte: 200 } })).toBe(true);
    expect(matchesWhere(row, { area: { gte: 121 } })).toBe(false);
    expect(matchesWhere(row, { vazio: { gte: 0 } })).toBe(false);
  });

  it("texto contém ignora maiúsculas e acentos", () => {
    expect(matchesWhere(row, { nome: { contains: "sao joao" } })).toBe(true);
    expect(matchesWhere(row, { nome: { contains: "drogaria" } })).toBe(false);
  });
});

describe("cleanWhere", () => {
  it("tira condições vazias", () => {
    expect(cleanWhere({ a: { contains: "  " }, b: { gte: Number.NaN } })).toBeNull();
    expect(cleanWhere({ a: { contains: " x ", gte: 1 } })).toEqual({ a: { contains: "x", gte: 1 } });
  });
});
