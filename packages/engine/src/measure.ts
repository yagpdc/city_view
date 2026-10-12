/**
 * Medição no elipsoide WGS84 com a GeographicLib (Karney): distância de uma linha e área/perímetro
 * de um polígono. Precisão de nanômetros na distância e ~0,1 m² na área — a referência do setor.
 */
import { Geodesic } from "geographiclib-geodesic";
import type { Position } from "./geo";

const geod = Geodesic.WGS84;

/** Comprimento de uma linha (soma das geodésicas entre os pontos), em metros. */
export function lineLengthM(points: Position[]): number {
  if (points.length < 2) return 0;
  const line = geod.Polygon(true);
  for (const [lon, lat] of points) line.AddPoint(lat, lon);
  return line.Compute(false, true).perimeter;
}

/** Área (m², sempre positiva) e perímetro (m) de um polígono simples; o anel fecha sozinho. */
export function polygonMeasure(points: Position[]): { areaM2: number; perimeterM: number } {
  if (points.length < 3) return { areaM2: 0, perimeterM: lineLengthM(points) };
  const poly = geod.Polygon(false);
  for (const [lon, lat] of points) poly.AddPoint(lat, lon);
  const r = poly.Compute(false, true);
  return { areaM2: Math.abs(r.area ?? 0), perimeterM: r.perimeter };
}

/** "850 m", "12,4 km" */
export function formatDistance(m: number): string {
  if (m < 1000) return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: m < 10 ? 1 : 0 }).format(m)} m`;
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: m < 100_000 ? 2 : 0 }).format(m / 1000)} km`;
}

/** "640 m²", "3,2 ha", "12,4 km²" */
export function formatArea(m2: number): string {
  const f = (v: number, d: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: d }).format(v);
  if (m2 < 10_000) return `${f(m2, 0)} m²`;
  if (m2 < 1_000_000) return `${f(m2 / 10_000, 2)} ha`;
  return `${f(m2 / 1_000_000, m2 < 100_000_000 ? 2 : 0)} km²`;
}
