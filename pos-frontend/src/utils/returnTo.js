import { isPublicPath } from "./publicRoutes.js";

/**
 * Where a signed-out visitor was going, kept through sign-in: knotkitchen.com's
 * Order button opens /settings/billing?device=<code>, and the visitor should
 * land there, not on the home screen. Per tab (sessionStorage), because the
 * bounce to /auth may be a full page load (axiosWrapper's 401 handler).
 */
const KEY = "kk:return-to";

export const rememberReturnTo = (loc = window.location) => {
  try {
    if (loc.pathname !== "/" && !isPublicPath(loc.pathname)) sessionStorage.setItem(KEY, loc.pathname + loc.search);
  } catch {
    // Storage blocked: sign-in lands on the home screen, as before.
  }
};

/** The remembered path, once (it is cleared), else "/". Only a path in this app. */
export const takeReturnTo = () => {
  let to = null;
  try {
    to = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked.
  }
  return /^\/(?![/\\])/.test(to || "") ? to : "/";
};
