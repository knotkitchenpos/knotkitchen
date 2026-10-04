import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sourceLabel } from "../src/utils/orderLabels.js";

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("a Knot Eats order reads Knot Eats; the source labels are otherwise unchanged", () => {
  assert.equal(sourceLabel("WEBSITE", "KNOT_EATS"), "Knot Eats");
  assert.equal(sourceLabel("WEBSITE", ""), "Website");
  assert.equal(sourceLabel("WEBSITE"), "Website");
  assert.equal(sourceLabel("MARKETPLACE"), "Outside");
  assert.equal(sourceLabel("QR"), "Table QR");
  assert.equal(sourceLabel("POS"), "POS");
});

test("every screen that labels a source passes the sales channel", () => {
  for (const file of ["pages/Orders.jsx", "pages/Reports.jsx"]) {
    const calls = src(file).match(/sourceLabel\([^)]*\)/g) || [];
    assert.ok(calls.length > 0, file);
    for (const c of calls) assert.match(c, /\.salesChannel\)$/, `${file}: ${c}`);
  }
  assert.match(src("pages/Reports.jsx"), /\{ key: "knotEats", label: "Knot Eats Orders" \}/);
});

test("the new-order card names Knot Eats but keeps the website alert path", () => {
  const popup = src("components/dashboard/NewOrderPopup.jsx");
  assert.match(popup, /"New Knot Eats Order"/);
  assert.match(popup, /"New Knot Eats order"/);
  assert.match(popup, /const isWebsite = source === "WEBSITE";/);
});

test("a CSD support session cannot use the Knot Eats switch: the server says so", () => {
  const view = src("components/settings/KnotEatsView.jsx");
  assert.match(view, /const support = Boolean\(k\?\.supportSession\);/);
  assert.match(view, /disabled=\{!owner \|\| support \|\| mut\.isPending\}/);
  assert.match(view, /only the owner can switch Knot Eats on or off/);
});
