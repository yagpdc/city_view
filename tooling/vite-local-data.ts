import { fileURLToPath } from "node:url";
import sirv from "sirv";
import type { Plugin } from "vite";

const DATA_DIR = fileURLToPath(new URL("../data/out", import.meta.url));

/** Serve data/out em /data com suporte a Range requests (necessário para PMTiles). */
export function localData(): Plugin {
  const serve = sirv(DATA_DIR, { dev: true, etag: true });
  const mount: Plugin["configureServer"] = (server) => {
    server.middlewares.use("/data", serve);
  };
  return {
    name: "cityview-local-data",
    configureServer: mount,
    configurePreviewServer: mount as Plugin["configurePreviewServer"],
  };
}
