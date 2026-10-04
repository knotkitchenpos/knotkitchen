/**
 * Knot Eats from the POS (owner opt-in) and the CSD (delisting, review
 * moderation).
 *
 * Consent is the point: only the owner can opt in, CSD can never do it for
 * them, and CSD's delisting is admin-only, needs a reason and is audited.
 */
process.env.KNOT_EATS_PUBLIC_URL = "https://eats.knotkitchen.test/";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

const STARTS = new Date("2026-10-15T00:00:00.000Z");
const db = {};
const spies = { invalidate: 0, activity: [], audit: [], updates: [], reviewUpdates: [], findFilters: [] };

const setPath = (obj, path, value) => {
  const keys = path.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = value;
};

const mocks = {
  "../models/websiteSettingsModel": {
    updateOne: async (filter, update) => {
      spies.updates.push([filter, update]);
      for (const [k, v] of Object.entries(update.$set)) setPath(db.settings, k, v);
      return { matchedCount: 1 };
    },
    findOne: () => ({ select: async () => db.settings }),
    find: (filter) => {
      spies.findFilters.push(filter);
      const rows = [db.settings];
      const q = {
        sort: () => q, skip: () => q, limit: () => q, select: () => q,
        lean: async () => rows,
        then: (ok, ko) => Promise.resolve(rows).then(ok, ko),
      };
      return q;
    },
  },
  "../models/storeModel": {
    findOne: () => ({ lean: async () => ({ storeId: "100001", status: "active" }) }),
    find: () => ({ lean: async () => [{ storeId: "100001", status: "active" }] }),
  },
  "../models/restaurantModel": {
    findById: () => ({ lean: async () => db.restaurant }),
    find: () => {
      const q = { select: () => q, lean: async () => [db.restaurant] };
      return q;
    },
  },
  "../models/orderModel": { aggregate: async () => [{ _id: "100001", n: 4 }] },
  "../models/knotEatsReviewModel": {
    findOneAndUpdate: (filter, update) => ({
      lean: async () => {
        spies.reviewUpdates.push([filter, update]);
        Object.assign(db.review, update.$set);
        return { ...db.review };
      },
    }),
  },
  "../services/knotEats": {
    UNAVAILABLE_MESSAGE: "This restaurant isn't on Knot Eats right now.",
    invalidateListing: () => (spies.invalidate += 1),
    getSnapshot: async () => ({ stores: new Map(db.listed ? [["100001", {}]] : []) }),
    buildStoreDishes: async () => [],
    eligibility: async ({ settings }) => {
      const blockers = settings.knotEats?.enabled ? [] : [{ code: "NOT_OPTED_IN", message: "Turn on Knot Eats to list your restaurant." }];
      blockers.push({ code: "NO_GATEWAY", message: "Set up online payment (Cashfree) in Manage Website." });
      return { listed: false, blockers };
    },
    ratingsFor: async (ids) => new Map(ids.map((id) => [id, { rating: 4.3, ratingCount: 27 }])),
    isIndiaPoint: (lat, lng) => lat > 6 && lat < 37.5 && lng > 68 && lng < 97.5,
  },
  "../services/auditService": { logActivity: async (entry) => spies.activity.push(entry) },
  "../services/csdAuditService": { csdAudit: async (entry) => spies.audit.push(entry) },
  "../services/pricing": {
    getPlatformConfig: async () => ({ knotEatsOrderCharge: { enabled: db.feeOn, amountPaise: 900, effectiveFrom: STARTS } }),
    getOverride: async () => db.override,
    resolveOrderCharge: async () => ({ amountPaise: db.override?.knotEatsPaidOrderCharge === 0 ? 0 : 900, taxable: true, startsAt: STARTS }),
  },
  "./websiteSettingsController": {
    loadOwnSettings: async () => ({ tenant: { restaurantId: "r1" }, settings: db.settings }),
  },
};
const orig = Module._load;
Module._load = function (request, parent) {
  if (/controllers[\\/]knotEatsController\.js$/.test(parent?.filename || "") && request in mocks) return mocks[request];
  return orig.apply(this, arguments);
};
const ctrl = require("../controllers/knotEatsController");

