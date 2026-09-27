import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

/**
 * Table QR ordering: an option's whole name is what the diner chooses between.
 * Cut off with an ellipsis ("Club Sandwich - Two Layer Filling (3 Slices Of
 * Bre…"), two options read the same. Names wrap, as on the store website.
 */
test("REGRESSION: QR option and size names are shown in full", () => {
  const sheet = SRC("src/components/qr/ProductOptionsSheet.jsx");
  assert.doesNotMatch(sheet, /truncate">\{(o|v)\.name\}/, "no ellipsis on an option or a size");
  assert.match(sheet, /break-words leading-snug">\{o\.name\}/);
  assert.match(sheet, /break-words leading-snug">\{v\.name\}/);
});

test("the QR cart and bill show whole item names and choices", () => {
  const page = SRC("src/pages/OrderOnline.jsx");
  assert.match(page, /text-slate-900 break-words">\{item\.name\}/);
  assert.match(page, /text-slate-500 break-words">\{chosen\.join\(" · "\)\}/);
});
