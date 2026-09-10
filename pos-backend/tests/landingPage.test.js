const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * The customer website's landing page.
 *
 * Every store's site now opens on a landing page and the menu sits one click
 * behind it. Two things make that safe to ship:
 *
 *   1. A store that has never been edited still gets a real landing page. The
 *      `landing` sub-document is empty for every store that existed before
 *      this feature, so the payload builder falls back to the branding they
 *      already filled in. If those fallbacks break, several hundred stores
 *      show a blank front door at once.
 *
 *   2. The template key the database holds has to be a template the browser
 *      bundle actually ships. Those two lists live in different applications,
 *      which is exactly the shape that drifts.
 */

const { buildLandingPayload } = require("../services/landingPayload");
const WebsiteSettings = require("../models/websiteSettingsModel");
const { LANDING_TEMPLATES } = require("../models/websiteSettingsModel");

// --- Payload fallbacks ------------------------------------------------------

test("an untouched store still gets a landing page from its branding", () => {
  const p = buildLandingPayload(
    {
      displayName: "Spice Route",
      branding: {
        siteTitle: "Spice Route Kitchen",
        tagline: "Slow-cooked, every day",
        coverImage: { url: "https://cdn.example/cover.jpg", alt: "A curry" },
        logo: { url: "https://cdn.example/logo.png" },
      },
    },
    null,
    null
  );

  assert.equal(p.template, "hero-classic");
  assert.equal(p.headline, "Spice Route Kitchen");
  assert.equal(p.subheadline, "Slow-cooked, every day");
  assert.equal(p.backgroundImage, "https://cdn.example/cover.jpg");
  assert.equal(p.backgroundAlt, "A curry");
  assert.equal(p.logo, "https://cdn.example/logo.png");
  assert.equal(p.ctaText, "View Menu");
});

test("the landing fields win over branding once they are set", () => {
  const p = buildLandingPayload({
    displayName: "Spice Route",
    branding: { siteTitle: "Spice Route Kitchen", tagline: "Slow-cooked, every day" },
    landing: {
      template: "photo-fullbleed",
      headline: "Book your table",
      subheadline: "Open until midnight",
      ctaText: "See the food",
      backgroundImage: { url: "https://cdn.example/hero.jpg" },
    },
  });

  assert.equal(p.template, "photo-fullbleed");
  assert.equal(p.headline, "Book your table");
  assert.equal(p.subheadline, "Open until midnight");
  assert.equal(p.ctaText, "See the food");
  assert.equal(p.backgroundImage, "https://cdn.example/hero.jpg");
});

test("a store with no branding at all falls back to its name", () => {
  const fromStore = buildLandingPayload({}, null, { storeName: "Corner Cafe" });
  assert.equal(fromStore.headline, "Corner Cafe");

  const fromRestaurant = buildLandingPayload({}, { name: "Corner Cafe Ltd" }, null);
  assert.equal(fromRestaurant.headline, "Corner Cafe Ltd");
});

test("an overlay of zero survives — it is a choice, not an empty value", () => {
  assert.equal(buildLandingPayload({ landing: { overlayOpacity: 0 } }).overlayOpacity, 0);
  assert.equal(buildLandingPayload({ landing: {} }).overlayOpacity, 45);
  assert.equal(buildLandingPayload({}).overlayOpacity, 45);
});

test("the three section switches default to on and can be turned off", () => {
  const on = buildLandingPayload({});
  assert.equal(on.showHours, true);
  assert.equal(on.showContact, true);
  assert.equal(on.showOffers, true);

  const off = buildLandingPayload({ landing: { showHours: false, showContact: false, showOffers: false } });
  assert.equal(off.showHours, false);
  assert.equal(off.showContact, false);
  assert.equal(off.showOffers, false);
});

// --- Schema -----------------------------------------------------------------

test("a new website gets the default template without anyone choosing one", () => {
  const doc = new WebsiteSettings({ storeId: "123456", slug: "spice-route" });
  assert.equal(doc.landing.template, "hero-classic");
  assert.equal(doc.landing.ctaText, "View Menu");
});

test("a template the front end does not ship is rejected by the schema", () => {
  const doc = new WebsiteSettings({
    storeId: "123456",
    slug: "spice-route",
    landing: { template: "whatever-marketing-asked-for" },
  });
  const err = doc.validateSync();
  assert.ok(err, "expected validation to fail");
  assert.ok(err.errors["landing.template"], "expected the template field to be the failure");
});

