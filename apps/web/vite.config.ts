import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { devHub } from "../../tooling/vite-dev-hub";
import { localData } from "../../tooling/vite-local-data";

export default defineConfig({
  // GitHub Pages serve em /city_view/ (PINNY_BASE no workflow); local e VM, na raiz.
  base: process.env.PINNY_BASE ?? "/",
  plugins: [react(), localData(), devHub()],
  server: {
    port: 5173,
    strictPort: true,
    // Servidor local (services/api): mesmo domínio, sem CORS.
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
