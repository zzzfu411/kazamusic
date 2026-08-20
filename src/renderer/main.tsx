import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/kazam-theme.css";
import "./styles/app-shell.css";
import "./styles/pages.css";
import "./styles/settings-theme.css";

const el = document.getElementById("root");
if (!el) throw new Error("#root missing");

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
