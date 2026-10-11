import { describe, expect, it } from "vitest";
import { buildFeatures, detectColumns, guessLocation, guessStyleColumns, parseDate, parseNumber, type Row } from "./index";

describe("parseNumber", () => {
  it("aceita formatos brasileiros e internacionais", () => {
    expect(parseNumber("-23.5505")).toBe(-23.5505);
    expect(parseNumber("-23,5505")).toBe(-23.5505);
    expect(parseNumber("1.234,56")).toBe(1234.56);
    expect(parseNumber("1,234.56")).toBe(1234.56);
    expect(parseNumber("R$ 1.500", "br")).toBe(1500);
    expect(parseNumber("1.500")).toBe(1.5);
    expect(parseNumber("15%")).toBe(15);
    expect(parseNumber("1e3")).toBe(1000);
  });

  it("rejeita o que não é número", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("12/05/2024")).toBeNull();
    expect(parseNumber("1,2,3")).toBeNull();
  });
});

describe("parseDate", () => {
  it("aceita ISO e dd/mm/aaaa", () => {
    expect(parseDate("2024-03-01")).toBe(Date.UTC(2024, 2, 1));
    expect(parseDate("01/03/2024")).toBe(Date.UTC(2024, 2, 1));
    expect(parseDate("março")).toBeNull();
  });
});

const rows: Row[] = Array.from({ length: 40 }, (_, i) => ({
  Nome: `Loja ${i}`,
  Categoria: ["Farmácia", "Mercado", "Padaria"][i % 3]!,
  Faturamento: `${(1000 + i * 37).toLocaleString("pt-BR")},50`,
  Abertura: `0${(i % 9) + 1}/03/2020`,
  UF: ["35", "33", "31"][i % 3]!,
  "Latitude ": `-23,${5500 + i}`,
  Longitude: `-46,${6300 + i}`,
}));

describe("detectColumns + guessLocation", () => {
  const columns = detectColumns(Object.keys(rows[0]!), rows);
  const type = (name: string) => columns.find((c) => c.name === name)?.type;

  it("infere os tipos", () => {
    expect(type("Nome")).toBe("text");
    expect(type("Categoria")).toBe("category");
    expect(type("Faturamento")).toBe("number");
    expect(type("Abertura")).toBe("date");
    expect(type("UF")).toBe("category");
    expect(type("Latitude ")).toBe("number");
    expect(columns.find((c) => c.name === "Faturamento")?.locale).toBe("br");
  });

  it("acha latitude/longitude pelo nome (com acento/espaço)", () => {
    expect(guessLocation(columns)).toEqual({ lat: "Latitude ", lon: "Longitude", reason: "names" });
  });

  it("acha latitude/longitude pelos valores quando o nome não ajuda", () => {
    const renamed = rows.map((r) => ({ a: r["Latitude "]!, b: r.Longitude!, nome: r.Nome! }));
    const cols = detectColumns(["a", "b", "nome"], renamed);
    expect(guessLocation(cols)).toEqual({ lat: "a", lon: "b", reason: "values" });
  });

  it("sugere colorir por categoria e título pelo nome", () => {
    expect(guessStyleColumns(columns, ["Latitude ", "Longitude"])).toEqual({ colorBy: "Categoria", title: "Nome" });
  });

  it("não confunde coordenada com 3 casas ('-34.882') com milhar brasileiro", () => {
    const data: Row[] = [{ lon: "-34.882" }, { lon: "-34.890345" }, { lon: "-49.27" }];
    const [col] = detectColumns(["lon"], data);
    expect(col!.locale).toBe("intl");
    expect(parseNumber("-34.882", col!.locale)).toBe(-34.882);
  });

  it("prefere 'Nome da loja' a 'Código' como título", () => {
    const data: Row[] = Array.from({ length: 30 }, (_, i) => ({ Código: `L${i}`, "Nome da loja": `Loja ${i}` }));
    const cols = detectColumns(["Código", "Nome da loja"], data);
    expect(guessStyleColumns(cols, []).title).toBe("Nome da loja");
  });
});

describe("buildFeatures", () => {
  it("converte, valida e relata linhas inválidas com o número da linha", () => {
    const input: Row[] = [
      { lat: "-23,55", lon: "-46,63", v: "1.000,5" },
      { lat: "", lon: "-46", v: "1" },
      { lat: "abc", lon: "-46", v: "1" },
      { lat: "0", lon: "0", v: "1" },
      { lat: "40.71", lon: "-74.0", v: "2" },
    ];
    const result = buildFeatures(input, {
      lat: "lat",
      lon: "lon",
      latLocale: "br",
      lonLocale: "br",
      columns: [{ name: "v", type: "number", locale: "br" }],
    });
    expect(result.features).toHaveLength(2);
    expect(result.features[0]!.geometry.coordinates).toEqual([-46.63, -23.55]);
    expect(result.features[0]!.properties.v).toBe(1000.5);
    expect(result.invalidCount).toBe(3);
    expect(result.invalidSample.map((r) => r.line)).toEqual([3, 4, 5]);
    expect(result.reasons).toEqual({ "sem-coordenadas": 1, "coordenada-invalida": 1, "fora-do-mundo": 1 });
    expect(result.outsideBrazil).toBe(1);
    expect(result.bounds).toEqual([-74, -23.55, -46.63, 40.71]);
  });
});
