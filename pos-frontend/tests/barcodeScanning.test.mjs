import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/** Barcode scanning in Inventory (owner, 2026-11-03). */

const SRC = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("a scanner types into the box and Enter sends it; the camera loads ZXing only when opened", () => {
  const s = SRC("src/components/settings/inventory/Scanner.jsx");
  assert.match(s, /if \(e\.key !== "Enter"\) return;/);
  assert.match(s, /if \("BarcodeDetector" in window\)/, "the phone's own reader first");
  assert.match(s, /await import\("@zxing\/browser"\)/, "ZXing only when the camera opens");
  assert.match(s, /code === last\.current\.code && now - last\.current\.at < 1500/, "one packet held up is one scan");
});

test("Scan to add stock: packets add up, a new barcode comes filled in, everything goes in at once", () => {
  const s = SRC("src/components/settings/inventory/ScanStock.jsx");
  assert.match(s, /copy\[i\] = \{ \.\.\.copy\[i\], quantity: String\(r3\(Number\(copy\[i\]\.quantity\) \+ size\)\) \};/);
  assert.match(s, /createIngredient\(\{ name: name\.trim\(\), unit, category, barcodes: \[barcode\] \}\)/);
  assert.match(s, /updateIngredient\(item\._id, \{ barcodes: \[\.\.\.\(item\.barcodes \|\| \[\]\), barcode\] \}\)/);
  assert.match(s, /type: "purchase", quantity: Number\(l\.quantity\), unit: l\.item\.unit,/);
  const view = SRC("src/components/settings/InventoryView.jsx");
  assert.match(view, /<ScanStockModal ingredients=\{ingredients\}/);
  assert.match(view, /<p className="text-\[12\.5px\] font-extrabold text-\[#0F172A\]">Barcodes<\/p>/);
});

test("a stock count adds one packet per scan to that item", () => {
  const c = SRC("src/components/settings/inventory/CountTab.jsx");
  assert.match(c, /const now = Math\.round\(\(\(Number\(base\[hit\.id\]\) \|\| 0\) \+ hit\.size\) \* 1000\) \/ 1000;/);
  assert.match(c, /<BarcodeField onCode=\{onCode\} placeholder="Scan each packet on the shelf" \/>/);
});

test("the Android app may use the camera, asked for only when it is opened", () => {
  const m = SRC("android/app/src/main/AndroidManifest.xml");
  assert.match(m, /<uses-permission android:name="android\.permission\.CAMERA" \/>/);
  assert.match(m, /<uses-feature android:name="android\.hardware\.camera" android:required="false" \/>/);
});

test("recheck: camera reads reach the screen as it is now; a scan typed into a count or cost box is put right", async () => {
  const s = SRC("src/components/settings/inventory/Scanner.jsx");
  assert.match(s, /onCodeRef\.current\(code\);/);
  assert.match(s, /const burst = buf && buf\.target === t && buf\.chars\.length >= 6 && !buf\.slow && now - buf\.last < 80;/);
  assert.match(SRC("src/components/settings/inventory/CountTab.jsx"), /placeholder="Count" data-scan="" data-line=\{id\}/);
  assert.match(SRC("src/components/settings/inventory/ScanStock.jsx"), /data-scan="" data-line=\{l\.item\._id\} data-field="cost"/);
  // An item's Edit checks a new barcode at once.
  assert.match(SRC("src/components/settings/InventoryView.jsx"), /enqueueSnackbar\(`Barcode \$\{d\.code\} is already on \$\{d\.item\.name\}\.`, \{ variant: "error" \}\);/);
});
