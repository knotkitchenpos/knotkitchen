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
  // 2026-10-16: tables and QR table ordering come with the POS plan; the ₹200 QR Table Ordering add-on is retired.
  assert.doesNotMatch(INDEX, /QR Table Ordering add-on|QR add-on|Table QR and website ordering are add-ons|<b>QR Table Ordering<\/b>/);
  assert.match(INDEX, /Tables, dine-in and QR Table Ordering are included in the POS plan\./);
  const posPlan = INDEX.split("<h3>POS plan</h3>")[1].split("</ul>")[0];
  assert.match(posPlan, /<li>Tables, dine-in and QR Table Ordering<\/li>/);
  const addons = INDEX.split("<h3>Add-ons</h3>")[1].split("</ul>")[0];
  assert.doesNotMatch(addons, /QR|Table|₹200/);
  assert.match(INDEX, /Tables and QR table ordering are included in the plan;/, "the cost FAQ says so too");
  // The marquee loops two identical lines; a difference makes it jump.
  const [a, b] = INDEX.split('class="marquee"')[1].split("</ul>")[0].split("\n").map((l) => l.trim()).filter((l) => l.startsWith("<li>"));
  assert.equal(a, b);
});

test("wallet minimums: first recharge ₹3,000, then ₹1,000 (owner's prices)", () => {
  assert.doesNotMatch(INDEX, /₹2,500/);
  // Changed 2026-10-16 (was plain text): wrapped so home.js can put today's catalogue amount in.
  assert.match(INDEX, /<span data-price="plan:POS:firstRechargeMin">₹3,000<\/span> or more in one payment/);
  assert.match(INDEX, /each top-up is <span data-price="plan:POS:topUpMin">₹1,000<\/span> or more/);
  assert.match(INDEX, /<b>Website<\/b><span>Your own ordering website and table booking\.<\/span>/);
});

