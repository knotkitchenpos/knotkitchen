import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// A page open across a deploy asks for a file the new build removed (the
// Knot Eats part loads on demand): reload once for the new version. A reload
// in the last 30 s that did not help is not repeated.
window.addEventListener("vite:preloadError", (event) => {
  try {
    const last = Number(sessionStorage.getItem("kk:stale-build-reload-at") || 0);
    if (Date.now() - last < 30000) return;
    sessionStorage.setItem("kk:stale-build-reload-at", String(Date.now()));
  } catch {
    /* no sessionStorage: reload once, this page load */
  }
  event.preventDefault();
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
