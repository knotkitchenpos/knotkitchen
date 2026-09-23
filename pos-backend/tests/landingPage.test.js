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
const { LANDING_TEMPLATES, LEGACY_LANDING_TEMPLATES } = require("../models/websiteSettingsModel");

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

  assert.equal(p.template, "peddler");
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
      template: "night",
      headline: "Book your table",
      subheadline: "Open until midnight",
      ctaText: "See the food",
      backgroundImage: { url: "https://cdn.example/hero.jpg" },
    },
  });

  assert.equal(p.template, "night");
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
  assert.equal(doc.landing.template, "peddler");
  assert.equal(doc.landing.ctaText, "View Menu");
});

test("a store that chose one of the retired templates keeps a design", () => {
  // Every one of the first five was replaced. Falling through to the default
  // would reset each of those stores to the same page without telling anyone,
  // so the old keys are mapped to the nearest new design instead.
  for (const [oldKey, newKey] of Object.entries(LEGACY_LANDING_TEMPLATES)) {
    assert.equal(
      buildLandingPayload({ landing: { template: oldKey } }).template,
      newKey,
      `${oldKey} must still resolve to a design that ships`,
    );
  }

  // And a key from nowhere at all still renders something.
  assert.ok(
    LANDING_TEMPLATES.includes(buildLandingPayload({ landing: { template: "???" } }).template),
  );
});

test("the landing page shows a few dishes, not the menu", () => {
  const many = Array.from({ length: 9 }, (_, i) => `6a9707a7183d9d7bc113480${i}`);
  const p = buildLandingPayload({ landing: { featuredItems: many } });
  assert.equal(p.featuredItems.length, 3, "three is the cap the layouts are built around");
  assert.deepEqual(p.featuredItems, many.slice(0, 3));
  assert.deepEqual(buildLandingPayload({}).featuredItems, [], "none chosen is a valid state");
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

  const rows = [...block[1].matchAll(/^  "?([a-z0-9-]+)"?: (\w+),$/gm)];
  const shipped = rows.map((m) => m[1]);
  assert.ok(shipped.length >= 5, `expected at least five templates, found ${shipped.length}`);

  assert.deepEqual(
    [...shipped].sort(),
    [...LANDING_TEMPLATES].sort(),
    "the model's LANDING_TEMPLATES and the browser's THEMES map have drifted apart"
  );

  // Each key must reach a DIFFERENT page component. Two keys pointing at one
  // component is how "five templates" quietly became "one template, five
  // names" the first time round.
  const components = rows.map((m) => m[2]);
  assert.equal(
    new Set(components).size,
    components.length,
    `two templates share a design: ${components.join(", ")}`
  );

  // And each of those components must be a real file.
  for (const name of components) {
    const file = path.join(
      __dirname, "..", "..", "customer-web", "src", "components", "landing", `${name}.jsx`
    );
    assert.ok(fs.existsSync(file), `${name}.jsx is missing from customer-web/src/components/landing`);
  }
});

// --- The CSD editor ---------------------------------------------------------
// CSD edits the landing page through GET/PATCH /restaurants/:storeId/website
// (csdWebsiteController), which hands the chosen store to the same
// whitelisted writer the POS uses.

const loadCsd = ({ settings, audits = [] }) => {
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (request, ...rest) {
    if (request === "../models/websiteSettingsModel") {
      return Object.assign({ findOne: async () => settings }, WebsiteSettings, { LANDING_TEMPLATES });
    }
    if (request === "../models/storeModel") return {};
    if (request === "../models/mediaAssetModel") return {};
    if (request === "../services/auditService") return { logActivity: async () => {} };
    if (request === "../services/csdAuditService") {
      return { csdAudit: async (entry) => audits.push(entry) };
    }
    return orig.call(this, request, ...rest);
  };
  const ids = ["../controllers/csdWebsiteController", "../controllers/websiteSettingsController"]
    .map((p) => require.resolve(p));
  try {
    ids.forEach((id) => delete require.cache[id]);
    return require("../controllers/csdWebsiteController");
  } finally {
    Module._load = orig;
    ids.forEach((id) => delete require.cache[id]);
  }
};

const makeSettings = (over = {}) => ({
  _id: "w1",
  storeId: "123456",
  restaurantId: "507f1f77bcf86cd799439011",
  slug: "spice-route",
  version: 1,
  landing: {},
  branding: { siteTitle: "Spice Route Kitchen", tagline: "Slow-cooked" },
  saved: 0,
  toObject() {
    return { ...this };
  },
  async save() {
    this.saved += 1;
    return this;
  },
  ...over,
});

