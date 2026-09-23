const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const jwt = require("jsonwebtoken");

const config = require("../config/config");
const { requirePermission, requireProtectedAction } = require("../middlewares/requirePermission");
const { STAFF_ROLES, updateStaffRole } = require("../controllers/restaurantController");

const STAFF_ID = "507f1f77bcf86cd799439022";
// Exactly what Manage Staff creates.
const staffUser = { _id: STAFF_ID, role: "Staff", restaurantId: "507f1f77bcf86cd799439011", permissions: ["orders.read", "orders.write"] };
const pinToken = () =>
  jwt.sign({ userId: STAFF_ID, elevated: true }, config.accessTokenSecret, { expiresIn: "15m" });

const run = async (mw, req) => {
  let result = "next";
  await mw({ headers: {}, body: {}, ...req }, {}, (err) => {
    if (err) result = err;
  });
  return result;
};

test("REGRESSION: a staff account can free a table and show its QR without being granted it", async () => {
  assert.equal(await run(requirePermission("TABLE_UPDATE"), { user: staffUser }), "next");
  assert.equal(await run(requirePermission("TABLE_READ"), { user: staffUser }), "next");
  // Nothing else comes for free.
  assert.equal((await run(requirePermission("PAYMENT_CREATE"), { user: staffUser })).status, 403);
});

test("REGRESSION: the Security PIN lets staff upload product photos", async () => {
  const noPin = await run(requirePermission("MENU_MANAGE", { pin: true }), { user: staffUser });
  assert.equal(noPin.status, 403);
  assert.equal(noPin.code, "PIN_REQUIRED", "the POS asks for the PIN on this code");
  const withPin = await run(requirePermission("MENU_MANAGE", { pin: true }), {
    user: staffUser,
    headers: { "x-staff-pin-token": pinToken() },
  });
  assert.equal(withPin, "next");
  const routes = fs.readFileSync(path.join(__dirname, "..", "routes", "mediaRoute.js"), "utf8");
  assert.equal((routes.match(/requirePermission\("MENU_MANAGE", \{ pin: true \}\)/g) || []).length, 3);
});

test("every PIN refusal carries PIN_REQUIRED, so every screen can ask for it", async () => {
  const err = await run(requireProtectedAction, { user: staffUser });
  assert.equal(err.status, 403);
  assert.equal(err.code, "PIN_REQUIRED");
});

test("the owner picks a role from a short list; anything else is refused", async () => {
  assert.deepEqual(STAFF_ROLES, ["Staff", "Cashier", "Manager"]);
  for (const role of ["Owner", "Admin", "superadmin", "", undefined]) {
    const err = await run(updateStaffRole, { user: { role: "Owner", restaurantId: "r1" }, params: { staffId: STAFF_ID }, body: { role } });
    assert.equal(err.status, 400, String(role));
  }
  const routes = fs.readFileSync(path.join(__dirname, "..", "routes", "restaurantRoute.js"), "utf8");
  assert.match(routes, /router\.route\("\/staff\/:staffId"\)\.put\(isVerifiedUser, requireOwnerOnly, updateStaffRole\);/);
});

test("REGRESSION: replacing or revoking a table QR still needs the PIN", () => {
  // The TABLE_UPDATE default is for freeing tables; a replaced QR kills the
  // printed card on the table.
  const tq = fs.readFileSync(path.join(__dirname, "..", "routes", "tableQRRoute.js"), "utf8");
  assert.match(tq, /regenerate"\)\.post\(isVerifiedUser, requireProtectedAction, requirePermission\("TABLE_UPDATE"\)/);
  assert.match(tq, /revoke"\)\.post\(isVerifiedUser, requireProtectedAction, requirePermission\("TABLE_UPDATE"\)/);
  const qr = fs.readFileSync(path.join(__dirname, "..", "routes", "qrRoute.js"), "utf8");
  assert.match(qr, /generate"\)\.post\(isVerifiedUser, requireProtectedAction, requirePermission\("TABLE_UPDATE"\)/);
});

test("REGRESSION: an owner row with no store cannot reach another store's staff", async () => {
  const err = await run(updateStaffRole, { user: { role: "Owner" }, params: { staffId: STAFF_ID }, body: { role: "Manager" } });
  assert.equal(err.status, 403);
});
