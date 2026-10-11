import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { localData } from "../../tooling/vite-local-data";

export default defineConfig({
  plugins: [react(), localData()],
  server: {
    port: 5173,
    // Servidor local (services/api): mesmo domínio, sem CORS.
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
