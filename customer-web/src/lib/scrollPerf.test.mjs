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

test("REGRESSION: the page behind an open cart or popup does not scroll", () => {
  // A drag on the dimmed area moved the menu underneath the cart drawer.
  assert.match(read("lib/useScrollLock.js"), /document\.body\.style\.overflow = "hidden"/);
  assert.match(read("components/CartDrawer.jsx"), /useScrollLock\(open\);/);
  for (const f of ["ProductModal", "TableBookingModal", "OrderConfirmation"]) {
    assert.match(read(`components/${f}.jsx`), /useScrollLock\(\);/, `${f} locks the page`);
  }
});