// --- The two template lists have to agree -----------------------------------

test("every template the database allows exists in the customer website bundle", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "customer-web", "src", "components", "LandingTemplates.jsx"),
    "utf8"
  );

  const block = source.match(/const THEMES = \{([\s\S]*?)\n\};/);
  assert.ok(block, "could not find the THEMES map in LandingTemplates.jsx");

  // Only the top-level keys: each theme body is full of quoted class strings,
  // and a looser scan would count those as templates.
  const shipped = [...block[1].matchAll(/^  "([a-z0-9-]+)": \{$/gm)].map((m) => m[1]);
  assert.ok(shipped.length >= 5, `expected at least five templates, found ${shipped.length}`);

  assert.deepEqual(
    [...shipped].sort(),
    [...LANDING_TEMPLATES].sort(),
    "the model's LANDING_TEMPLATES and the browser's TEMPLATES map have drifted apart"
  );
});

// --- The CSD editor ---------------------------------------------------------

const loadCsd = ({ settings, audits = [] }) => {
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (request, ...rest) {
    if (request === "../models/websiteSettingsModel") {
      return Object.assign(
        { findOne: async () => settings },
        { LANDING_TEMPLATES }
      );
    }
    if (request === "../services/websiteProvisioningService") {
      return { buildStorefrontUrl: () => "https://spice-route.knotkitchen.online" };
    }
    if (request === "../services/csdAuditService") {
      return { csdAudit: async (entry) => audits.push(entry) };
    }
    return orig.call(this, request, ...rest);
  };
  try {
    delete require.cache[require.resolve("../controllers/csdCatalogController")];
    return require("../controllers/csdCatalogController");
  } finally {
    Module._load = orig;
    delete require.cache[require.resolve("../controllers/csdCatalogController")];
  }
};

const makeSettings = (over = {}) => ({
  _id: "w1",
  storeId: "123456",
  landing: {},
  branding: { siteTitle: "Spice Route Kitchen", tagline: "Slow-cooked" },
  saved: 0,
  async save() {
    this.saved += 1;
    return this;
  },
  ...over,
});

const run = async (handler, { storeId = "123456", body = {}, role = "admin" } = {}) => {
  let sent = null;
  let failed = null;
  await handler(
    { params: { storeId }, body, csdStaff: { role, _id: "staff1" }, headers: {} },
    { status: () => ({ json: (payload) => { sent = payload; } }) },
    (err) => { failed = err; }
  );
  return { sent, failed };
};

test("CSD saves a template, and the audit trail records it", async () => {
  const audits = [];
  const settings = makeSettings();
  const { updateLanding } = loadCsd({ settings, audits });

  const { sent, failed } = await run(updateLanding, {
    body: { template: "card-stack", headline: "Come hungry", overlayOpacity: 0 },
  });

  assert.equal(failed, null);
  assert.equal(settings.saved, 1);
  assert.equal(sent.data.landing.template, "card-stack");
  assert.equal(sent.data.landing.headline, "Come hungry");
  assert.equal(sent.data.landing.overlayOpacity, 0);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "CSD_WEBSITE_LANDING_UPDATED");
});

test("a template outside the list is refused before it reaches the database", async () => {
  const settings = makeSettings();
  const { updateLanding } = loadCsd({ settings });

  const { failed } = await run(updateLanding, { body: { template: "hero-classic-v2" } });

  assert.equal(failed?.status, 400);
  assert.equal(settings.saved, 0);
});

test("a background image that is not an http URL is refused", async () => {
  const settings = makeSettings();
  const { updateLanding } = loadCsd({ settings });

  // The value ends up inside a CSS url() and an <img src>, so a javascript:
  // or data: URL here would be script execution on every customer's phone.
  for (const url of ["javascript:alert(1)", "data:text/html,<script>", "/etc/passwd"]) {
    // eslint-disable-next-line no-await-in-loop
    const { failed } = await run(updateLanding, { body: { backgroundImageUrl: url } });
    assert.equal(failed?.status, 400, `expected ${url} to be refused`);
  }
  assert.equal(settings.saved, 0);

  const { failed } = await run(updateLanding, {
    body: { backgroundImageUrl: "https://cdn.example/hero.jpg" },
  });
  assert.equal(failed, null);
  assert.equal(settings.landing.backgroundImage.url, "https://cdn.example/hero.jpg");
});

