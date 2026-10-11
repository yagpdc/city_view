import { defineConfig } from "vite";
import { localData } from "../../tooling/vite-local-data";

export default defineConfig({
  plugins: [localData()],
  server: { port: 5174 },
  build: { target: "es2022" },
});
