const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * What a store starts with on the day it is created (owner, 2026-10-28):
 * "Mark orders Ready automatically" on; Delivery and Table orders off.
 * Only creation applies them: an older store keeps its behaviour.
 */
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const { NEW_STORE_ORDER_TYPES, NEW_STORE_AUTO_READY } = require("../services/newStoreDefaults");
const { provisionWebsiteForStore } = require("../services/websiteProvisioningService");
const WebsiteSettings = require("../models/websiteSettingsModel");

const fakeModel = () => {
  const created = [];
  return {
    created,
    findOne: async () => null,
    create: async (doc) => {
      created.push(doc);
      return doc;
    },
  };
};

test("a new store takes Collection orders only, and marks orders Ready automatically", () => {
  assert.deepEqual({ ...NEW_STORE_ORDER_TYPES }, { collection: true, delivery: false, table: false });
  assert.equal(NEW_STORE_AUTO_READY, true);
});

test("the website settings of a store created now start with auto-ready on", async () => {
  const Model = fakeModel();
  await provisionWebsiteForStore({ storeId: "460010", storeName: "New Kitchen", newStore: true }, { Model });
  assert.equal(Model.created[0].ordering.autoReadyEnabled, true);
});

test("an older store provisioned on first access keeps auto-ready off, as it always ran", async () => {
  const Model = fakeModel();
  await provisionWebsiteForStore({ storeId: "231146", storeName: "Old Kitchen" }, { Model });
  assert.equal(Model.created[0].ordering.autoReadyEnabled, undefined, "left to the schema default");
  assert.equal(new WebsiteSettings({ storeId: "x", slug: "x" }).ordering.autoReadyEnabled, false);
  // The settings screen provisions without `newStore`.
  assert.doesNotMatch(SRC("controllers/websiteSettingsController.js"), /newStore/);
});

test("every way a store is created starts it with the new-store order types and settings", () => {
  for (const file of ["controllers/csdOnboardingController.js", "controllers/csdAgreementController.js", "controllers/userController.js"]) {
    const src = SRC(file);
    const create = src.slice(src.indexOf("await Restaurant.create({"));
    assert.match(create.slice(0, create.indexOf("});")), /orderTypeToggles: \{ \.\.\.NEW_STORE_ORDER_TYPES \}/, `${file}: order types`);
    assert.match(src, /newStore: (true|!initialRestaurant)/, `${file}: auto-ready`);
  }
  // The schema defaults are unchanged, so a store that never saved them is not switched.
  const model = SRC("models/restaurantModel.js");
  assert.match(model, /delivery: \{ type: Boolean, default: true \},\n\s+table: \{ type: Boolean, default: true \}/);
});
