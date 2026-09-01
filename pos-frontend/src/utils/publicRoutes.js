/**
 * Routes a guest is expected to open WITHOUT a POS session.
 *
 * A customer who scans a table QR code lands on `/t/<token>`. They have no
 * cookie, so anything that bootstraps a POS session on their behalf gets a
 * 401 — and a 401 that ends in `window.location.href = "/auth"` drops a
 * diner on the staff sign-in screen instead of the menu they scanned for.
 *
 * Both the session bootstrap (useLoadData) and the axios 401 handler consult
 * this list, so a route added to one can never be forgotten in the other.
 * `/t/` in particular was missing from the bootstrap's own allow-list when it
 * was introduced, which is exactly how that regression shipped.
 */
const PUBLIC_PREFIXES = ["/t/", "/order", "/pay", "/store/"];

export const isPublicPath = (pathname = window.location.pathname) =>
  pathname === "/auth" || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

export default isPublicPath;
