import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";
import { initSettings } from "./lib/settings";

initSettings();

// Comportement d'application native : aucun réflexe "page web"
const block = (e: Event) => e.preventDefault();
addEventListener("contextmenu", block);          // pas de menu "Inspecter"
addEventListener("dragstart", block);
addEventListener("wheel", (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false }); // pas de zoom
addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  const web = e.key === "F5" || e.key === "F7" || e.key === "F12"
    || (e.ctrlKey && ["r", "p", "f", "g", "u", "s", "+", "-", "="].includes(k))
    || (e.ctrlKey && e.shiftKey && ["i", "j", "c"].includes(k));
  if (web) e.preventDefault();
}, true);

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><ErrorBoundary mode="screen"><App /></ErrorBoundary></React.StrictMode>);
