import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(here, "..", rel), "utf8");

/**
 * An option's name is what the customer is choosing between. Cut off with an
 * ellipsis ("Club Sandwich - Two Layer Filling (3 Slices Of Bre…"), two
 * options could read the same. The whole name wraps instead, as in the POS.
 */
test("REGRESSION: option names in the item sheet are shown in full", () => {
  const modal = SRC("components/ProductModal.jsx");
  const choice = modal.slice(modal.indexOf("function Choice("));
  assert.doesNotMatch(choice, /truncate/, "no ellipsis on an option");
  assert.match(choice, /break-words[^"]*">\{label\}</, "the label wraps");
});

test("the cart and the order confirmation show whole item names", () => {
  assert.doesNotMatch(SRC("components/OrderConfirmation.jsx"), /truncate/);
  assert.match(SRC("components/CartDrawer.jsx"), /min-w-0 flex-1 break-words/);
});
