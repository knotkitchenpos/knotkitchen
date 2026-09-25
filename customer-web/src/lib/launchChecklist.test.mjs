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
