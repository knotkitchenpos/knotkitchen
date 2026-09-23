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

test("REGRESSION: on WebViews without dvh the shell keeps its height, so View cart stays at the bottom", () => {
  // A tablet's Android app dropped h-dvh: the whole page scrolled and the
  // "View cart" bar only appeared at the end of the menu.
  const css = SRC("src/index.css");
  assert.match(css, /@supports not \(height: 100dvh\) \{\s*\.h-dvh \{\s*height: 100vh;/);
  assert.match(SRC("src/App.jsx"), /className="flex h-dvh w-full overflow-hidden/);
  // The bar is outside the menu's own scroll area.
  const menu = SRC("src/pages/Menu.jsx");
  assert.ok(menu.indexOf("<ProductPanel") < menu.indexOf("View cart ("));
  assert.match(menu, /lg:hidden shrink-0 border-t/);
});

test("REGRESSION: nothing newer than the tablets' WebView (Chrome 94) is used", () => {
  // The Android app on a Slate tablet runs Chrome 94: no dvh (guarded in
  // index.css), no structuredClone (Chrome 98), no toSorted/findLast.
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(jsx?|mjs)$/.test(e.name) ? [path.join(dir, e.name)] : [],
    );
  for (const file of walk(path.join(__dirname, "..", "src"))) {
    const src = fs.readFileSync(file, "utf8").replace(/\/\/.*$/gm, "");
    assert.ok(!/structuredClone\(|\.toSorted\(|\.toReversed\(|\.findLast(Index)?\(|Object\.groupBy\(/.test(src), file);
  }
});

test("REGRESSION: on a landscape tablet the cart list keeps room", () => {
  // Inside the app the tablet is about 1280x730. The fixed rows above and
  // below the cart took ~510px and left the item list ~220px.
  const cfg = fs.readFileSync(path.join(__dirname, "..", "tailwind.config.js"), "utf8");
  assert.match(cfg, /short: \{ raw: "\(max-height: 820px\)" \}/);
  const panel = fs.readFileSync(path.join(__dirname, "..", "src", "components", "pos", "OrderPanel.jsx"), "utf8");
  for (const cls of ["short:py-2", "short:h-10", "short:h-11", "short:space-y-3"]) {
    assert.ok(panel.includes(cls), `${cls} missing from OrderPanel`);
  }
});

test("the collection customer boxes sit just above the bill, not above the cart", () => {
  const panel = fs.readFileSync(path.join(__dirname, "..", "src", "components", "pos", "OrderPanel.jsx"), "utf8");
  const summary = panel.indexOf("===== Summary =====");
  assert.ok(panel.indexOf("Customer name (optional)") > summary, "inputs live in the summary block");
  assert.ok(panel.indexOf("Customer name (optional)") < panel.indexOf("<span className=\"text-[#475569]\">Subtotal</span>"), "above Subtotal");
  assert.ok(!/Optional for Walk-in/.test(panel), "no separate Customer Info box");
});
