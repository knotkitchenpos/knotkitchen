const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const FE = (rel) => fs.readFileSync(path.join(__dirname, "..", "..", "pos-frontend", rel), "utf8");

/**
 * A restaurant locked for non-payment stops taking website and table QR
 * orders: nobody on its POS can accept them, and website orders are paid up
 * front.
 */

test("isOrderingLocked follows the account lock, and fails open", async () => {
  const { BusinessBalance } = require("../models/businessBalanceModel");
  const { isOrderingLocked } = require("../services/accountLock");
  const original = BusinessBalance.findOne;
  try {
    BusinessBalance.findOne = () => ({ select: () => ({ lean: async () => ({ lockedAt: new Date() }) }) });
    assert.equal(await isOrderingLocked("r1"), true);

    BusinessBalance.findOne = () => ({ select: () => ({ lean: async () => ({ lockedAt: null }) }) });
    assert.equal(await isOrderingLocked("r1"), false);

    BusinessBalance.findOne = () => ({ select: () => ({ lean: async () => { throw new Error("db down"); } }) });
    assert.equal(await isOrderingLocked("r1"), false, "a paid restaurant must not close on a hiccup");

    assert.equal(await isOrderingLocked(null), false);
  } finally {
    BusinessBalance.findOne = original;
  }
});

test("a locked store's website is down: the resolver reports it unavailable", async () => {
  const Module = require("module");
  const orig = Module._load;
  let locked = true;
  const settings = { storeId: "148379", restaurantId: "r1", enabled: true };
  Module._load = function (r) {
    if (r === "../models/websiteSettingsModel") return { findOne: async () => settings };
    if (r === "./websitePublish") return { applyPublishedSnapshot: () => {} };
    if (r === "../models/storeModel") return { findOne: async () => ({ storeId: "148379", status: "active" }) };
    if (r === "../models/restaurantModel") return { findById: async () => ({ _id: "r1", isActive: true }) };
    if (r === "./planFeatures") return { hasWebsite: async () => true };
    if (r === "./accountLock") return { isOrderingLocked: async () => locked };
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve("../services/storefrontResolver")];
  try {
    const { resolveStorefront, REASON_MESSAGES } = require("../services/storefrontResolver");
    const down = await resolveStorefront({ identifier: "148379" });
    assert.deepEqual([down.ok, down.status, down.reason, down.locked], [false, 403, "STORE_UNAVAILABLE", true]);
    assert.match(REASON_MESSAGES.STORE_UNAVAILABLE, /online store is temporarily unavailable/);

    locked = false;
    const up = await resolveStorefront({ identifier: "148379" });
    assert.equal(up.ok, true);
  } finally {
    Module._load = orig;
    delete require.cache[require.resolve("../services/storefrontResolver")];
  }
});

test("N1: a closed store is locked for ordering even before any lock was stored", async () => {
  const { BusinessBalance } = require("../models/businessBalanceModel");
  const Store = require("../models/storeModel");
  const Restaurant = require("../models/restaurantModel");
  const { isOrderingLocked, isStoreClosed } = require("../services/accountLock");
  const RID = "64b000000000000000000009";
  const saved = [BusinessBalance.findOne, Store.exists, Restaurant.findById];
  let status = "closed";
  try {
    BusinessBalance.findOne = () => ({ select: () => ({ lean: async () => null }) });
    Restaurant.findById = () => ({ select: () => ({ lean: async () => ({ storeId: "148379" }) }) });
    Store.exists = async (filter) => {
      assert.deepEqual(filter.$or, [{ restaurantId: RID }, { storeId: "148379" }], "found by either key");
      return filter.status === status ? { _id: "s1" } : null;
    };
    assert.equal(await isStoreClosed(RID), true);
    assert.equal(await isOrderingLocked(RID), true, "QR ordering and the website stop at once");
    status = "active";
    assert.equal(await isOrderingLocked(RID), false);
  } finally {
    [BusinessBalance.findOne, Store.exists, Restaurant.findById] = saved;
  }
});

test("N4: a paid checkout is settled whatever the store's state; only new ones are refused", async () => {
  const Module = require("module");
  const orig = Module._load;
  const store = { storeId: "148379", status: "closed" };
  const settings = { storeId: "148379", restaurantId: "r1", enabled: false };
  Module._load = function (r) {
    if (r === "../models/websiteSettingsModel") return { findOne: async () => settings };
    if (r === "./websitePublish") return { applyPublishedSnapshot: () => {} };
    if (r === "../models/storeModel") return { findOne: async () => store };
    if (r === "../models/restaurantModel") return { findById: async () => ({ _id: "r1", isActive: true }) };
    if (r === "./planFeatures") return { hasWebsite: async () => false };
    if (r === "./accountLock") return { isOrderingLocked: async () => true };
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve("../services/storefrontResolver")];
  try {
    const { resolveStorefront } = require("../services/storefrontResolver");
    const refused = await resolveStorefront({ identifier: "148379" });
    assert.deepEqual([refused.ok, refused.status, refused.reason], [false, 403, "STORE_UNAVAILABLE"], "closed: no new checkout");
    const honoured = await resolveStorefront({ identifier: "148379", honourPaid: true });
    assert.equal(honoured.ok, true, "closed, locked and website off: the paid order is still placed");
    assert.deepEqual([String(honoured.restaurantId), honoured.storeId], ["r1", "148379"]);
  } finally {
    Module._load = orig;
    delete require.cache[require.resolve("../services/storefrontResolver")];
  }

  const ctrl = SRC("controllers/storefrontController.js");
  const verify = ctrl.slice(ctrl.indexOf("const verifyStorefrontCheckout"), ctrl.indexOf("/** Customer-facing projection"));
  assert.match(verify, /requireStorefront\(req, next, \{ honourPaid: true \}\)/, "verify honours a paid checkout");
  assert.equal((ctrl.match(/honourPaid: true/g) || []).length, 1, "nothing else skips the refusal");
});

test("every way a customer orders checks it", () => {
  // The website, its checkout and table booking all go through the resolver,
  // which refuses a locked store; the refusal carries its reason as `code`.
  const storefront = SRC("controllers/storefrontController.js");
  assert.match(storefront, /error\.code = result\.reason;/, "customer-web can tell 'temporarily unavailable' apart");
  assert.match(SRC("controllers/tableBookingController.js"), /const ctx = await resolveStorefront\(/, "table booking");

  const qr = SRC("controllers/qrController.js");
  assert.equal((qr.match(/if \(await accountLock\(\)\.isOrderingLocked\(restaurantId\)\)/g) || []).length, 1, "the QR order route");
  assert.match(qr, /orderingPaused: await accountLock\(\)\.isOrderingLocked\(restaurantId\)/, "the QR page is told");

  // A seated party can still pay and call a waiter: those routes are not gated.
  for (const handler of ["paymentIntent", "paymentVerify", "callWaiter"]) {
    const at = qr.indexOf(`const ${handler} = async`);
    assert.ok(at >= 0, handler);
    const body = qr.slice(at, qr.indexOf("\nconst ", at + 10));
    assert.ok(!/isOrderingLocked/.test(body), `${handler} must stay open`);
  }

  const page = FE("src/pages/OrderOnline.jsx");
  assert.match(page, /disabled=\{placing \|\| Boolean\(paused\)\}/);
});
