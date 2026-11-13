import { rememberTypedPin } from "../utils/pinPrompt";

/**
 * The Partners dashboard build (knotkitchen.com/partners, vite.partners.config.js)
 * shares this codebase with the POS. Shared code asks here which one it is.
 *
 * In the Partners build every API call goes to /partners/api (Caddy forwards
 * it to the backend's /api/partners), and the POS screens it reuses (Billing,
 * Reports) act as the store picked in its header.
 */

export const PARTNERS_APP = import.meta.env.VITE_KK_APP === "partners";

/** Where the Partners API lives: under the app's own path, same origin. */
export const PARTNERS_API = `${(import.meta.env.BASE_URL || "/partners/").replace(/\/$/, "")}/api`;

const KEY = "kk.partners.store";

/** The linked store the Billing and Reports screens act as. */
export const activePartnerStore = () => {
  try {
    return sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
};

export const setActivePartnerStore = (storeId) => {
  // A Security PIN belongs to one store: never sent to the next one.
  rememberTypedPin(null);
  try {
    sessionStorage.removeItem("staffPinToken");
    sessionStorage.removeItem("staffPinTokenExpiry");
    sessionStorage.setItem(KEY, String(storeId || ""));
    localStorage.setItem(KEY, String(storeId || ""));
  } catch {
    /* private mode: this tab keeps it in memory through the app state */
  }
  window.dispatchEvent(new CustomEvent("kk:partner-store", { detail: { storeId } }));
};

/** The session ended: back to the Partners sign-in, keeping where they were. */
export const partnersSignedOut = () => {
  const base = (import.meta.env.BASE_URL || "/partners/").replace(/\/$/, "");
  if (window.location.pathname.startsWith(`${base}/login`)) return;
  const back = window.location.pathname.slice(base.length) + window.location.search;
  window.location.href = `${base}/login?next=${encodeURIComponent(back || "/")}`;
};
