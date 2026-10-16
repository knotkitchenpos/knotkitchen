import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * knotkitchen.com's Order button opens /settings/billing?device=<code>. A
 * signed-out visitor goes through /auth and must land back there, with that
 * device's request open (owner decision 2026-10-16: sign in first, no guest
 * checkout).
 */

const store = new Map();
globalThis.window = { location: { pathname: "/", search: "" } };
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { rememberReturnTo, takeReturnTo } = await import("../src/utils/returnTo.js");
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("the Order link survives sign-in, once", () => {
  rememberReturnTo({ pathname: "/settings/billing", search: "?device=PRINTER_3IN_LAN" });
  assert.equal(takeReturnTo(), "/settings/billing?device=PRINTER_3IN_LAN");
  assert.equal(takeReturnTo(), "/", "used up: the next sign-in lands on home");
});

test("home, guest pages and anything off this app are never remembered", () => {
  for (const pathname of ["/", "/auth", "/t/abc", "/pay/x"]) {
    rememberReturnTo({ pathname, search: "" });
    assert.equal(takeReturnTo(), "/", pathname);
  }
  for (const bad of ["//evil.example/x", "/\\evil.example", "https://evil.example/"]) {
    store.set("kk:return-to", bad);
    assert.equal(takeReturnTo(), "/", bad);
  }
});

test("blocked storage: sign-in still works and lands on home", () => {
  const saved = globalThis.sessionStorage;
  globalThis.sessionStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() {} };
  try {
    rememberReturnTo({ pathname: "/settings/billing", search: "?device=TABLET" });
    assert.equal(takeReturnTo(), "/");
  } finally {
    globalThis.sessionStorage = saved;
  }
});

test("wired up: remembered on the bounce to /auth, used after sign-in, and Billing opens the device", () => {
  const load = src("hooks/useLoadData.js");
  assert.match(load, /rememberReturnTo\(\);\s*navigate\("\/auth"\);/);
  assert.match(src("components/auth/Login.jsx"), /navigate\(takeReturnTo\(\)\);/);

  const billing = src("pages/Billing.jsx");
  assert.match(billing, /new URLSearchParams\(window\.location\.search\)\.get\("device"\)/);
  assert.match(billing, /find\(\(x\) => x\.code === wantDevice\.toUpperCase\(\)\);\s*if \(p\) buyPrinter\(p\);/);
  // Its picture and description in the Devices card, as a small copy.
  assert.match(billing, /src=\{thumbUrl\(p\.imageUrl, 160\)\}/);
  assert.match(billing, /\{p\.description && /);
});