const call = async (handler, req) => {
  let status = 200;
  let body = null;
  let err = null;
  const res = { set: () => res, status: (c) => ((status = c), res), json: (b) => ((body = b), res) };
  await handler({ params: {}, query: {}, body: {}, headers: {}, ...req }, res, (e) => (err = e));
  return { status: err ? err.status : status, message: err?.message, data: body?.data };
};
const runGuards = async (stack, req) => {
  for (const layer of stack.slice(0, -1)) {
    let out = "unset";
    await layer.handle(req, {}, (e) => (out = e));
    if (out) return out.status;
  }
  return 200;
};
// router.route(path).get().put() is one route; its layers carry their method.
const routeStack = (router, method, path) =>
  router.stack
    .find((l) => l.route?.path === path && l.route.methods[method])
    .route.stack.filter((l) => l.method === method);

const OWNER = { _id: "u-owner", role: "Owner", restaurantId: "r1" };
const CASHIER = { _id: "u-cash", role: "Cashier", restaurantId: "r1" };
const ADMIN = { staffId: "CSD001", role: "admin", fullName: "Admin" };
const STAFF = { staffId: "CSD042", role: "staff", fullName: "Staff" };

beforeEach(() => {
  Object.assign(spies, { invalidate: 0, activity: [], audit: [], updates: [], reviewUpdates: [], findFilters: [] });
  db.settings = {
    storeId: "100001",
    restaurantId: "r1",
    displayName: "Spice Hub",
    enabled: true,
    ordering: { pickupEnabled: true, deliveryEnabled: true, deliverySlabsConfig: { maxDistanceKm: 7 } },
    knotEats: { enabled: false, delisted: false },
  };
  db.restaurant = { _id: "r1", name: "Spice Hub", address: { city: "Kolkata", lat: 22.5726, lng: 88.3639 } };
  db.review = { _id: "64c000000000000000000001", storeId: "100001", restaurantId: "r1", orderNumber: "W-9", rating: 1, text: "rubbish", hidden: false };
  db.feeOn = true;
  db.override = null;
  db.listed = false;
});

test("POS: only the owner may switch Knot Eats; anyone signed in may look", () => {
  const router = require("../routes/websiteRoute");
  const put = routeStack(router, "put", "/knot-eats");
  assert.deepEqual(put.map((l) => l.name).slice(1), ["requireOwnerOnly", "setKnotEats"]);
  const get = routeStack(router, "get", "/knot-eats");
  assert.deepEqual(get.map((l) => l.name).slice(1), ["getKnotEats"]);
});

test("POS: a non-owner PUT is refused", async () => {
  const stack = routeStack(require("../routes/websiteRoute"), "put", "/knot-eats").slice(1);
  assert.equal(await runGuards(stack, { user: CASHIER }), 403);
  assert.equal(await runGuards(stack, { user: OWNER }), 200);
});

test("POS: the owner opts in; consent is recorded and blockers come back", async () => {
  const before = Date.now();
  const out = await call(ctrl.setKnotEats, { user: OWNER, body: { enabled: true } });
  assert.equal(out.status, 200);
  const [[filter, { $set }]] = spies.updates;
  assert.deepEqual(filter, { storeId: "100001" });
  assert.deepEqual(Object.keys($set).sort(), ["knotEats.enabled", "knotEats.enabledAt", "knotEats.enabledBy"]);
  assert.equal($set["knotEats.enabledBy"], "u-owner");
  assert.ok($set["knotEats.enabledAt"].getTime() >= before);
  assert.equal(spies.activity[0].action, "Knot Eats opt-in");
  assert.equal(spies.invalidate, 1);

  assert.equal(out.data.enabled, true);
  assert.deepEqual(out.data.blockers.map((b) => b.code), ["NO_GATEWAY"], "saved even with blockers");
  assert.deepEqual(out.data.pin, { lat: 22.5726, lng: 88.3639 });
  assert.deepEqual(out.data.fee, { amount: 9, taxable: true, startsAt: STARTS });
  assert.deepEqual([out.data.rating, out.data.ratingCount, out.data.radiusKm], [4.3, 27, 7]);
  assert.equal(out.data.publicUrl, "https://eats.knotkitchen.test/store/100001");

  // Saying "on" again changes nothing and re-dates nothing.
  await call(ctrl.setKnotEats, { user: OWNER, body: { enabled: true } });
  assert.equal(spies.updates.length, 1);

  await call(ctrl.setKnotEats, { user: OWNER, body: { enabled: false } });
  assert.deepEqual(spies.updates[1][1].$set, { "knotEats.enabled": false });
  assert.equal(spies.activity[1].action, "Knot Eats opt-out");

  assert.equal((await call(ctrl.setKnotEats, { user: OWNER, body: { enabled: "yes" } })).status, 400);
});

