import { data } from "./dataUrl";
import type { DatapackManifest } from "@pinny/engine";

/** Manifestos versionados no repositório; os dados vêm de data/out/datapacks (gerados por datapacks/build.py). */
const manifests = import.meta.glob<DatapackManifest>("../../../datapacks/*/manifest.json", {
  eager: true,
  import: "default",
});

export const DATAPACKS: DatapackManifest[] = Object.values(manifests).sort((a, b) =>
  a.category === b.category ? a.name.localeCompare(b.name) : a.category.localeCompare(b.category),
);

export const dataUrl = (id: string) => data(`datapacks/${id}.geojson`);

export interface DatapackStatus {
  updatedAt: Date;
  features: number;
}

export async function fetchStatus(id: string): Promise<DatapackStatus | null> {
  try {
    const res = await fetch(data(`datapacks/${id}.meta.json`));
    if (!res.ok) return null;
    const meta = (await res.json()) as { updatedAt: string; features: number };
    return { updatedAt: new Date(meta.updatedAt), features: meta.features };
  } catch {
    return null;
  }
}

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

export function relativeTime(date: Date): string {
  const minutes = Math.round((date.getTime() - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
}
