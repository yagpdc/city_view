/** CSV para o Excel brasileiro: separador ";", UTF-8 com BOM, vírgula decimal. */

export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Número com vírgula decimal (o Excel em português leria "7067.127" como 7 milhões). */
export function brNumber(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const s = String(v);
  return /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s) ? String(Number(s)).replace(".", ",") : s;
}

export function saveCsv(fileName: string, header: string[], rows: (string | number | null)[][]): void {
  const lines = [header.map(csvCell).join(";"), ...rows.map((r) => r.map(csvCell).join(";"))];
  const blob = new Blob(["﻿", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Nome de arquivo seguro: tira acentos ("Municípios" → "Municipios") e troca o resto por "_". */
export const safeName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
