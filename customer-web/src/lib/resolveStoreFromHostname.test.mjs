// -----------------------------------------------------------------------------
// Hostname resolver — unit tests
// -----------------------------------------------------------------------------
// Run with: node customer-web/src/lib/resolveStoreFromHostname.test.mjs
//
// This test file is DELIBERATELY runnable without a bundler — the resolver is
// pure and imports nothing from Vite / import.meta.env, so we can exercise it
// with plain Node.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { resolveStoreFromHostname } from "./resolveStoreFromHostname.js";

const opts = { bases: ["knotkitchen.com", "localhost"], fallbackSlug: "" };

test("subdomain in production maps to the slug", () => {
  const r = resolveStoreFromHostname("burger-house.knotkitchen.com", opts);
  assert.equal(r.mode, "subdomain");
  assert.equal(r.slug, "burger-house");
  assert.equal(r.base, "knotkitchen.com");
});

test("subdomain in local dev works identically", () => {
  const r = resolveStoreFromHostname("burger-house.localhost", opts);
  assert.equal(r.mode, "subdomain");
  assert.equal(r.slug, "burger-house");
});

test("port suffix is stripped before resolution", () => {
  const r = resolveStoreFromHostname("burger-house.localhost:5176", opts);
  assert.equal(r.slug, "burger-house");
});

test("www prefix is stripped so www.slug.knotkitchen.com works", () => {
  const r = resolveStoreFromHostname("www.burger-house.knotkitchen.com", opts);
  // After stripping www, prefix is "burger-house" — a normal subdomain.
  assert.equal(r.slug, "burger-house");
});

test("apex domain returns apex mode (no slug leaked)", () => {
  const r = resolveStoreFromHostname("knotkitchen.com", opts);
  assert.equal(r.mode, "apex");
  assert.equal(r.slug, undefined);
});

test("apex with fallback returns the fallback as slug", () => {
  const r = resolveStoreFromHostname("knotkitchen.com", { ...opts, fallbackSlug: "demo" });
  assert.equal(r.mode, "apex");
  assert.equal(r.slug, "demo");
});

test("custom domain (not a base) reports host, not slug", () => {
  const r = resolveStoreFromHostname("burgerhouse.com", opts);
  assert.equal(r.mode, "custom");
  assert.equal(r.host, "burgerhouse.com");
  assert.equal(r.slug, undefined);
});

test("platform subdomains are never treated as store slugs", () => {
  for (const reserved of ["api", "admin", "pos", "app", "cdn", "static"]) {
    const r = resolveStoreFromHostname(`${reserved}.knotkitchen.com`, opts);
    assert.equal(r.mode, "platform", `${reserved} should be platform-reserved`);
  }
});

test("IPv4 address returns ip mode, never subdomain", () => {
  const r = resolveStoreFromHostname("192.168.1.10", opts);
  assert.equal(r.mode, "ip");
  assert.equal(r.slug, undefined);
});

test("longest base wins (multi-base config)", () => {
  const r = resolveStoreFromHostname(
    "burger-house.foo.knotkitchen.com",
    { bases: ["knotkitchen.com", "foo.knotkitchen.com"], fallbackSlug: "" }
  );
  assert.equal(r.mode, "subdomain");
  assert.equal(r.base, "foo.knotkitchen.com");
  assert.equal(r.slug, "burger-house");
});

test("empty hostname returns empty mode", () => {
  const r = resolveStoreFromHostname("", opts);
  assert.equal(r.mode, "empty");
});

test("SECURITY: knotkitchen.com.evil.tld is NOT recognised as a subdomain", () => {
  // The attacker cannot craft a spoof host that appears to belong to knotkitchen.
  const r = resolveStoreFromHostname("knotkitchen.com.evil.tld", opts);
  assert.equal(r.mode, "custom");
  assert.equal(r.host, "knotkitchen.com.evil.tld");
});

test("multi-level subdomain uses the leaf as slug", () => {
  const r = resolveStoreFromHostname("shop.burger-house.knotkitchen.com", opts);
  // Docs say we take the LAST label — that's "burger-house".
  assert.equal(r.mode, "subdomain");
  assert.equal(r.slug, "burger-house");
});
