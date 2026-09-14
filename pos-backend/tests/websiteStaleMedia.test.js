const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

/**
 * The website editor (POS and CSD) sends back every image the site already
 * has on every save. When one of those images' library records was gone,
 * EVERY save failed with "Selected image was not found in your media
 * library" -- switching the landing template included.
 */

const STALE_ID = "6a973d0555809ad56442458e";
const FOREIGN_ID = "6a973d0555809ad56442459f";

const run = async (body) => {
  const settings = {
    storeId: "123456",
    restaurantId: "507f1f77bcf86cd799439011",
    slug: "my-store",
    version: 1,
    branding: { logo: { mediaId: STALE_ID, url: "https://cdn.example.com/old-logo.png", thumbnailUrl: "", alt: "" } },
    landing: { template: "peddler" },
    paymentGateways: { activeGateway: "none" },
    save: async () => {},
  };

  const orig = Module._load;
  Module._load = function (r) {
    if (r === "../models/websiteSettingsModel") {
      // Keep the real constants (LANDING_TEMPLATES, ...); only the read is faked.
      const real = orig.apply(this, arguments);
      return Object.assign(Object.create(real), { findOne: async () => settings });
    }
    if (r === "../models/storeModel") return {};
    // Nothing is in the library any more.
    if (r === "../models/mediaAssetModel") return { findOne: async () => null };
    if (r === "../models/restaurantModel") return { updateOne: async () => ({}) };
    if (r === "../services/auditService") return { logActivity: async () => {} };
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve("../controllers/websiteSettingsController")];
  const { updateWebsiteSettings } = require("../controllers/websiteSettingsController");

  let error = null;
  let responded = null;
  const res = { status: () => res, json: (p) => (responded = p) };
  try {
    await updateWebsiteSettings(
      { user: { _id: "u1", role: "Owner", restaurantId: settings.restaurantId, storeId: "123456" }, csdStaff: { _id: "c1" }, websiteTarget: { tenant: { storeId: "123456" }, settings }, body },
      res,
      (err) => (error = err),
    );
  } finally {
    Module._load = orig;
    delete require.cache[require.resolve("../controllers/websiteSettingsController")];
  }
  return { error, responded, settings };
};

test("REGRESSION: changing the template saves even when a stored image's library record is gone", async () => {
  const { error, responded, settings } = await run({
    branding: { logo: { mediaId: STALE_ID, url: "https://cdn.example.com/old-logo.png" } },
    landing: { template: "citrus" },
  });
  assert.equal(error, null, error && error.message);
  assert.ok(responded);
  assert.equal(settings.landing.template, "citrus");
  assert.equal(settings.branding.logo.url, "https://cdn.example.com/old-logo.png", "the existing image is kept as it was");
});

test("a newly chosen image still has to be in this store's library", async () => {
  const { error } = await run({ branding: { logo: { mediaId: FOREIGN_ID, url: "https://evil.example/x.png" } } });
  assert.equal(error && error.status, 404);
});
