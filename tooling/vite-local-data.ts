import { fileURLToPath } from "node:url";
import sirv from "sirv";
import type { Plugin } from "vite";

const DATA_DIR = fileURLToPath(new URL("../data/out", import.meta.url));
const PUBLIC_ASSETS_URL = "https://protomaps.github.io/basemaps-assets";

/**
 * Serve data/out em /data com suporte a Range requests (necessário para PMTiles).
 * Fontes/ícones (/data/assets) que não foram baixados (`pnpm assets`) caem no Protomaps.
 */
export function localData(): Plugin {
  const serve = sirv(DATA_DIR, { dev: true, etag: true });
  const mount: Plugin["configureServer"] = (server) => {
    server.middlewares.use("/data", serve);
    server.middlewares.use("/data/assets", (req, res) => {
      res.statusCode = 302;
      res.setHeader("Location", `${PUBLIC_ASSETS_URL}${req.url ?? "/"}`);
      res.end();
    });
  };
  return {
    name: "cityview-local-data",
    configureServer: mount,
    configurePreviewServer: mount as Plugin["configurePreviewServer"],
  };
}
