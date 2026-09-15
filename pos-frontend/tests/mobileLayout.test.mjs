import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

/**
 * Phone layout. Below lg there is no sidebar and no room for two panes, so:
 * a bottom navigation bar, and side panes that open full screen.
 */

test("phones get a bottom navigation bar, and the page stops above it", () => {
  const app = SRC("src/App.jsx");
  assert.match(app, /<MobileNav onMore=\{\(\) => setMobileOpen\(true\)\} \/>/);
  assert.match(app, /pb-\[calc\(60px\+env\(safe-area-inset-bottom\)\)\] lg:pb-0/);
  // 100vh runs under a phone browser's toolbar and hides the bar.
  assert.match(app, /flex h-dvh w-full/);
  assert.ok(!/fixed bottom-5 left-5/.test(app), "the floating menu button covered the cart");
});

test("REGRESSION: the 380px cart no longer squeezes the menu off a phone", () => {
  const panel = SRC("src/components/pos/OrderPanel.jsx");
  assert.match(panel, /mobileOpen \? "fixed inset-0 z-\[60\] flex/);
  // display:none, not unmounted: the invoice and payment modals live inside it.
  assert.match(panel, /: "hidden"\n\s*\} lg:static lg:z-auto lg:flex lg:pb-0 w-full lg:w-\[380px\]/);

  const menu = SRC("src/pages/Menu.jsx");
  assert.match(menu, /<OrderPanel mobileOpen=\{cartOpen\} onMobileClose=\{\(\) => setCartOpen\(false\)\} \/>/);
  assert.match(menu, /View cart \(\{cartCount\}\)/);
});

test("order details open full screen from a row on phones", () => {
  const orders = SRC("src/pages/Orders.jsx");
  assert.match(orders, /onClick=\{\(\) => openOrder\(o\._id\)\}/);
  assert.match(orders, /detailOpen \? "fixed inset-0 z-\[60\] flex/);
  assert.match(orders, /onClick=\{\(\) => setDetailOpen\(false\)\}/);
});

test("a dialog taller than the screen scrolls instead of hiding its buttons", () => {
  const css = SRC("src/index.css");
  assert.match(css, /\.fixed\.inset-0\.flex\.items-center\.justify-center \{\s*overflow-y: auto;\s*align-items: safe center;/);
  assert.match(SRC("src/components/pos/ModalShell.jsx"), /max-h-\[calc\(100dvh-2rem\)\]/);
});
