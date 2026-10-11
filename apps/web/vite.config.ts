import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import sirv from "sirv";
import { defineConfig, type Plugin } from "vite";

const DATA_DIR = fileURLToPath(new URL("../../data/out", import.meta.url));

/** Serve data/out em /data com suporte a Range requests (necessário para PMTiles). */
function localData(): Plugin {
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

export default defineConfig({
  plugins: [react(), localData()],
  server: { port: 5173 },
});
