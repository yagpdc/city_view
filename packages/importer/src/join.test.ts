import { describe, expect, it } from "vitest";
import { joinKey, joinStats, suggestAppendMap, suggestJoinKeys } from "./join";
import { applyRecipe, columnsAfter, type RecipeStep } from "./recipe";

const empresas = [
  { cnpj: "00.360.305/0001-04", nome: "Loja Sé" },
  { cnpj: "33000167000101", nome: "Loja Liberdade" },
  { cnpj: "60746948000112", nome: "Loja Bela Vista" },
  { cnpj: "", nome: "Sem CNPJ" },
];
// O Excel comeu o zero à esquerda do primeiro CNPJ; o segundo aparece duas vezes.
const locais = [
  { documento: "360305000104", lat: "-23.55", lon: "-46.63", vendas: "10" },
  { documento: "33.000.167/0001-01", lat: "-23.56", lon: "-46.64", vendas: "5" },
  { documento: "33000167000101", lat: "-23.57", lon: "-46.65", vendas: "7" },
];

describe("joinKey", () => {
  it("ignora pontuação, caixa, acentos e zeros à esquerda", () => {
    expect(joinKey("00.360.305/0001-04")).toBe(joinKey("360305000104"));
    expect(joinKey(" São Paulo ")).toBe(joinKey("SAO PAULO"));
    expect(joinKey("")).toBe("");
  });
});

describe("join", () => {
  const step: RecipeStep = {
    op: "join",
    source: "b",
    label: "locais.csv",
    key: "cnpj",
    otherKey: "documento",
    columns: [
      { from: "lat", to: "lat" },
      { from: "vendas", to: "vendas" },
    ],
    countAs: "qtd",
  };
  const ctx = { tables: { b: locais } };

  it("completa as linhas pela chave; sem par fica vazio", () => {
    const out = applyRecipe(empresas, [step], ctx);
    expect(out[0]).toMatchObject({ lat: "-23.55", vendas: "10", qtd: "1" });
    expect(out[1]).toMatchObject({ lat: "-23.56", qtd: "2" });
    expect(out[2]).toMatchObject({ lat: "", qtd: "0" });
    expect(columnsAfter(["cnpj", "nome"], [step])).toEqual(["cnpj", "nome", "lat", "vendas", "qtd"]);
  });

  it("soma os números quando há mais de um par", () => {
    const out = applyRecipe(empresas, [{ ...step, multiple: "sum" }], ctx);
    expect(out[1]!.vendas).toBe("12");
  });

  it("faz o balanço e sugere as colunas-chave", () => {
    expect(joinStats(empresas, "cnpj", locais, "documento")).toMatchObject({ total: 4, matched: 2, multiple: 1, emptyKey: 1 });
    expect(suggestJoinKeys(empresas, ["cnpj", "nome"], locais, ["documento", "lat", "lon", "vendas"])).toMatchObject({ key: "cnpj", otherKey: "documento" });
  });
});

describe("append", () => {
  it("acrescenta as linhas com as colunas alinhadas, e os passos seguintes valem para elas", () => {
    const outras = [{ Nome: "Loja Rio", latitude: "-22.9" }];
    const map = suggestAppendMap(["nome", "lat"], ["Nome", "latitude"]);
    expect(map).toEqual({ Nome: "nome", latitude: "lat" });
    const out = applyRecipe(
      [{ nome: "Loja Sé", lat: "-23.5" }],
      [{ op: "append", source: "c", label: "rio.csv", map }, { op: "case", column: "nome", to: "upper" }],
      { tables: { c: outras } },
    );
    expect(out.map((r) => r.nome)).toEqual(["LOJA SÉ", "LOJA RIO"]);
    expect(out[1]!.lat).toBe("-22.9");
  });
});