test("2026-10-16: tablet rent ended, so no page describes rented tablets", () => {
  for (const f of ["index.html", "return.html", "refund.html", "terms.html", "shipping.html"]) {
    assert.doesNotMatch(page(f), /\brent(ed|al|ing)?\b/i, f);
  }
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

/* ---- 2026-10-16: pricing, add-ons and devices come from GET /api/public/pricing ---- */

/** Just enough DOM for home.js: elements found by selector, built by createElement. */
class FakeEl {
  constructor(tag, attrs = {}) {
    Object.assign(this, { tagName: tag.toUpperCase(), children: [], dataset: {}, listeners: {}, text: "", className: "" }, attrs);
  }
  get textContent() { return this.text + this.children.map((c) => c.textContent).join(""); }
  set textContent(v) { this.text = String(v); this.children = []; }
  append(...kids) { this.children.push(...kids); }
  replaceChildren(...kids) { this.text = ""; this.children = kids; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  click() { (this.listeners.click || []).forEach((fn) => fn()); }
  find(tag) { return this.children.find((c) => c.tagName === tag); }
}

const LD = JSON.stringify({ "@graph": [{ "@type": "Organization" }, { "@type": "SoftwareApplication", offers: { price: "499", description: "POS plan: ₹499" } }] });
const PRICING = {
  currency: "INR",
  periodDays: 28,
  plans: [
    { code: "POS", name: "POS", price: 549, firstRechargeMin: 3500, topUpMin: 1000 },
    { code: "BILLING", name: "Billing", price: 249, firstRechargeMin: 3000, topUpMin: 1500 },
  ],
  addons: [
    { code: "WEBSITE", name: "Website", description: "Your own site", price: 3600, periodDays: 365 },
    { code: "GMB", name: "GMB Management", description: "", price: 100, periodDays: 28 },
  ],
  devices: [
    { code: "TABLET", name: "Tablet", description: "10-inch", price: 10000, imageUrl: "https://api.knotkitchen.com/uploads/platform/devices/0f8fad5b-d9cb-469f-a165-70867728950e.webp" },
    { code: "PRINTER_NEW", name: "New printer", description: "Just added in CSD", price: 2999.5, imageUrl: "javascript:alert(1)" },
  ],
  charges: { website: 4, qr: 1, knotEats: 9, ebill: 0.3 },
  taxable: { website: true, qr: true, knotEats: true, ebill: false },
};

/** Runs home.js with reduced motion on (its early return) against `fetch`; the elements it fills. */
const runHome = async (fetch) => {
  const written = {
    "plan:POS": "₹499",
    "plan:BILLING": "₹199",
    "plan:POS:firstRechargeMin": "₹3,000",
    "plan:BILLING:topUpMin": "₹1,500",
    "charge:ebill": "₹0.25",
  };
  const priced = Object.entries(written).map(([key, text]) => new FakeEl("span", { dataset: { price: key }, text }));
  const gst = ["charge:website", "charge:ebill"].map((key) => new FakeEl("span", { dataset: { gst: key }, text: " + GST" }));
  const period = [new FakeEl("span", { dataset: { period: "" }, text: "30" })];
  const dom = {
    "#addon-list": new FakeEl("ul", { className: "lines", text: "static add-ons" }),
    "#device-list": new FakeEl("ul", { className: "lines", text: "static devices" }),
    'script[type="application/ld+json"]': new FakeEl("script", { text: LD }),
    "#device-dialog": new FakeEl("dialog", { showModal() { this.opened = true; } }),
    "#dd-media": new FakeEl("div"),
    "#dd-name": new FakeEl("h3"),
    "#dd-price": new FakeEl("p"),
    "#dd-desc": new FakeEl("p"),
    "#dd-order": new FakeEl("a"),
    "#dd-demo": new FakeEl("a"),
  };
  const document = {
    documentElement: { classList: { remove() {} } },
    querySelector: (s) => dom[s] || null,
    querySelectorAll: (s) => ({ "[data-price]": priced, "[data-gst]": gst, "[data-period]": period })[s] || [],
    createElement: (tag) => new FakeEl(tag),
  };
  const calls = [];
  require("node:vm").runInNewContext(page("home.js"), {
    document,
    matchMedia: () => ({ matches: true }), // reduced motion: home.js returns before the motion code
    addEventListener() {},
    IntersectionObserver: class { observe() {} },
    AbortController,
    setTimeout: () => 0,
    fetch: (url, opts) => (calls.push([url, opts]), fetch()),
  });
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
  return { priced, gst, period, dom, calls };
};

test("home.js puts today's catalogue on the page, reduced motion or not", async () => {
  const { priced, gst, period, dom, calls } = await runHome(async () => ({ ok: true, json: async () => ({ success: true, data: PRICING }) }));
  assert.equal(calls[0][0], "https://api.knotkitchen.com/api/public/pricing");
  assert.ok(calls[0][1].signal, "gives up after a few seconds");
  assert.deepEqual(priced.map((e) => e.textContent), ["₹549", "₹249", "₹3,500", "₹1,500", "₹0.3"]);

  const addons = dom["#addon-list"].children;
  assert.deepEqual(addons.map((li) => li.textContent), ["WebsiteYour own site₹3,600+ GST / year", "GMB Management₹100+ GST / 28 days"]);
  // The plan period and the per-charge GST switch set in CSD reach the written text too.
  assert.deepEqual(period.map((e) => e.textContent), ["28"]);
  assert.deepEqual(gst.map((e) => e.hidden), [false, true], "e-bills set Not taxable in CSD");

  const list = dom["#device-list"];
  assert.equal(list.className, "devices");
  assert.equal(list.children.length, 2, "a device added in CSD shows up");
  const [tablet, added] = list.children;
  const img = tablet.children[0].find("IMG");
  assert.equal(img.src, `${PRICING.devices[0].imageUrl}?w=640`);
  assert.equal(img.loading, "lazy");
  assert.equal(added.children[0].find("IMG"), undefined, "only a picture CSD uploaded is shown");
  assert.equal(tablet.find("A").href, "https://business.knotkitchen.com/settings/billing?device=TABLET");
  assert.equal(added.find("EM").textContent, "₹2,999.5incl. GST, one time");

  // Tap the picture or name: the product, large, with Order and Sign up / Book a demo.
  tablet.children[0].click();
  assert.equal(dom["#device-dialog"].opened, true);
  assert.equal(dom["#dd-media"].children[0].src, PRICING.devices[0].imageUrl);
  assert.deepEqual([dom["#dd-name"].textContent, dom["#dd-desc"].textContent], ["Tablet", "10-inch"]);
  assert.equal(dom["#dd-order"].href, "https://business.knotkitchen.com/settings/billing?device=TABLET");
  assert.match(decodeURIComponent(dom["#dd-demo"].href), /^https:\/\/wa\.me\/918062177510\?text=Hi KnotKitchen, I'd like a demo and the Tablet \(₹10,000\)/);

  const ld = JSON.parse(dom['script[type="application/ld+json"]'].textContent);
  assert.deepEqual(ld["@graph"][1].offers, { price: "549", description: "POS plan: ₹549 + GST per 28 days, prepaid from the KnotKitchen wallet" });
});

test("home.js leaves the written prices alone when the API is down or answers oddly", async () => {
  for (const fetch of [
    async () => { throw new Error("offline"); },
    async () => ({ ok: false, status: 503, json: async () => ({}) }),
    async () => ({ ok: true, json: async () => ({ data: { plans: [] } }) }),
  ]) {
    const { priced, gst, period, dom } = await runHome(fetch);
    assert.deepEqual(priced.map((e) => e.textContent), ["₹499", "₹199", "₹3,000", "₹1,500", "₹0.25"]);
    assert.deepEqual([period[0].textContent, gst.some((e) => e.hidden)], ["30", false]);
    assert.deepEqual(
      [dom["#addon-list"].textContent, dom["#device-list"].textContent, dom["#device-list"].className],
      ["static add-ons", "static devices", "lines"],
    );
    assert.equal(dom['script[type="application/ld+json"]'].textContent, LD);
  }
});

test("the pricing HTML is the no-script fallback: every amount written in, each one marked for home.js", () => {
  const js = page("home.js");
  assert.ok(js.indexOf("/api/public/pricing") < js.indexOf("if (still) return;"), "fetched before the reduced-motion return");
  const pricing = INDEX.slice(INDEX.indexOf('id="pricing"'), INDEX.indexOf('id="contact"'));
  for (const [key, text] of [
    ["plan:POS", "₹499"], ["plan:BILLING", "₹199"], ["plan:POS:firstRechargeMin", "₹3,000"], ["plan:POS:topUpMin", "₹1,000"],
    ["plan:BILLING:firstRechargeMin", "₹3,000"], ["plan:BILLING:topUpMin", "₹1,500"],
    ["charge:website", "₹3"], ["charge:qr", "₹1"], ["charge:knotEats", "₹9"], ["charge:ebill", "₹0.25"],
  ]) {
    assert.ok(pricing.includes(`data-price="${key}">${text}<`), key);
    if (key.startsWith("charge:")) assert.ok(pricing.includes(`data-price="${key}">${text}</span><span data-gst="${key}"> + GST</span>`), key);
  }
  // Every rupee amount in pricing and the FAQ is one home.js refreshes, or sits in a list it rebuilds.
  const loose = pricing
    .replace(/<ul class="lines" id="(addon|device)-list">[\s\S]*?<\/ul>/g, "")
    .replace(/data-price="[^"]+">₹[\d,.]+</g, "");
  assert.doesNotMatch(loose, /₹\s?\d/);
  // The plan period: every mention is marked for home.js, since CSD can change it.
  assert.doesNotMatch(loose.replace(/<span data-period>30<\/span>/g, ""), /\b30\b/);
  assert.equal(pricing.split("<span data-period>30</span>").length - 1, 7);
  assert.match(INDEX, /<dialog class="dev-dialog" id="device-dialog"/);
  // Visitors without an account: no guest checkout, a way to sign up instead.
  assert.match(INDEX, /New to KnotKitchen\? <a href="#contact">Sign up: book a demo<\/a>/);
  assert.match(INDEX, /<script src="home\.js\?v=6" defer><\/script>/);
});