test("POS: no fee shown when switched off, billing-exempt, or overridden to 0; no pin when invalid", async () => {
  db.feeOn = false;
  assert.equal((await call(ctrl.getKnotEats, { user: CASHIER })).data.fee, null);
  db.feeOn = true;
  db.override = { billingExempt: true };
  assert.equal((await call(ctrl.getKnotEats, { user: CASHIER })).data.fee, null);
  db.override = { knotEatsPaidOrderCharge: 0 };
  assert.equal((await call(ctrl.getKnotEats, { user: CASHIER })).data.fee, null);
  db.restaurant.address = { lat: 88.36, lng: 22.57 };
  assert.equal((await call(ctrl.getKnotEats, { user: CASHIER })).data.pin, null);
});

test("CSD: delisting is admin-only, needs a reason, is audited and invalidates the listing", async () => {
  const csd = require("../routes/csdRoute");
  const stack = routeStack(csd, "patch", "/knot-eats/stores/:storeId");
  assert.equal(await runGuards(stack, { csdStaff: STAFF }), 403);
  assert.equal(await runGuards(stack, { csdStaff: ADMIN }), 200);

  const params = { storeId: "100001" };
  for (const reason of ["", "bad", "x".repeat(301)]) {
    assert.equal((await call(ctrl.csdSetListing, { csdStaff: ADMIN, params, body: { delisted: true, reason } })).status, 400);
  }
  assert.equal(spies.updates.length, 0);

  const out = await call(ctrl.csdSetListing, {
    csdStaff: ADMIN,
    params,
    body: { delisted: true, reason: "Repeated hygiene complaints" },
  });
  assert.equal(out.status, 200);
  const { $set } = spies.updates[0][1];
  assert.equal($set["knotEats.delisted"], true);
  assert.equal($set["knotEats.delistedBy"], "CSD001");
  assert.equal($set["knotEats.delistedReason"], "Repeated hygiene complaints");
  assert.ok($set["knotEats.delistedAt"] instanceof Date);
  assert.equal(spies.invalidate, 1);
  assert.deepEqual([spies.audit[0].action, spies.audit[0].severity, spies.audit[0].storeId], ["KNOT_EATS_DELISTED", "WARNING", "100001"]);
  assert.deepEqual([out.data.delisted, out.data.listed, out.data.orders30d], [true, false, 4]);

  await call(ctrl.csdSetListing, { csdStaff: ADMIN, params, body: { delisted: false } });
  assert.equal(spies.updates[1][1].$set["knotEats.delisted"], false);
  assert.equal(spies.audit[1].action, "KNOT_EATS_RELISTED");
});

test("CSD: nobody in CSD can opt a store in", async () => {
  const out = await call(ctrl.csdSetListing, {
    csdStaff: ADMIN,
    params: { storeId: "100001" },
    body: { enabled: true, delisted: false },
  });
  assert.equal(out.status, 400);
  assert.equal(spies.updates.length, 0);
  assert.equal(db.settings.knotEats.enabled, false);
});

test("CSD: store list filters by state and reports maps usage; canEdit only for admins", async () => {
  const staffView = await call(ctrl.csdListStores, { csdStaff: STAFF, query: { state: "blocked", q: "spice" } });
  assert.equal(staffView.status, 200);
  const [row] = staffView.data.rows;
  assert.deepEqual(
    Object.keys(row).sort(),
    ["blockers", "city", "delisted", "delistedAt", "delistedBy", "delistedReason", "enabled", "enabledAt", "listed",
      "name", "orders30d", "rating", "ratingCount", "storeId"],
  );
  assert.equal(staffView.data.meta.canEdit, false);
  assert.deepEqual(Object.keys(staffView.data.meta.mapsUsage).sort(), ["cap", "day", "used"]);
  const blocked = JSON.stringify(spies.findFilters[0]);
  assert.match(blocked, /"knotEats.enabled":true/);
  assert.match(blocked, /"\$nin"/);
  assert.equal((await call(ctrl.csdListStores, { csdStaff: ADMIN, query: {} })).data.meta.canEdit, true);
});

