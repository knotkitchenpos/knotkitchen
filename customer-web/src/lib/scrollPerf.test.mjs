import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

// Older Android tablets (Chrome 94 WebView) could not repaint a blur per menu
// card, or a frosted sticky bar, while scrolling: the menu ghosted and blanked.
test("REGRESSION: no blur on menu cards or the sticky bars", () => {
  assert.ok(!/\bblur-/.test(read("components/ProductCard.jsx")), "menu cards stay blur-free");
  assert.ok(!/backdrop-blur/.test(read("components/StoreShell.jsx")), "sticky header and category bar are solid");
});
