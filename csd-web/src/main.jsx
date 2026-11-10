import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { registerWorker } from "./lib/push";

// The push service worker (public/sw.js), so notifications reach this device
// once switched on, and a new release of it is picked up on every visit.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => { registerWorker().catch(() => {}); });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
