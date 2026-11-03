const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const b = require("../services/barcodes");

/** Barcode scanning in Inventory (owner, 2026-11-03): Open Food Facts and KnotKitchen's own product list. */

const SRC = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("a barcode as scanned or typed: EAN/UPC digits, or a store's own code", () => {
  assert.equal(b.normalizeCode(" 8901 262 150064 "), "8901262150064");
  assert.equal(b.normalizeCode("12"), null, "too short to be a barcode");
  assert.equal(b.normalizeCode("123456789012345"), null, "longer than any EAN/UPC");
  assert.equal(b.normalizeCode("TESTMOZZ1"), "TESTMOZZ1");
  assert.equal(b.normalizeCode("<script>"), null);
});

test("a packet's size becomes our units: 1 kg, 500 g, 1.5 L, a pack of 6", () => {
  assert.deepEqual(b.parseQuantity("1 kg"), { unit: "kg", size: 1, label: "Pack" });
  assert.deepEqual(b.parseQuantity("500 g"), { unit: "g", size: 500, label: "Pack" });
  assert.deepEqual(b.parseQuantity("2000 g"), { unit: "kg", size: 2, label: "Pack" });
  assert.deepEqual(b.parseQuantity("1L"), { unit: "L", size: 1, label: "Bottle" });
  assert.deepEqual(b.parseQuantity("200ml"), { unit: "ml", size: 200, label: "Bottle" });
  assert.deepEqual(b.parseQuantity("6 x 330 ml"), { unit: "pcs", size: 6, label: "Pack of 6" });
  assert.deepEqual(b.parseQuantity(""), { unit: "pcs", size: 1, label: "" }, "unknown: one piece");
  assert.deepEqual(b.parseQuantity("", 250, "g"), { unit: "g", size: 250, label: "Pack" }, "from the number fields when the text has none");
});

test("Open Food Facts' categories become ours", () => {
  assert.equal(b.categoryOf(["en:dairies", "en:cheeses"]), "dairy");
  assert.equal(b.categoryOf(["en:beverages", "en:sodas"]), "beverage");
  assert.equal(b.categoryOf(["en:snacks"]), "dry_goods");
  assert.equal(b.categoryOf([]), "other");
});

test("lookups: our list first, then Open Food Facts, its answer kept; only the barcode leaves", () => {
  const svc = SRC("services/barcodes.js");
  assert.match(svc, /const known = await BarcodeProduct\.findOne\(\{ code \}\)\.lean\(\);\n  if \(known\?\.name\) return productView\(known\);/);
  assert.match(svc, /"User-Agent": USER_AGENT/);
  assert.match(svc, /signal: AbortSignal\.timeout\(6000\)/);
  // Not found is remembered for a week; a failed lookup is not remembered at all.
  assert.match(svc, /Date\.now\(\) - new Date\(known\.checkedAt\)\.getTime\(\) < RECHECK_MS\) return null;/);
  // A store's name never overwrites one already known.
  assert.match(svc, /\{ code, \$or: \[\{ name: "" \}, \{ name: \{ \$exists: false \} \}\] \}/);
});

test("a barcode is on one item per store, and the scan endpoint finds it", () => {
  const ctrl = SRC("controllers/inventoryController.js");
  assert.match(ctrl, /throw createHttpError\(409, `Barcode \$\{code\} is already on \$\{other\.name\}\.`\);/);
  assert.match(ctrl, /Ingredient\.findOne\(\{ \.\.\.s, "barcodes\.code": code \}\)/);
  // A same-kind unit change re-states each packet's size (a 1 kg block is 1000 g).
  assert.match(ctrl, /next_\.barcodes = \(doc\.barcodes \|\| \[\]\)\.map\(\(b\) => \(\{ code: b\.code, label: b\.label, size: round3\(b\.size \* factor\) \}\)\);/);
  assert.match(SRC("routes/inventoryRoute.js"), /router\.route\("\/barcodes\/:code"\)\.get\(isVerifiedUser, c\.scanBarcode\);/);
  assert.match(SRC("models/inventoryModel.js"), /barcodeProductSchema\.index\(\{ code: 1 \}, \{ unique: true \}\);/);
});
