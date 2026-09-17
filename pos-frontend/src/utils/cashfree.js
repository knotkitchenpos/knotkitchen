import { CASHFREE_SDK_URL } from "../config";

/**
 * Load a third-party script once and hand back whatever global it defines.
 *
 * Deliberately resolves null rather than rejecting: a diner on a hotel wifi
 * that blocks the gateway CDN should get "we couldn't open the payment page",
 * not an unhandled rejection and a blank screen.
 */
export const loadScript = (src, pick) =>
  new Promise((resolve) => {
    const existing = pick();
    if (existing) return resolve(existing);
    const el = document.createElement("script");
    el.src = src;
    el.onload = () => resolve(pick() || null);
    el.onerror = () => resolve(null);
    document.body.appendChild(el);
  });

/** The Cashfree checkout SDK, or null when it cannot be loaded. */
export const loadCashfree = () => loadScript(CASHFREE_SDK_URL, () => window.Cashfree);
