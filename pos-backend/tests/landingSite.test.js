const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * knotkitchen.com: the static landing and policy pages in deploy/landing, and
 * the Caddy vhosts that serve them. Source checks, like shortPublicLinks.test.js.
 */
const DEPLOY = (...p) => fs.readFileSync(path.join(__dirname, "..", "..", "deploy", ...p), "utf8");
const LANDING = path.join(__dirname, "..", "..", "deploy", "landing");
const PAGES = fs.readdirSync(LANDING).filter((f) => f.endsWith(".html")); // demostore/ is a folder, not listed
const page = (f) => DEPLOY("landing", f);
const INDEX = page("index.html");
const STYLE = page("style.css");

test("www redirects to the apex instead of falling into the store wildcard", () => {
  const caddy = DEPLOY("Caddyfile");
  assert.match(caddy, /^www\.\{\$BASE_DOMAIN\} \{$/m);
  assert.match(caddy, /redir https:\/\/\{\$BASE_DOMAIN\}\{uri\} permanent/);
  assert.ok(caddy.indexOf("www.{$BASE_DOMAIN} {") < caddy.indexOf("*.{$BASE_DOMAIN} {"), "declared before the wildcard");
});

test("the phone menu opens under the bar in landscape and closes on tap", () => {
  const landscape = STYLE.slice(STYLE.indexOf("@media(max-height:560px)"));
  assert.match(landscape.slice(0, landscape.indexOf("\n}")), /header\{position:relative\}/);
  assert.doesNotMatch(STYLE, /header\{position:static\}/);
  assert.match(page("home.js"), /menu\.open = false/);
});

test("every page header links to POS sign-in, and the desktop bar has room for it", () => {
  const withMenu = PAGES.filter((f) => page(f).includes('class="menu-panel"'));
  assert.ok(withMenu.length >= 8, `pages with a menu: ${withMenu}`);
  for (const f of withMenu) {
    const menu = page(f).split('class="menu-panel"')[1].split("</ul>")[0];
    assert.match(menu, /href="https:\/\/business\.knotkitchen\.com\/">Sign in to POS</, f);
  }
  assert.doesNotMatch(STYLE, /min-width:861px/);
  assert.match(STYLE, /@media\(min-width:1080px\)\{\.nav-cta\{display:none\}\}/);
});

test("Book a demo offers WhatsApp and a call", () => {
  const contact = INDEX.slice(INDEX.indexOf('id="contact"'));
  assert.match(contact, /href="https:\/\/wa\.me\/918062177510/);
  assert.match(contact, /href="tel:\+918062177510"/);
  assert.match(page("contact.html"), /href="https:\/\/wa\.me\/918062177510"/);
});

test("content shows without script and in print", () => {
  const css = page("home.css");
  assert.match(INDEX, /<html lang="en" class="no-js">/);
  assert.match(page("home.js"), /classList\.remove\("no-js"\)/);
  assert.match(css, /\.no-js \.reveal/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\),print\{/);
  assert.match(css, /print-color-adjust:exact/);
});

test("brand text colours pass WCAG AA", () => {
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const accent = STYLE.match(/--accent:(#[0-9a-f]{6})/i)[1];
  const btn = STYLE.match(/\.btn\{[^}]*background:linear-gradient\(135deg,(#[0-9a-f]{6}),(#[0-9a-f]{6})\)/i);
  assert.ok(btn, ".btn paints a literal two-stop gradient");
  for (const stop of [btn[1], btn[2]]) assert.ok(ratio("#ffffff", stop) >= 4.5, `white on ${stop}: ${ratio("#ffffff", stop)}`);
  for (const bg of ["#f6f1e9", "#fdf0e6", "#fffdfa"]) assert.ok(ratio(accent, bg) >= 4.5, `${accent} on ${bg}: ${ratio(accent, bg)}`);
});

test("landing copy matches what is sold", () => {
  assert.doesNotMatch(INDEX, /Kitchen display|terminals|Billing stays open/);
  assert.match(INDEX, /Swiggy, Zomato and Magicpin are not connected/);
  assert.match(INDEX, /QR Table Ordering add-on/);
  // The marquee loops two identical lines; a difference makes it jump.
  const [a, b] = INDEX.split('class="marquee"')[1].split("</ul>")[0].split("\n").map((l) => l.trim()).filter((l) => l.startsWith("<li>"));
  assert.equal(a, b);
});

test("wallet minimums: first recharge ₹3,000, then ₹1,000 (owner's prices)", () => {
  assert.doesNotMatch(INDEX, /₹2,500/);
  assert.match(INDEX, /₹3,000 or more in one payment/);
  assert.match(INDEX, /each top-up is ₹1,000 or more/);
  assert.match(INDEX, /<b>Website<\/b><span>Your own ordering website and table booking\.<\/span>/);
});

test("hardware refunds are payable out, as Agreement clause 9.1 allows", () => {
  const refund = page("refund.html");
  assert.match(refund, /a refund for a cancelled hardware order, which KnotKitchen pays out by bank transfer on request/);
  assert.doesNotMatch(refund, /hardware order that KnotKitchen cancelled, which is paid out/);
});

test("terms link the public Agreement; shipping matches the real device flow", () => {
  assert.match(page("terms.html"), /href="https:\/\/agreement\.knotkitchen\.com\/agreement\.html"/);
  assert.doesNotMatch(page("terms.html"), /POS devices/);
  const shipping = page("shipping.html");
  assert.match(shipping, /There is no separate shipping charge/);
  assert.match(shipping, /<strong>On the way<\/strong>/);
});

test("SEO and a11y basics", () => {
  const ld = INDEX.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(ld, "index.html carries structured data");
  assert.equal(JSON.parse(ld[1])["@graph"][0].telephone, "+91-8062177510");
  for (const f of PAGES) assert.doesNotMatch(page(f), /href="\/?index\.html/, f);
  assert.doesNotMatch(page("404.html"), /aria-current/);
  assert.match(INDEX, /<details open>\s*<summary><h3>Other charges<\/h3>/);
});