test("CSD: staff hide a review with a reason; it is audited and the listing rebuilt", async () => {
  const csd = require("../routes/csdRoute");
  const stack = routeStack(csd, "patch", "/knot-eats/reviews/:id");
  assert.equal(stack.length, 1, "no admin guard: any CSD staff moderates");

  const params = { id: db.review._id };
  assert.equal((await call(ctrl.csdSetReviewHidden, { csdStaff: STAFF, params, body: { hidden: true } })).status, 400);
  assert.equal((await call(ctrl.csdSetReviewHidden, { csdStaff: STAFF, params: { id: "nope" }, body: { hidden: true, reason: "x" } })).status, 404);

  const out = await call(ctrl.csdSetReviewHidden, { csdStaff: STAFF, params, body: { hidden: true, reason: "Abusive language" } });
  assert.equal(out.status, 200);
  assert.deepEqual([out.data.hidden, out.data.hiddenBy, out.data.hiddenReason], [true, "CSD042", "Abusive language"]);
  assert.equal(spies.audit[0].action, "KNOT_EATS_REVIEW_HIDDEN");
  assert.equal(spies.invalidate, 1);

  const back = await call(ctrl.csdSetReviewHidden, { csdStaff: STAFF, params, body: { hidden: false } });
  assert.deepEqual([back.data.hidden, back.data.hiddenReason, back.data.hiddenBy], [false, "", ""]);
  assert.equal(spies.audit[1].action, "KNOT_EATS_REVIEW_UNHIDDEN");
});

test("CSD 'Open POS' signs in as the owner but can neither opt the store in nor out", async () => {
  const mongoose = require("mongoose");
  const User = require("../models/userModel");
  const CsdPosSession = require("../models/csdPosSessionModel");
  const { impersonateWithSupportToken } = require("../controllers/userController");
  const { isVerifiedUser } = require("../middlewares/tokenVerification");

  const owner = new User({ name: "Owner", address: "x", role: "Owner", storeId: "100001", password: "not-used-here" });
  owner.save = async () => owner;
  const supportId = new mongoose.Types.ObjectId();
  const saved = { claim: CsdPosSession.findOneAndUpdate, findOne: User.findOne, findById: User.findById };
  CsdPosSession.findOneAndUpdate = async () => ({ _id: supportId, storeId: "100001", staffName: "Staff" });
  User.findOne = async () => owner;
  User.findById = async () => owner;
  try {
    const cookies = {};
    const res = { cookie: (name, value) => (cookies[name] = value), status: () => res, json: () => res };
    let err;
    await impersonateWithSupportToken({ body: { token: "t".repeat(40) }, headers: {}, ip: "", get: () => "" }, res, (e) => (err = e));
    assert.equal(err, undefined, err?.message);

    const req = { cookies, headers: { "x-store-id": "100001" }, baseUrl: "/api/website", path: "/knot-eats" };
    await isVerifiedUser(req, {}, (e) => (err = e));
    assert.equal(err, undefined, err?.message);
    assert.equal(String(req.user.supportPosSessionId), String(supportId), "the session records which CSD visit opened it");
    assert.equal((await call(ctrl.getKnotEats, { user: req.user })).data.supportSession, true, "the POS is told, so it can disable the switch");
    assert.equal((await call(ctrl.getKnotEats, { user: OWNER })).data.supportSession, false);

    for (const enabled of [true, false]) {
      const out = await call(ctrl.setKnotEats, { user: req.user, body: { enabled } });
      assert.equal(out.status, 403, `enabled: ${enabled}`);
      assert.match(out.message, /Only the store owner/);
    }
    assert.deepEqual([spies.updates.length, spies.activity.length, spies.invalidate], [0, 0, 0]);
  } finally {
    Object.assign(CsdPosSession, { findOneAndUpdate: saved.claim });
    Object.assign(User, { findOne: saved.findOne, findById: saved.findById });
  }
});

test("REGRESSION: an 'Open POS' session from before sessions were marked is still refused", async () => {
  const CsdPosSession = require("../models/csdPosSessionModel");
  const createdAt = new Date("2026-10-01T10:00:20Z");
  const saved = CsdPosSession.exists;
  const asked = [];
  // CSD exchanged a token for this store 20 s before the session began.
  CsdPosSession.exists = async (q) => (asked.push(q), q.storeId === "100001" && q.usedAt.$gte <= new Date("2026-10-01T10:00:00Z") ? { _id: "s" } : null);
  try {
    const old = { ...OWNER, storeId: "100001", supportPosSessionId: null, sessionCreatedAt: createdAt };
    const out = await call(ctrl.setKnotEats, { user: old, body: { enabled: true } });
    assert.equal(out.status, 403);
    assert.equal((await call(ctrl.getKnotEats, { user: old })).data.supportSession, true);
    // The owner's own sign-in, with no exchange near it, is not caught.
    const own = { ...OWNER, storeId: "200002", supportPosSessionId: null, sessionCreatedAt: createdAt };
    assert.equal((await call(ctrl.getKnotEats, { user: own })).data.supportSession, false);
    assert.ok(asked.length >= 2);
  } finally {
    CsdPosSession.exists = saved;
  }
});
