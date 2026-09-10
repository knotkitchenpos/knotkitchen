// -----------------------------------------------------------------------------
// Landing/menu path split — unit tests
// -----------------------------------------------------------------------------
// Run with: node customer-web/src/lib/landingRoute.test.mjs

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { landingRoute } from "./landingRoute.js";

test("root path is the landing page", () => {
  const r = landingRoute("/");
  assert.equal(r.isMenu, false);
  assert.equal(r.homePath, "/");
  assert.equal(r.menuPath, "/menu");
});

test("/menu is the menu", () => {
  const r = landingRoute("/menu");
  assert.equal(r.isMenu, true);
  assert.equal(r.homePath, "/");
  assert.equal(r.menuPath, "/menu");
});

test("path-based mount keeps its prefix", () => {
  const r = landingRoute("/s/burger-house");
  assert.equal(r.isMenu, false);
  assert.equal(r.homePath, "/s/burger-house");
  assert.equal(r.menuPath, "/s/burger-house/menu");
});

test("path-based menu resolves back to its own landing page", () => {
  const r = landingRoute("/s/burger-house/menu");
  assert.equal(r.isMenu, true);
  assert.equal(r.homePath, "/s/burger-house");
  assert.equal(r.menuPath, "/s/burger-house/menu");
});

test("a trailing slash does not create a second route", () => {
  assert.deepEqual(landingRoute("/menu/"), landingRoute("/menu"));
  assert.deepEqual(landingRoute("/s/x/"), landingRoute("/s/x"));
});

test("a store whose slug ends in 'menu' is not mistaken for the menu page", () => {
  // "/s/lunch-menu" is a landing page; only a trailing "/menu" SEGMENT counts.
  const r = landingRoute("/s/lunch-menu");
  assert.equal(r.isMenu, false);
  assert.equal(r.menuPath, "/s/lunch-menu/menu");
});