const run = async (handler, { storeId = "123456", body = {}, role = "admin" } = {}) => {
  const { EventEmitter } = require("node:events");
  let sent = null;
  let failed = null;
  // updateCsdWebsite audits on the response's "finish", so it must be real.
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { sent = payload; this.emit("finish"); return this; },
  });
  await handler(
    { params: { storeId }, body, csdStaff: { role, _id: "staff1" }, headers: {} },
    res,
    (err) => { failed = err; }
  );
  return { sent, failed };
};

test("CSD saves a template, and the audit trail records it", async () => {
  const audits = [];
  const settings = makeSettings();
  const { updateCsdWebsite } = loadCsd({ settings, audits });

  const { sent, failed } = await run(updateCsdWebsite, {
    body: { landing: { template: "citrus", headline: "Come hungry", overlayOpacity: 0 } },
  });

  assert.equal(failed, null);
  assert.equal(settings.saved, 1);
  assert.equal(sent.data.settings.landing.template, "citrus");
  assert.equal(sent.data.settings.landing.headline, "Come hungry");
  assert.equal(sent.data.settings.landing.overlayOpacity, 0);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "CSD_WEBSITE_SETTINGS_UPDATED");
});

test("a template outside the list is refused before it reaches the database", async () => {
  const settings = makeSettings();
  const { updateCsdWebsite } = loadCsd({ settings });

  const { failed } = await run(updateCsdWebsite, { body: { landing: { template: "hero-classic-v2" } } });

  assert.equal(failed?.status, 400);
  assert.equal(settings.saved, 0);
});

test("a pasted background image URL is never stored", async () => {
  // The value ends up inside a CSS url() and an <img src>, so a javascript:
  // or data: URL here would be script execution on every customer's phone.
  // Only an image from this store's own media library is accepted.
  for (const url of ["javascript:alert(1)", "data:text/html,<script>", "https://cdn.example/hero.jpg"]) {
    const settings = makeSettings();
    const { updateCsdWebsite } = loadCsd({ settings });
    // eslint-disable-next-line no-await-in-loop
    await run(updateCsdWebsite, { body: { landing: { backgroundImage: url, backgroundImageUrl: url } } });
    assert.equal(settings.landing.backgroundImage, undefined, `expected ${url} to be dropped`);
    assert.ok(!JSON.stringify(settings.landing).includes(url), `expected ${url} not to be stored`);
  }
});

test("an overlay outside 0-100 is refused", async () => {
  const settings = makeSettings();
  const { updateCsdWebsite } = loadCsd({ settings });

  for (const pct of [-1, 101, "quite dark"]) {
    // eslint-disable-next-line no-await-in-loop
    const { failed } = await run(updateCsdWebsite, { body: { landing: { overlayOpacity: pct } } });
    assert.equal(failed?.status, 400, `expected ${pct} to be refused`);
  }
  assert.equal(settings.saved, 0);
});

test("reading the website lists the landing templates; staff read, only admins write", async () => {
  const settings = makeSettings();
  const { getCsdWebsite } = loadCsd({ settings });

  const { sent } = await run(getCsdWebsite, { role: "staff" });

  assert.deepEqual(sent.data.options.landingTemplates, LANDING_TEMPLATES);
  assert.equal(sent.data.canEdit, false);
});

test("a store with no website yet says so rather than throwing", async () => {
  const { getCsdWebsite } = loadCsd({ settings: null });
  const { failed } = await run(getCsdWebsite);
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
    landing: {
      template: "sunset",
      headline: "Come hungry",
      overlayOpacity: 10,
      showOffers: false,
      featuredItems: ["6a9707a7183d9d7bc1134801", "6a9707a7183d9d7bc1134802", "6a9707a7183d9d7bc1134803", "6a9707a7183d9d7bc1134804"],
    },
  });

  assert.equal(failed, null);
  assert.equal(settings.landing.template, "sunset");
  assert.equal(settings.landing.featuredItems.length, 3, "the POS cannot save a fourth either");
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

test("Manage Website in the POS no longer carries the design tabs", () => {
  // Homepage & Branding, Landing Page, Colors & Fonts, Layout, Ordering
  // Options and Hours were removed from the POS; the landing page is edited
  // from the CSD and website timing lives in Website Timing & Holidays.
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "pos-frontend", "src", "pages", "WebsiteSettings.jsx"),
    "utf8"
  );
  const tabs = source.slice(source.indexOf("const TABS = ["), source.indexOf("];", source.indexOf("const TABS = [")));
  for (const gone of ["branding", "landing", "theme", "layout", "ordering", "hours"]) {
    assert.ok(!tabs.includes(`key: "${gone}"`), `${gone} tab must be gone`);
    assert.ok(!source.includes(`tab === "${gone}"`), `${gone} tab body must be gone`);
  }
  assert.match(source, /Your store ID is your website address/);
});
