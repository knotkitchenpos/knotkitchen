const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

/** Register the lightweight offline app shell worker in production only. */
export const registerServiceWorker = () => {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator) || isLocalhost) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("KnotKitchen offline shell could not be registered", error);
    });
  });
};