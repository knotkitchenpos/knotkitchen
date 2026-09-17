/**
 * Build-time configuration, read in one place.
 *
 * VITE_BACKEND_URL is the API origin. Empty means "same origin", which is how
 * the deployed POS runs behind its reverse proxy; the dev server sets it to
 * the local API.
 */
export const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/$/, "");

/** Where the realtime socket connects: the API origin, else the page's own. */
export const SOCKET_URL = BACKEND_URL || (typeof window !== "undefined" ? window.location.origin : "");

export const CASHFREE_SDK_URL = "https://sdk.cashfree.com/js/v3/cashfree.js";
