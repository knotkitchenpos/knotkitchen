import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

test("a path that is not a page shows Page not found with a way back", () => {
  const page = read("pages/StorePage.jsx");
  assert.match(page, /if \(route\.base !== mount\) \{/);
  assert.match(page, /title="Page not found"/);
  assert.match(page, /Back to the restaurant/);
});

test("the thank-you survives a refresh and shows over any page; ?checkout goes only when closed", () => {
  const page = read("pages/StorePage.jsx");
  assert.match(page, /const dismissOrder = \(\) => \{\s*setConfirmedOrder\(null\);/);
  assert.match(page, /params\.delete\("checkout"\)/);
  assert.equal((page.match(/\{confirmation\}/g) || []).length, 3, "landing, legal and menu");
  assert.doesNotMatch(read("components/StoreShell.jsx"), /OrderConfirmation/);
  assert.match(page, /Confirming your payment… please don’t pay again\./);
});

test("REGRESSION (F8): a return from paying is verified once, not on every render until 429", () => {
  const page = read("pages/StorePage.jsx");
  assert.match(page, /handledRef\.current === id/);
  assert.match(page, /handledRef\.current = id;/);
});

test("Knot Eats runs the store page in eats mode: menu first, no store analytics or theme", () => {
  const page = read("pages/StorePage.jsx");
  assert.match(page, /if \(!eats && !isMenu && landing\)/);
  assert.match(page, /const analytics = eats \? null : bootstrap\?\.analytics;/);
  assert.match(page, /useThemeVars\(eats \? null : store \|\| bootstrap\)/);
  // The Knot Eats return carries a signed c_ token, never a bare checkout id.
  assert.match(page, /\^c_\[a-f0-9\]\{24\}_\[A-Za-z0-9_-\]\{22\}\$/);
  // Store sites never download the Knot Eats chunk.
  assert.match(read("App.jsx"), /lazy\(\(\) => import\("\.\/eats\/EatsApp"\)\)/);
});

test("REGRESSION (C16): Knot Eats-only code stays out of the store site's main chunk (§10.8: +2 KB gzip)", () => {
  // The /api/eats helpers live in the lazy Eats chunk, not the shared client.
  assert.doesNotMatch(read("lib/api.js"), /api\/eats/);
  assert.match(read("eats/api.js"), /import \{ client \} from "\.\.\/lib\/api";/);
  // The back link and the seller line are slots the Eats page fills.
  const shell = read("components/StoreShell.jsx");
  assert.doesNotMatch(shell, /Back to Knot Eats|Sold by/);
  assert.match(shell, /\{seller\?\.\(legal\)\}/);
  // No modulepreload polyfill: nothing in this app preloads through it.
  assert.match(fs.readFileSync(new URL("../../vite.config.js", import.meta.url), "utf8"), /modulePreload: \{ polyfill: false \}/);
});

test("analytics load only after the visitor accepts, and only when the store set them up", () => {
  const page = read("pages/StorePage.jsx");
  assert.match(page, /const tracking = consent === "granted" && hasAnalytics\(analytics\);/);
  assert.match(page, /if \(tracking\) startAnalytics\(analytics\);/);
  assert.match(page, /effectiveSlug && hasAnalytics\(analytics\) && !consent \? \(\s*<ConsentBanner/);
  const lib = read("lib/analytics.js");
  assert.match(lib, /send_page_view: false/, "page views are sent per page change");
  assert.doesNotMatch(read("../index.html"), /googletagmanager|fbevents/, "nothing loads before consent");
});

test("the checkout says why Place order is greyed out", () => {
  const cart = read("components/CartDrawer.jsx");
  assert.match(cart, /"Enter your 10-digit mobile number\."/);
  assert.match(cart, /\{!error && reason \? \(/);
});

test("photos: the small copies, lazy below the fold; the default design keeps Order on a phone", () => {
  const parts = read("components/landing/parts.jsx");
  assert.match(parts, /\.map\(\(u\) => thumbUrl\(u, w\)\)/);
  assert.match(parts, /loading=\{eager \? undefined : "lazy"\}/);
  for (const t of ["Citrus", "ClassicPeddler", "Garden", "NightMarket", "Sunset"]) {
    assert.match(read(`components/landing/${t}.jsx`), /<Photo w=\{1280\} eager srcs=\{c\.heroImages\}/, t);
  }
  assert.match(read("components/ProductModal.jsx"), /src=\{thumbUrl\(product\.image, 640\)\}/);
  assert.match(read("components/landing/ClassicPeddler.jsx"), /className="nav-order nav-order-mobile"/);
  assert.match(read("components/landing/styles/peddler.css"), /\.nav-order-mobile\{display:inline-block/);
});
