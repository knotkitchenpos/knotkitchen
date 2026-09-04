/**
 * One POS session per takeaway, not one per browser.
 *
 * Every takeaway is served from one host and talks to one API host, so the
 * session lived in a single `accessToken` cookie. Cookies are keyed by
 * (name, domain, path) and know nothing about stores, so two takeaways open in
 * one browser shared ONE session: signing into the second overwrote the first,
 * and signing out of either cleared it for both.
 *
 * Cookies are now namespaced per store and each request declares which
 * takeaway it means via x-store-id.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const sc = require("../services/sessionCookies");

const req = (cookies = {}, storeId) => ({
  cookies,
  headers: storeId === undefined ? {} : { "x-store-id": storeId },
});

test("cookie names are namespaced per takeaway", () => {
  assert.equal(sc.accessCookieName("322623"), "accessToken_322623");
  assert.equal(sc.refreshCookieName("909298"), "refreshToken_909298");
  assert.notEqual(sc.accessCookieName("322623"), sc.accessCookieName("909298"));
});

test("a non store-id never reaches a cookie name", () => {
  for (const bad of ["", null, undefined, "abc", "12345", "1234567", "../../x", "322623; Path=/"]) {
    assert.equal(sc.accessCookieName(bad), "accessToken", `rejected: ${String(bad)}`);
  }
});

test("REGRESSION: two takeaways in one browser read different sessions", () => {
  const jar = { accessToken_322623: "TOKEN-A", accessToken_909298: "TOKEN-B" };

  assert.equal(sc.readAccessToken(req(jar, "322623")), "TOKEN-A");
  assert.equal(sc.readAccessToken(req(jar, "909298")), "TOKEN-B");
});

test("REGRESSION: signing out of one takeaway does not clear the others", () => {
  const jar = { accessToken_322623: "A", accessToken_909298: "B" };
  const cleared = sc.cookieNamesToClear(req(jar, "322623"), "322623").map((c) => c.name);

  assert.ok(cleared.includes("accessToken_322623"), "clears its own access cookie");
  assert.ok(cleared.includes("refreshToken_322623"), "clears its own refresh cookie");
  assert.ok(!cleared.includes("accessToken_909298"), "must NOT touch another takeaway");
  assert.ok(!cleared.some((n) => /_\d{6}$/.test(n) && !n.endsWith("_322623")));
});

test("the refresh cookie keeps its own path when cleared", () => {
  const jar = { accessToken_322623: "A" };
  const byName = Object.fromEntries(
    sc.cookieNamesToClear(req(jar, "322623"), "322623").map((c) => [c.name, c.path]),
  );
  // Cleared with the wrong path the browser keeps the cookie and the sign-out
  // silently does nothing.
  assert.equal(byName["refreshToken_322623"], "/api/user");
  assert.equal(byName["accessToken_322623"], "/");
});

test("a session predating the change still works", () => {
  // Nobody may be signed out by the deploy itself.
  assert.equal(sc.readAccessToken(req({ accessToken: "LEGACY" }, "322623")), "LEGACY");
  assert.equal(sc.readAccessToken(req({ accessToken: "LEGACY" })), "LEGACY");
});

test("a client declaring no store is served the only session there is", () => {
  assert.equal(sc.readAccessToken(req({ accessToken_322623: "ONLY" })), "ONLY");
});

test("REGRESSION: with two takeaways signed in and no store declared, refuse to guess", () => {
  // Guessing here is exactly the bug: whichever it picked, some tab would be
  // acting as the wrong takeaway.
  const jar = { accessToken_322623: "A", accessToken_909298: "B" };
  assert.equal(sc.readAccessToken(req(jar)), "");
});

test("a tab naming a takeaway it holds no cookie for gets another's session", () => {
  const jar = { accessToken_909298: "B" };
  assert.equal(sc.readAccessToken(req(jar, "322623")), "", "must not fall through to store B");
});

test("access and refresh are read independently", () => {
  const jar = { accessToken_322623: "A-ACCESS", refreshToken_322623: "A-REFRESH" };
  assert.equal(sc.readAccessToken(req(jar, "322623")), "A-ACCESS");
  assert.equal(sc.readRefreshToken(req(jar, "322623")), "A-REFRESH");
});

test("the declared store is validated, not trusted verbatim", () => {
  const jar = { accessToken_322623: "A" };
  // A junk header must not select anything, and must not crash.
  assert.equal(sc.storeKeyFromRequest(req(jar, "not-a-store")), "");
  assert.equal(sc.storeKeyFromRequest(req(jar, ["322623"])), "322623", "array header takes first");
});

test("REGRESSION: signing out of a namespaced session leaves the legacy cookie alone", () => {
  // Mid-rollout another takeaway may still be riding the legacy cookie.
  const jar = { accessToken_322623: "A", accessToken: "SOMEONE-ELSE" };
  const cleared = sc.cookieNamesToClear(req(jar, "322623"), "322623").map((c) => c.name);
  assert.ok(cleared.includes("accessToken_322623"));
  assert.ok(!cleared.includes("accessToken"), "must not evict a session it does not own");
});

test("signing out of a legacy session DOES clear the legacy cookie", () => {
  // Otherwise "sign out" would not actually sign anyone out.
  const jar = { accessToken: "LEGACY" };
  const cleared = sc.cookieNamesToClear(req(jar, "322623"), "322623").map((c) => c.name);
  assert.ok(cleared.includes("accessToken"));
  assert.ok(cleared.includes("refreshToken"));
});

test("REGRESSION: round trip -- issuing two takeaways cannot collide", () => {
  // Exercises naming and reading TOGETHER, which is where the original bug
  // lived: both stores were issued the same cookie name, so the second
  // sign-in overwrote the first and both tabs shared one session.
  const jar = {};
  jar[sc.accessCookieName("322623")] = "SESSION-A";
  jar[sc.accessCookieName("909298")] = "SESSION-B";

  assert.equal(Object.keys(jar).length, 2, "each takeaway must occupy its own cookie");
  assert.equal(sc.readAccessToken(req(jar, "322623")), "SESSION-A");
  assert.equal(sc.readAccessToken(req(jar, "909298")), "SESSION-B");

  // And signing one out leaves the other readable.
  for (const c of sc.cookieNamesToClear(req(jar, "322623"), "322623")) delete jar[c.name];
  assert.equal(sc.readAccessToken(req(jar, "322623")), "", "signed out");
  assert.equal(sc.readAccessToken(req(jar, "909298")), "SESSION-B", "still signed in");
});
