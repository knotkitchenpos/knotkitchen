const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildLandingPayload } = require("../services/landingPayload");
const { LANDING_TEMPLATES } = require("../models/websiteSettingsModel");

const WEB = (...p) => fs.readFileSync(path.join(__dirname, "..", "..", "customer-web", "src", ...p), "utf8");

test("the five designs are the Templates folder's, and older keys keep a design", () => {
  assert.deepEqual(LANDING_TEMPLATES, ["peddler", "citrus", "night", "garden", "sunset"]);
  for (const [old, now] of [["fine-dining", "night"], ["urban-izakaya", "citrus"], ["hero-classic", "peddler"], ["card-stack", "citrus"]]) {
    assert.equal(buildLandingPayload({ landing: { template: old } }).template, now, old);
  }
});

test("the restaurant's name, details and words reach the landing page", () => {
  const p = buildLandingPayload({
    displayName: "Spice Route",
    contact: { phone: "+91 90000 00000", email: "hi@spice.test", addressLine1: "12 Park Street", city: "Kolkata" },
    landing: { template: "garden", copy: { kicker: "Since 1993", headlineAccent: "Wood-fired." }, subheadline: "Old tagline" },
  });
  assert.equal(p.name, "Spice Route");
  assert.equal(p.contact.phone, "+91 90000 00000");
  assert.equal(p.contact.addressLine1, "12 Park Street");
  assert.equal(p.copy.kicker, "Since 1993");
  assert.equal(p.copy.headlineAccent, "Wood-fired.");
  assert.equal(p.copy.lead, "Old tagline", "an existing sub-headline carries over as the intro");
});

test("every design prints the restaurant's photos, name and details rather than the template's", () => {
  for (const file of ["ClassicPeddler.jsx", "Citrus.jsx", "NightMarket.jsx", "Garden.jsx", "Sunset.jsx"]) {
    const src = WEB("components", "landing", file);
    assert.match(src, /<Photo (?:w=\{1280\} eager )?srcs=\{c\.heroImages\}/, `${file}: hero photo`);
    assert.match(src, /<Photo srcs=\{d\.images\}/, `${file}: dish photos`);
    assert.match(src, /<VisitDetails c=\{c\} \/>/, `${file}: address, phone, email`);
    assert.match(src, /<Wordmark c=\{c\}/, `${file}: restaurant name`);
    assert.ok(!/Food Peddler|tapashk|86468|demo-store-1/i.test(src), `${file} still carries the template's own details`);
  }
});

test("the CSD edits the name, details and every word of the landing page", () => {
  const ctrl = fs.readFileSync(path.join(__dirname, "..", "controllers", "csdWebsiteController.js"), "utf8");
  assert.match(ctrl, /"displayName", "contact"/);
  const dialog = fs.readFileSync(path.join(__dirname, "..", "..", "csd-web", "src", "components", "WebsiteDesignDialog.jsx"), "utf8");
  for (const key of ["kicker", "headline", "headlineAccent", "lead", "heroBadge", "storyTitle", "menuTitle", "ctaTitle", "visitTitle", "hoursText", "footerTagline"]) {
    assert.ok(dialog.includes(`patch("landing.copy.${key}"`), key);
  }
  assert.match(dialog, /patch\(`contact\.\$\{key\}`/);
  assert.match(dialog, /patch\("landing\.backgroundImage"/);
});
