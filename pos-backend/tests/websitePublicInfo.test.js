const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { mergedContact, buildLegalPayload, mapsSearchUrl } = require("../services/websitePublicInfo");

/**
 * The public website prints the restaurant's own details from the POS unless
 * Manage Website > Contact overrides them, and the legal pages read the same
 * merged view plus the Legal tab's windows.
 */

const SRC = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const WEB = (...p) => fs.readFileSync(path.join(__dirname, "..", "..", "customer-web", "src", ...p), "utf8");

const restaurant = {
  name: "Demo Store 1",
  legalName: "Demo Foods",
  address: { line1: "J/187 Baishnabghata", line2: "Patuli Township", city: "Kolkata", state: "West Bengal", postalCode: "700094" },
  restaurantPhone: "8012717681",
  ownerPhone: "9000000000",
  ownerEmail: "owner@example.com",
  ownerName: "Riya Sen",
  mapsLink: "",
  fssaiNumber: "12345678901234",
  gstRegistered: false,
  taxId: "19AAAAA0000A1Z5",
};

test("a blank Contact tab falls back to the POS, field by field", () => {
  const c = mergedContact({ contact: {} }, restaurant);
  assert.equal(c.phone, "8012717681", "the restaurant line before the owner's");
  assert.equal(c.email, "owner@example.com");
  assert.equal(c.addressLine1, "J/187 Baishnabghata");
  assert.equal(c.addressLine2, "Patuli Township");
  assert.equal(c.city, "Kolkata, West Bengal");
  assert.equal(c.postalCode, "700094");
  assert.match(c.mapUrl, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Demo%20Store%201/);
});

test("a filled Contact field wins over the POS", () => {
  const c = mergedContact({ contact: { phone: " 033-1234 ", mapUrl: "https://maps.app.goo.gl/x" } }, restaurant);
  assert.equal(c.phone, "033-1234");
  assert.equal(c.mapUrl, "https://maps.app.goo.gl/x");
  assert.equal(c.email, "owner@example.com", "untouched fields still fall back");
});

test("the map link prefers the onboarding pin, then the Google Business page, then a search", () => {
  assert.equal(mergedContact({}, { ...restaurant, mapsLink: "https://maps.app.goo.gl/pin" }).mapUrl, "https://maps.app.goo.gl/pin");
  assert.equal(mergedContact({}, { ...restaurant, googleBusinessUrl: "https://g.page/x" }).mapUrl, "https://g.page/x");
  assert.equal(mapsSearchUrl(["", " "]), "", "no address, no link");
});

test("legal pages: identity from the POS, windows from Manage Website > Legal, defaults otherwise", () => {
  const L = buildLegalPayload({ displayName: "", legal: { refundWindowHours: 48, grievanceName: "Amit" } }, restaurant, { websiteUrl: "https://demo.knotkitchen.com" });
  assert.equal(L.restaurantName, "Demo Store 1");
  assert.equal(L.legalName, "Demo Foods");
  assert.equal(L.fssaiNumber, "12345678901234");
  assert.equal(L.gstin, "", "not GST registered: no GSTIN printed");
  assert.equal(buildLegalPayload({}, { ...restaurant, gstRegistered: true }).gstin, "19AAAAA0000A1Z5");
  assert.equal(L.refundWindowHours, 48);
  assert.equal(L.refundDecisionDays, 3, "default");
  assert.equal(L.returnWindowDays, 7, "default");
  assert.equal(L.grievance.name, "Amit");
  assert.equal(L.grievance.phone, "8012717681", "officer's phone falls back to the contact block");
  assert.equal(L.jurisdictionCity, "Kolkata", "from the restaurant's own city");
  assert.equal(L.jurisdictionState, "West Bengal");
});

test("SOURCE: the storefront serves the merged contact, the legal block, and popular items", () => {
  const ctrl = SRC("controllers", "storefrontController.js");
  assert.match(ctrl, /contact: mergedContact\(settings, restaurant\),/);
  assert.match(ctrl, /legal: buildLegalPayload\(settings, restaurant, \{ websiteUrl: buildStorefrontUrl\(settings\) \}\),/);
  // The operator's pick first; best sellers on the site when there is none.
  assert.match(ctrl, /if \(!landing\.featuredItems\.length\) \{/);
  assert.match(ctrl, /\$group: \{ _id: "\$items\.itemId", qty: \{ \$sum: \{ \$ifNull: \["\$items\.quantity", 1\] \} \} \}/);
  assert.match(SRC("services", "landingPayload.js"), /contact: mergedContact\(settings, restaurant\),/);
  // Manage Website > Legal is saved with bounds.
  const ws = SRC("controllers", "websiteSettingsController.js");
  assert.match(ws, /\["refundWindowHours", 720\], \["refundAckHours", 720\], \["refundDecisionDays", 60\], \["refundProcessingDays", 60\], \["returnWindowDays", 90\]/);
  assert.match(SRC("models", "websiteSettingsModel.js"), /legal: \{ type: legalSchema, default: \(\) => \(\{\}\) \},/);
});

test("SOURCE: every landing design and the menu page link the five legal pages", () => {
  for (const tpl of ["ClassicPeddler", "Citrus", "NightMarket", "Garden", "Sunset"]) {
    assert.match(WEB("components", "landing", `${tpl}.jsx`), /<LegalLinks fssai=\{c\.fssai\} \/>/, `${tpl} footer`);
  }
  assert.match(WEB("components", "StoreShell.jsx"), /<LegalLinks fssai=\{legal\?\.fssaiNumber \|\| ""\} \/>/);
  assert.match(WEB("components", "landing", "parts.jsx"), /Open in Google Maps/);
  const pages = WEB("lib", "legalPages.js");
  for (const key of ["terms", "privacy", "refund-cancellation", "return", "shipping-delivery"]) {
    assert.match(pages, new RegExp(`key: "${key}"`), key);
  }
  assert.match(WEB("pages", "StorePage.jsx"), /if \(route\.legalKey\) \{\s*return \(?\s*(?:<>\s*)?<LegalPage/);
});
