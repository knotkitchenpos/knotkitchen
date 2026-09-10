/**
 * Work out the landing/menu split from the current path.
 *
 * The customer website is a single mounted <StorePage />, so switching between
 * the landing page and the menu is a path change rather than a remount — the
 * storefront payload and the cart both survive it. That only works if the two
 * paths are derived from wherever the site is mounted, which is not always the
 * root: `/s/<slug>` is the path-based fallback used in dev and for preview
 * links, and it must produce `/s/<slug>/menu`, not `/menu`.
 *
 * Pure and dependency-free so it can be tested with plain Node.
 *
 * @param {string} pathname
 * @returns {{ isMenu: boolean, homePath: string, menuPath: string }}
 */
export function landingRoute(pathname) {
  const clean = String(pathname || "/").replace(/\/+$/, "");
  const isMenu = /\/menu$/.test(clean);
  const base = isMenu ? clean.slice(0, -"/menu".length) : clean;

  return {
    isMenu,
    homePath: base || "/",
    menuPath: `${base}/menu`,
  };
}
