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
// The store's own PIN, 4321. There is no default PIN any more (security audit, 2026-11-03).
const PIN_HASH = require("bcrypt").hashSync("4321", 4);
const withStore = async (fn, store = { _id: "rest-pin-test", securityPin: PIN_HASH }) => {
  const orig = Restaurant.findOne;
  Restaurant.findOne = async () => store;
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
      assert.equal(await guards(stack, { user: owner, headers: { "x-staff-pin": "4321" } }), "next", `${m}: typed PIN`);
      assert.equal((await guards(stack, { user: staff, headers: { "x-staff-pin": "4321" } })).status, 403, `${m}: staff stays refused`);
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
      assert.equal(await run(pinGuard, { user: staff, headers: { "x-staff-pin": "4321" } }), "next", at);
      assert.equal(await run(pinGuard, { user: staff, body: { pin: "4321" } }), "next", at);
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

test("security audit: no default PIN; a store without one says so, and wrong PINs lock out", async () => {
  const stack = stackOf("restaurantRoute.js", "/staff/:staffId", "put");
  // No PIN set: the old default 8796 opens nothing, and the owner is told to set one.
  await withStore(async () => {
    const r = await guards(stack, { user: owner, headers: { "x-staff-pin": "8796" } });
    assert.equal(r.code, "NO_PIN_SET");
  }, { _id: "rest-no-pin" });
  // Five wrong PINs, then even the right one is refused for a while.
  const locked = { ...owner, _id: "owner-lock-test" };
  await withStore(async () => {
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await guards(stack, { user: locked, headers: { "x-staff-pin": "0000" } })).code, "PIN_REQUIRED");
    }
    const r = await guards(stack, { user: locked, headers: { "x-staff-pin": "4321" } });
    assert.equal(r.status, 429);
    assert.equal(r.code, "PIN_LOCKED");
  }, { _id: "rest-lock-test", securityPin: PIN_HASH });
});