test("an overlay outside 0-100 is refused", async () => {
  const settings = makeSettings();
  const { updateLanding } = loadCsd({ settings });

  for (const pct of [-1, 101, "quite dark"]) {
    // eslint-disable-next-line no-await-in-loop
    const { failed } = await run(updateLanding, { body: { overlayOpacity: pct } });
    assert.equal(failed?.status, 400, `expected ${pct} to be refused`);
  }
});

test("reading the landing page shows what a blank field would fall back to", async () => {
  const settings = makeSettings();
  const { getLanding } = loadCsd({ settings });

  const { sent } = await run(getLanding, { role: "staff" });

  assert.equal(sent.data.fallbacks.headline, "Spice Route Kitchen");
  assert.equal(sent.data.fallbacks.subheadline, "Slow-cooked");
  assert.deepEqual(sent.data.templates, LANDING_TEMPLATES);
  // Staff read; only admins write.
  assert.equal(sent.data.canEdit, false);
});

test("a store with no website yet says so rather than throwing", async () => {
  const { getLanding } = loadCsd({ settings: null });
  const { failed } = await run(getLanding);
  assert.equal(failed?.status, 404);
});

// --- The restaurant edits its own landing page too --------------------------

/**
 * Manage Website is the restaurant's own screen, so the same landing page is
 * editable from the POS. The two editors write different endpoints, and the
 * POS one is the easier to get wrong: for a while `landing` was refused there
 * and every field arriving on that route was dropped without a word, which
 * looks exactly like a successful save.
 */
const loadPos = ({ settings }) => {
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (request, ...rest) {
    if (request === "../models/websiteSettingsModel") {
      // The real module, captured at the top of this file -- requiring it
      // again from inside the interceptor would recurse into itself.
      return Object.assign({ findOne: async () => settings }, WebsiteSettings, { LANDING_TEMPLATES });
    }
    if (request === "../models/storeModel") return {};
    if (request === "../models/mediaAssetModel") return {};
    if (request === "../services/auditService") return { logActivity: async () => {} };
    return orig.call(this, request, ...rest);
  };
  try {
    delete require.cache[require.resolve("../controllers/websiteSettingsController")];
    return require("../controllers/websiteSettingsController");
  } finally {
    Module._load = orig;
    delete require.cache[require.resolve("../controllers/websiteSettingsController")];
  }
};

const posSettings = () => ({
  storeId: "123456",
  restaurantId: "507f1f77bcf86cd799439011",
  slug: "spice-route",
  version: 1,
  landing: {},
  branding: {},
  toObject() {
    return { ...this };
  },
  async save() {
    this.saved = (this.saved || 0) + 1;
    return this;
  },
});

const posRun = async (handler, body) => {
  let failed = null;
  await handler(
    { user: { role: "Owner", storeId: "123456", restaurantId: "507f1f77bcf86cd799439011" }, body },
    { status: () => ({ json: () => {} }) },
    (err) => { failed = err; }
  );
  return failed;
};

test("the POS saves the landing page rather than silently dropping it", async () => {
  const settings = posSettings();
  const { updateWebsiteSettings } = loadPos({ settings });

  const failed = await posRun(updateWebsiteSettings, {
    landing: { template: "minimal-center", headline: "Come hungry", overlayOpacity: 10, showOffers: false },
  });

  assert.equal(failed, null);
  assert.equal(settings.landing.template, "minimal-center");
  assert.equal(settings.landing.headline, "Come hungry");
  assert.equal(settings.landing.overlayOpacity, 10);
  assert.equal(settings.landing.showOffers, false);
});

test("the POS refuses a template that does not exist", async () => {
  const settings = posSettings();
  const { updateWebsiteSettings } = loadPos({ settings });

  const failed = await posRun(updateWebsiteSettings, { landing: { template: "something-else" } });

  assert.equal(failed?.status, 400);
  assert.equal(settings.landing.template, undefined);
});

test("the POS offers the same template list the database accepts", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "pos-frontend", "src", "pages", "WebsiteSettings.jsx"),
    "utf8"
  );

  const block = source.match(/const LANDING_TEMPLATE_INFO = \{([\s\S]*?)\n\};/);
  assert.ok(block, "could not find LANDING_TEMPLATE_INFO in WebsiteSettings.jsx");

  const named = [...block[1].matchAll(/"([a-z0-9-]+)": \{/g)].map((m) => m[1]);
  assert.deepEqual([...named].sort(), [...LANDING_TEMPLATES].sort());
});
