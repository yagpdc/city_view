/**
 * Acervo de planilhas-problema (docs/IMPORT.md · Riscos): cada caso é uma planilha pequena com o resultado
 * esperado. Foco em perda silenciosa — o dado entrar errado sem ninguém perceber.
 */
import { describe, expect, it } from "vitest";
import { detectJunkRows, uniqueHeaders } from "./clean";
import { applyCoordinateFix, suggestCoordinateFix, utmToLatLon } from "./coords";
import { buildFeatures, robustBounds, summarize } from "./build";
import { detectColumns, type Row } from "./detect";
import { profileColumn } from "./profile";
import { applyRecipe } from "./recipe";

const col = (rows: Row[], name: string) => detectColumns([name], rows)[0]!;

describe("identificadores nunca viram número", () => {
  it("CNPJ, CPF, CEP e telefone ficam como texto (zeros e dígitos preservados)", () => {
    const rows = [
      { cnpj: "00360305000104", cpf: "01234567890", cep: "01310200", telefone: "11987654321", codigo: "7891234567890123" },
      { cnpj: "33000167000101", cpf: "98765432100", cep: "20040002", telefone: "2133334444", codigo: "7891234567890124" },
      { cnpj: "60746948000112", cpf: "11122233344", cep: "80010000", telefone: "4130303030", codigo: "7891234567890125" },
    ];
    for (const name of ["cnpj", "cpf", "cep", "telefone", "codigo"]) {
      const c = col(rows, name);
      expect(c.type, name).not.toBe("number");
      expect(c.identifier, name).toBe(true);
    }
    const mapping = { lat: "lat", lon: "lon", columns: [{ name: "cnpj", type: "text" as const }] };
    const out = buildFeatures([{ ...rows[0]!, lat: "-23.5", lon: "-46.6" }], mapping);
    expect(out.features[0]!.properties.cnpj).toBe("00360305000104");
  });
  it("com máscara também", () => {
    const rows = [{ cnpj: "00.360.305/0001-04" }, { cnpj: "33.000.167/0001-01" }];
    expect(col(rows, "cnpj").identifier).toBe(true);
  });
  it("números de verdade continuam números", () => {
    const rows = [{ faturamento: "1200" }, { faturamento: "350.5" }, { faturamento: "98000" }];
    expect(col(rows, "faturamento").type).toBe("number");
  });
  it("avisa quando o Excel já estragou o identificador (notação científica)", () => {
    const rows = [{ cnpj: "3,30002E+13" }, { cnpj: "6,07469E+13" }, { cnpj: "3360305000104" }];
    const p = profileColumn(col(rows, "cnpj"), rows);
    expect(p.problems.map((x) => x.id)).toContain("notacao-cientifica");
  });
  it("identificador nunca recebe a sugestão de virar número", () => {
    const rows = [{ cnpj: "00360305000104" }, { cnpj: "33000167000101" }, { cnpj: "60746948000112" }];
    const p = profileColumn(col(rows, "cnpj"), rows);
    expect(p.problems.map((x) => x.id)).not.toContain("parece-numero");
  });
});

describe("linhas que não são registro", () => {
  const headers = ["Loja", "Cidade", "Faturamento"];
  const rows: Row[] = [
    { Loja: "A", Cidade: "São Paulo", Faturamento: "100" },
    { Loja: "Loja", Cidade: "Cidade", Faturamento: "Faturamento" },
    { Loja: "B", Cidade: "Santos", Faturamento: "200" },
    { Loja: "Total geral", Cidade: "", Faturamento: "300" },
    { Loja: "Fonte: sistema interno, out/2026", Cidade: "", Faturamento: "" },
  ];
  it("acha total, cabeçalho repetido e rodapé", () => {
    const found = detectJunkRows(headers, rows);
    expect(found.map((f) => f.kind).sort()).toEqual(["cabecalho-repetido", "rodape", "total"]);
    expect(found.find((f) => f.kind === "total")!.rows).toEqual([3]);
  });
  it("os passos sugeridos removem só elas", () => {
    const steps = detectJunkRows(headers, rows).map((f) => f.step);
    expect(applyRecipe(rows, steps).map((r) => r.Loja)).toEqual(["A", "B"]);
  });
  it("não confunde registro com total", () => {
    expect(detectJunkRows(["Nome"], [{ Nome: "Totalmente Pet" }, { Nome: "Ana" }])).toEqual([]);
  });
});

describe("vazios disfarçados", () => {
  it("erros de fórmula contam como vazio", () => {
    const rows = [{ v: "10.5" }, { v: "#N/D" }, { v: "30.2" }, { v: "#REF!" }];
    const c = col(rows, "v");
    expect(c.type).toBe("number");
    expect(c.emptyRate).toBe(0.5);
    const s = summarize([{ lat: "#N/D", lon: "-46" }], { lat: "lat", lon: "lon", columns: [] });
    expect(s.reasons["sem-coordenadas"]).toBe(1);
  });
  it("marcadores de vazio viram problema com correção", () => {
    const rows = [{ uf: "SP" }, { uf: "-" }, { uf: "N/A" }, { uf: "RJ" }, { uf: "SP" }];
    const p = profileColumn(col(rows, "uf"), rows);
    const fix = p.problems.find((x) => x.id === "marcadores-vazio")!.fix!.step;
    expect(applyRecipe(rows, [fix]).map((r) => r.uf)).toEqual(["SP", "", "", "RJ", "SP"]);
  });
});

describe("coordenadas", () => {
  it("UTM (SIRGAS 2000, fuso 23 S) vira lat/lon — Praça da Sé", () => {
    const [lat, lon] = utmToLatLon(333_290, 7_394_590, 23, true);
    expect(lat).toBeCloseTo(-23.5505, 2);
    expect(lon).toBeCloseTo(-46.6333, 2);
  });
  it("sugere UTM quando os números são metros", () => {
    // colunas "lat" = Norte (y) e "lon" = Leste (x)
    const pairs: [number, number][] = [[7_394_590, 333_290], [7_395_100, 334_000], [7_393_800, 332_500]];
    const fix = suggestCoordinateFix(pairs);
    expect(fix).toMatchObject({ kind: "utm", zone: 23, swapped: false });
    const [lat] = applyCoordinateFix(fix, pairs[0]![0], pairs[0]![1]);
    expect(lat).toBeCloseTo(-23.55, 1);
  });
  it("um ponto digitado errado não estraga o enquadramento", () => {
    const pts: [number, number][] = Array.from({ length: 200 }, (_, i) => [-46.6 + (i % 20) * 0.01, -23.5 - Math.floor(i / 20) * 0.01]);
    pts.push([0.5, 0.5]);
    const b = robustBounds(pts)!;
    expect(b[2]).toBeLessThan(-46); // leste não vai até 0,5
    const rows = pts.map(([x, y]) => ({ lat: String(y), lon: String(x) }));
    const s = summarize(rows, { lat: "lat", lon: "lon", columns: [] });
    expect(s.farPoints).toBeGreaterThanOrEqual(1);
    expect(s.bounds![2]).toBeLessThan(-46);
  });
});

describe("nomes de coluna", () => {
  it("nome reservado não sobrescreve a categoria interna", () => {
    expect(uniqueHeaders(["_c", "nome"])).toEqual(["_c_coluna", "nome"]);
  });
});
