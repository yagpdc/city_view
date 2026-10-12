import { describe, expect, it } from "vitest";
import { detectColumns } from "./detect";
import { profileColumn } from "./profile";
import { applyRecipe, columnsAfter, describeStep, type RecipeStep } from "./recipe";

const rows = [
  { loja: " Loja  A ", uf: "PR", cidade: "Curitiba/PR", valor: "R$ 1.234,56", nota: "73,4" },
  { loja: "Loja B", uf: "sp", cidade: "Campinas/SP", valor: "R$ 99", nota: "18,9" },
  { loja: "Loja C", uf: "SP", cidade: "Santos/SP", valor: "", nota: "55" },
];

describe("receita", () => {
  it("limpa, transforma e cria colunas em ordem", () => {
    const recipe: RecipeStep[] = [
      { op: "trim", column: "loja" },
      { op: "case", column: "uf", to: "upper" },
      { op: "split", column: "cidade", separator: "/", into: ["municipio", "uf_cidade"] },
      { op: "toNumber", column: "valor" },
      { op: "fillEmpty", column: "valor", value: "0" },
      { op: "round", column: "nota", multiple: 10 },
      { op: "bucket", column: "nota", edges: [30, 60], to: "faixa" },
      { op: "rules", to: "tag", rules: [{ when: [{ column: "uf", op: "=", value: "PR" }], match: "all", value: "Indústria" }], otherwise: "Varejo" },
      { op: "compute", to: "valor_mil", a: "valor", operator: "/", b: 1000 },
      { op: "rename", column: "loja", to: "nome" },
    ];
    const out = applyRecipe(rows, recipe);
    expect(out[0]).toMatchObject({ nome: "Loja A", uf: "PR", municipio: "Curitiba", uf_cidade: "PR", valor: "1234.56", nota: "70", faixa: "60 ou mais", tag: "Indústria", valor_mil: "1.23456" });
    expect(out[1]).toMatchObject({ uf: "SP", valor: "99", nota: "20", faixa: "até 30", tag: "Varejo" });
    expect(out[2]).toMatchObject({ valor: "0", nota: "60", faixa: "60 ou mais" });
    expect(rows[0]!.loja).toBe(" Loja  A "); // original intacto
    expect(columnsAfter(Object.keys(rows[0]!), recipe)).toEqual(["nome", "uf", "cidade", "valor", "nota", "municipio", "uf_cidade", "faixa", "tag", "valor_mil"]);
  });

  it("filtra linhas", () => {
    const out = applyRecipe(rows, [{ op: "filter", keep: true, when: [{ column: "uf", op: "in", values: ["SP", "sp"] }], match: "all" }]);
    expect(out.map((r) => r.loja)).toEqual(["Loja B", "Loja C"]);
  });

  it("descreve os passos em português", () => {
    expect(describeStep({ op: "round", column: "nota", multiple: 10 })).toBe('Arredondar "nota" para múltiplos de 10');
  });
});

describe("perfil da coluna", () => {
  it("acha grafias diferentes e sugere unificar", () => {
    const sample = [{ uf: "SP" }, { uf: "sp" }, { uf: "SP" }, { uf: "S.P." }, { uf: "PR" }];
    const [col] = detectColumns(["uf"], sample);
    const p = profileColumn(col!, sample);
    const grafias = p.problems.find((x) => x.id === "grafias");
    expect(grafias?.fix?.step).toEqual({ op: "replace", column: "uf", map: { sp: "SP", "S.P.": "SP" } });
  });

  it("acha moeda e mostra a distribuição dos números", () => {
    const sample = [{ v: "R$ 10" }, { v: "R$ 20,5" }, { v: "30" }];
    const [col] = detectColumns(["v"], sample);
    const p = profileColumn(col!, sample);
    expect(p.problems.map((x) => x.id)).toContain("moeda");
    expect(p.numeric).toMatchObject({ min: 10, max: 30, decimals: true });
  });
});
