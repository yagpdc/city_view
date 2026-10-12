/**
 * Onde ficam os arquivos grandes de mapa (PMTiles, fontes, datapacks): `data/out` servido em `/data` no
 * desenvolvimento, ou um armazenamento externo (Cloudflare R2) definido em `VITE_DATA_URL` — necessário no
 * GitHub Pages, que não aceita arquivos desse tamanho.
 */
const configured = (import.meta.env.VITE_DATA_URL as string | undefined)?.trim().replace(/\/+$/, "");

export const DATA_URL = configured || `${location.origin}/data`;

/** Endereço completo de um arquivo de dados (`data("places/brasil/tiles.pmtiles")`). */
export const data = (path: string) => `${DATA_URL}/${path.replace(/^\/+/, "")}`;
