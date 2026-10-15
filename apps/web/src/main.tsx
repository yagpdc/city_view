// Primeiro de tudo: dados salvos com o nome antigo (City View) passam para o novo antes de o App lê-los.
import "./storage/migrateBrand";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
