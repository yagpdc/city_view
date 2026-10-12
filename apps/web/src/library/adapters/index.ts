import type { LibraryAdapter } from "../types";
import { ipeadataAdapter } from "./ipeadata";
import { sidraAdapter } from "./sidra";

/** Adaptadores por nome (campo `adapter` de cada fonte no índice). */
export const ADAPTERS: Record<string, LibraryAdapter> = {
  sidra: sidraAdapter,
  ipeadata: ipeadataAdapter,
};
