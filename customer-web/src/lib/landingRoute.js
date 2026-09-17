/**
 * Work out the landing/menu/legal split from the current path.
 *
 * The customer website is a single mounted <StorePage />, so switching between
 * the landing page, the menu and a legal page is a path change rather than a
 * remount — the storefront payload and the cart both survive it. That only
 * works if the paths are derived from wherever the site is mounted, which is
 * not always the root: `/s/<slug>` is the path-based fallback used in dev and
 * for preview links, and it must produce `/s/<slug>/menu`, not `/menu`.
 *
 * Legal pages live at `<home>/legal/<key>` (terms, privacy,
 * refund-cancellation, return, shipping-delivery); see lib/legalPages.js.
 *
 * Pure and dependency-free so it can be tested with plain Node.
 *
 * @param {string} pathname
 * @returns {{ isMenu: boolean, legalKey: string, homePath: string, menuPath: string, base: string }}
 */
export function landingRoute(pathname) {
  const clean = String(pathname || "/").replace(/\/+$/, "");
  const legal = clean.match(/\/legal\/([a-z0-9-]+)$/);
  const isMenu = !legal && /\/menu$/.test(clean);
  const base = legal ? clean.slice(0, legal.index) : isMenu ? clean.slice(0, -"/menu".length) : clean;

  return {
    isMenu,
    legalKey: legal ? legal[1] : "",
    homePath: base || "/",
    menuPath: `${base}/menu`,
    base,
  };
}

/** The path of one legal page under the same mount as `route`. */
export const legalPath = (route, key) => `${route.base}/legal/${key}`;
