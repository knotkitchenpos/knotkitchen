/**
 * The <head> each store website page is served with (services/storeHead.js):
 * what link previews and crawlers see without running JavaScript.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildHead, parsePath } = require("../services/storeHead");

const ROOT = path.join(__dirname, "..", "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

const store = (over = {}) => ({
  ok: true,
  store: { storeName: "Spice Garden" },
  restaurant: { name: "Spice Garden", address: { line1: "12 Park St", city: "Kolkata", postalCode: "700016" }, restaurantPhone: "9830012345" },
  settings: {
    displayName: "Spice Garden",
    branding: { siteDescription: "", logo: { url: "https://api.knotkitchen.com/uploads/1/logo/a.png" } },
    landing: { backgroundImage: { url: "https://api.knotkitchen.com/uploads/1/general/hero.webp", alt: "Our dining room" } },
    ordering: { pickupEnabled: true, deliveryEnabled: true },
    theme: { colors: { primary: "#c0392b" } },
    contact: {},
    ...over,
  },
});

const head = (p, result = store()) => buildHead({ host: "148379.knotkitchen.com", path: p, result });

test("each page has its own title and description", () => {
  const home = head("/");
  assert.match(home, /<title>Spice Garden<\/title>/);
  assert.match(home, /<meta name="description" content="Order online from Spice Garden in Kolkata for pickup and delivery\." \/>/);
  assert.match(head("/menu?checkout=abc"), /<title>Menu \| Spice Garden<\/title>/);
  assert.match(head("/legal/privacy"), /<title>Privacy Policy \| Spice Garden<\/title>/);
  assert.match(head("/legal/refund-cancellation"), /Refund &amp; Cancellation Policy of Spice Garden\./);
  assert.match(head("/", store({ branding: { siteTitle: "Spice Garden — Kolkata", siteDescription: "Biryani since 1998." } })), /<title>Spice Garden — Kolkata<\/title>[\s\S]*content="Biryani since 1998\."/);
});

test("link previews: an absolute photo at a size WhatsApp takes, the canonical URL, a large card", () => {
  const h = head("/menu");
  assert.match(h, /<meta property="og:image" content="https:\/\/api\.knotkitchen\.com\/uploads\/1\/general\/hero\.webp\?w=1280" \/>/);
  assert.match(h, /<meta property="og:image:alt" content="Our dining room" \/>/);
  assert.match(h, /<meta property="og:url" content="https:\/\/148379\.knotkitchen\.com\/menu" \/>/);
  assert.match(h, /<link rel="canonical" href="https:\/\/148379\.knotkitchen\.com\/menu" \/>/);
  assert.match(h, /<meta name="twitter:card" content="summary_large_image" \/>/);
  assert.match(h, /<meta name="theme-color" content="#c0392b" \/>/);
  // No photo at all: the site's own preview image.
  const bare = head("/", store({ landing: {}, branding: {} }));
  assert.match(bare, /og:image" content="https:\/\/148379\.knotkitchen\.com\/og-image\.png"/);
});

test("the store's icon is its logo when it has no favicon", () => {
  assert.match(head("/"), /<link rel="icon" href="https:\/\/api\.knotkitchen\.com\/uploads\/1\/logo\/a\.png\?w=160" \/>/);
});

test("the home page carries the restaurant for search engines, safely escaped", () => {
  const h = head("/", store({ displayName: 'Spice "Garden" </script><script>x' }));
  const ld = h.match(/<script type="application\/ld\+json">(.*)<\/script>/)[1];
  assert.doesNotMatch(ld, /<\/script>/i, "a name cannot close the script");
  const data = JSON.parse(ld.replace(/\\u003c/g, "<"));
  assert.equal(data["@type"], "Restaurant");
  assert.equal(data.address.streetAddress, "12 Park St");
  assert.equal(data.telephone, "9830012345");
  assert.match(h, /<title>Spice &quot;Garden&quot; &lt;\/script&gt;&lt;script&gt;x<\/title>/, "and the title is escaped");
  assert.doesNotMatch(head("/menu"), /ld\+json/, "only on the home page");
});

test("not indexed: an unknown store, the /s/<slug> preview copy, a page that does not exist", () => {
  assert.match(buildHead({ host: "999999.knotkitchen.com", path: "/", result: { ok: false } }), /<title>Order Online<\/title>[\s\S]*noindex/);
  assert.match(head("/s/spice-garden/menu"), /<meta name="robots" content="noindex" \/>/);
  assert.doesNotMatch(head("/s/spice-garden/menu"), /rel="canonical"/);
  assert.match(head("/nope"), /<title>Page not found \| Spice Garden<\/title>[\s\S]*noindex/);
  assert.doesNotMatch(head("/"), /noindex/);
});

test("paths are read the way the app routes them", () => {
  assert.deepEqual(parsePath("/"), { slug: "", page: "home", legalKey: "", cleanPath: "/" });
  assert.equal(parsePath("/menu/").page, "menu");
  assert.equal(parsePath("/legal/unknown").page, "notfound");
  assert.deepEqual(parsePath("/s/abc/legal/terms?x=1"), { slug: "abc", page: "legal", legalKey: "terms", cleanPath: "/legal/terms" });
});

test("SOURCE: nginx serves each page with its head, robots, a sitemap and real 404s", () => {
  const conf = read("customer-web", "nginx.conf");
  assert.match(conf, /location = \/__head \{\s*internal;/);
  assert.match(conf, /proxy_set_header X-Store-Path \$request_uri;/);
  assert.match(conf, /proxy_pass \$pos_api\/api\/public\/store\/head;/);
  assert.match(conf, /resolver 127\.0\.0\.11/, "looked up per request, so nginx starts without pos-api");
  assert.match(conf, /location ~ \^\(\/s\/\[a-z0-9-\]\+\)\?\(\/menu\|\/legal\/\[a-z0-9-\]\+\)\?\/\?\$ \{\s*ssi on;/);
  assert.match(conf, /error_page 404 \/404\.html;/);
  assert.match(conf, /Disallow: \/s\/\\n\\nSitemap: https:\/\/\$host\/sitemap\.xml/);
  assert.match(conf, /<loc>https:\/\/\$host\/menu<\/loc>/);
  const index = read("customer-web", "index.html");
  assert.match(index, /<!--# include virtual="\/__head" stub="head" -->/);
  assert.match(index, /<link rel="manifest" href="\/site\.webmanifest" \/>/);
  const route = read("pos-backend", "routes", "publicStoreRoute.js");
  assert.ok(route.indexOf('"/store/head"') < route.indexOf('"/store/:storeId"'), "head before :storeId");
});
