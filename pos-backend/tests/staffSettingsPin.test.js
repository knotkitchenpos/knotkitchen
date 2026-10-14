const { test } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const config = require("../config/config");
const Restaurant = require("../models/restaurantModel");
const User = require("../models/userModel");
const { addStaffMember } = require("../controllers/restaurantController");

/**
 * QA N032-N034: a staff role change or delete asks even the owner for the
 * Security PIN, settings saves need the PIN typed for that save (the 15-minute
 * token from an earlier discount or Reports unlock no longer opens them), and
 * a staff phone must be a real Indian mobile.
 */
const RID = "507f1f77bcf86cd799439011";
const owner = { _id: "507f1f77bcf86cd799439022", role: "Owner", restaurantId: RID };
const staff = { _id: "507f1f77bcf86cd799439033", role: "Staff", restaurantId: RID };
const pinToken = (user) => jwt.sign({ userId: user._id, elevated: true }, config.accessTokenSecret, { expiresIn: "15m" });

const run = async (mw, req) => {
  let result = "next";
  await mw({ headers: {}, body: {}, cookies: {}, ...req }, {}, (err) => {
    if (err) result = err;
  });
  return result;
};
const stackOf = (routeFile, path, method) => {
  const router = require(`../routes/${routeFile}`);
  const layer = router.stack.find((l) => l.route?.path === path && l.route.methods[method]);
  return layer.route.stack.filter((s) => s.method === method).map((s) => s.handle);
};
// Every guard between isVerifiedUser and the handler, in order.
const guards = async (stack, req) => {
  for (const mw of stack.slice(1, -1)) {
    const r = await run(mw, req);
    if (r !== "next") return r;
  }
  return "next";
};
// No saved PIN on the store, so the default 8796 applies.
const withStore = async (fn) => {
  const orig = Restaurant.findOne;
  Restaurant.findOne = async () => ({});
  try {
    await fn();
  } finally {
    Restaurant.findOne = orig;
  }
};

test("REGRESSION N032: changing a staff role or deleting staff asks the owner for the typed PIN", async () => {
  await withStore(async () => {
    for (const m of ["put", "delete"]) {
      const stack = stackOf("restaurantRoute.js", "/staff/:staffId", m);
      assert.equal((await guards(stack, { user: owner })).code, "PIN_REQUIRED", `${m}: no PIN`);
      assert.equal((await guards(stack, { user: owner, headers: { "x-staff-pin-token": pinToken(owner) } })).code, "PIN_REQUIRED", `${m}: earlier token`);
      assert.equal((await guards(stack, { user: owner, headers: { "x-staff-pin": "1111" } })).code, "PIN_REQUIRED", `${m}: wrong PIN`);
      assert.equal(await guards(stack, { user: owner, headers: { "x-staff-pin": "8796" } }), "next", `${m}: typed PIN`);
      assert.equal((await guards(stack, { user: staff, headers: { "x-staff-pin": "8796" } })).status, 403, `${m}: staff stays refused`);
    }
  });
});

test("REGRESSION N034: an earlier PIN token does not unlock store settings; a typed PIN does", async () => {
  const settings = [
    ["websiteRoute.js", "/settings"],
    ["restaurantRoute.js", "/pos-settings"],
    ["restaurantRoute.js", "/order-toggles"],
    ["restaurantRoute.js", "/timings"],
    ["restaurantRoute.js", "/holidays"],
    ["restaurantRoute.js", "/closed-for-today"],
    ["tableRoute.js", "/settings"],
  ];
  await withStore(async () => {
    for (const [file, path] of settings) {
      const pinGuard = stackOf(file, path, "put")[1]; // [0] is isVerifiedUser; plan gates come after
      const at = `${file} ${path}`;
      assert.equal((await run(pinGuard, { user: staff, headers: { "x-staff-pin-token": pinToken(staff) } })).code, "PIN_REQUIRED", at);
      assert.equal((await run(pinGuard, { user: staff, cookies: { staffPinToken: pinToken(staff) } })).code, "PIN_REQUIRED", at);
      assert.equal(await run(pinGuard, { user: staff, headers: { "x-staff-pin": "8796" } }), "next", at);
      assert.equal(await run(pinGuard, { user: staff, body: { pin: "8796" } }), "next", at);
      assert.equal(await run(pinGuard, { user: owner }), "next", `${at}: owner`);
    }
  });
});

test("REGRESSION N033: a staff phone must be a real Indian mobile", async () => {
  const { findOne, create } = User;
  const created = [];
  User.findOne = async () => null;
  User.create = async (d) => {
    created.push(d.phone);
    throw new Error("stop before the audit log");
  };
  try {
    const add = (phone) => run(addStaffMember, { user: { role: "Owner", restaurantId: "r1" }, body: { name: "Asha", phone } });
    for (const phone of ["0000000000", "1234567890", "98300"]) {
      const err = await add(phone);
      assert.equal(err?.status, 400, phone);
      assert.match(err.message, /valid 10-digit mobile/);
    }
    assert.deepEqual(created, []);
    await add("+91 98300 12345");
    assert.deepEqual(created, ["9830012345"]);
  } finally {
    User.findOne = findOne;
    User.create = create;
  }
});
