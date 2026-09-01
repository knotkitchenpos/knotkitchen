import test from "node:test";
import assert from "node:assert";

// The module reads window.location.pathname as its default argument, so give
// it a window before importing. Every assertion below passes an explicit path.
globalThis.window = { location: { pathname: "/" } };
const { isPublicPath } = await import("../src/utils/publicRoutes.js");

/**
 * Guards the guest-route allow-list shared by useLoadData and the axios 401
 * handler.
 *
 * Getting this wrong is not a subtle bug in either direction:
 *   - a guest route missing from the list bootstraps a POS session for a
 *     customer, 401s, and hard-redirects them to the staff login (this is
 *     what a scanned table QR used to do);
 *   - a staff route wrongly IN the list skips the session bootstrap on a page
 *     that needs it.
 */

test("a scanned table QR is a guest page", () => {
  assert.equal(isPublicPath("/t/aa364d7f21dd1b5e24a2b889e66f3da1"), true);
});

test("the other guest pages are too", () => {
  for (const p of ["/order", "/pay/abc123", "/store/burger-house", "/auth"]) {
    assert.equal(isPublicPath(p), true, `${p} must be public`);
  }
});

test("REGRESSION: /orders is staff, not a prefix match on /order", () => {
  // "/order" is the legacy ?table= QR page and matches exactly. Matching it as
  // a prefix also swallows the staff order list.
  assert.equal(isPublicPath("/orders"), false);
});

test("staff pages are never public", () => {
  for (const p of ["/", "/orders", "/tables", "/settings", "/dashboard", "/kds", "/website"]) {
    assert.equal(isPublicPath(p), false, `${p} must NOT be public`);
  }
});
