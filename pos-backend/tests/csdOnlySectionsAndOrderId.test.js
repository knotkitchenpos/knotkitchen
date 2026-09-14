const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { csdOnly } = require("../middlewares/csdOnly");

const SRC = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const FE = (...p) => fs.readFileSync(path.join(__dirname, "..", "..", "pos-frontend", ...p), "utf8");

/**
 * The Activity Log belongs to CSD, Manage Website belongs to the restaurant,
 * and an order has one id.
 *
 * Manage Website was CSD-only for a while: the tile was pulled from POS
 * Settings and every storefront field was refused for a non-CSD caller. That
 * is reversed -- an owner configures their own website -- so the tests below
 * assert the way BACK is open, and that reopening it did not also reopen the
 * audit trail, which is a different question and still support's.
 */

// ---------------------------------------------------------------------------
// CSD-only sections
// ---------------------------------------------------------------------------

const call = (mw, req) => {
  let err = null;
  mw(req, {}, (e) => {
    err = e || null;
  });
  return err;
};

test("a POS caller is refused, CSD passes", () => {
  const mw = csdOnly("Activity Log");
  const owner = call(mw, { user: { role: "Owner" } });
  assert.equal(owner?.status, 403, "Owner is refused too -- this is a tenant boundary");
  assert.match(owner.message, /Activity Log/);

  assert.equal(call(mw, { user: { role: "Staff" } })?.status, 403);
  assert.equal(call(mw, { csdStaff: { _id: "c1" } }), null, "CSD passes");
});

test("REGRESSION: the audit endpoint is locked, not merely hidden", () => {
  // Removing the tile from Settings is presentation. The endpoint stayed open,
  // so anyone replaying the request still read the whole audit trail.
  assert.match(
    SRC("routes", "teamRoute.js"),
    /router\.route\("\/audit\/:restaurantId"\)\.get\(isVerifiedUser, csdOnly\("Activity Log"\), getAuditLogs\);/,
  );
});

test("no storefront field is refused for being a support-only section", () => {
  // The tenant boundary is gone: there is no list of fields a restaurant may
  // not write, and nothing in this controller turns a POS caller away for not
  // being support.
  const ctrl = SRC("controllers", "websiteSettingsController.js");
  assert.ok(
    !/CSD_ONLY_FIELDS/.test(ctrl),
    "the CSD-only field list is back -- Manage Website belongs to the restaurant",
  );
  assert.ok(
    !/handled by KnotKitchen support/.test(ctrl),
    "a storefront write is refused with the support message again",
  );

  // The route stays open, or the rest of Settings dies with it: Order Toggles
  // and Rules & Charges write `ordering`, `couponsConfig` and `freeItemConfig`
  // through this same endpoint.
  assert.match(
    SRC("routes", "websiteRoute.js"),
    /\.put\(isVerifiedUser, requireProtectedAction, updateWebsiteSettings\);/,
  );
  assert.ok(
    !/csdOnly/.test(SRC("routes", "websiteRoute.js")),
    "no route under /api/website may be support-only",
  );
});

test("the payment gateway is still Owner-only inside the restaurant", () => {
  // Opening Manage Website to the restaurant is not the same as opening the
  // takings to every waiter. This rule is about privilege INSIDE the tenant
  // and survives the boundary being removed.
  assert.match(
    SRC("controllers", "websiteSettingsController.js"),
    /Only the Store Owner can configure payment gateways\./,
  );
  assert.match(SRC("routes", "websiteRoute.js"), /requireOwnerOnly, validateGatewayCredentials/);
});

test("the storefront read stays open to the till", () => {
  // OrderPanel and Reports treat it as the authoritative source for online
  // pricing; locking the GET would stop orders, not lock a section.
  assert.match(SRC("routes", "websiteRoute.js"), /\.get\(isVerifiedUser, getWebsiteSettings\)/);
});

test("Manage Website is reachable from the POS, the Activity Log is not", () => {
  const settings = FE("src", "pages", "Settings.jsx");
  assert.match(settings, /title: "\d+\. Manage Website"/, "the tile is missing from POS Settings");
  assert.ok(
    !/title: "\d+\. Activity Log & Audit Trail"/.test(settings),
    "the Activity Log is support's, and stays out of the POS",
  );

  // A tile that navigates nowhere is the failure this catches: the route used
  // to redirect straight back to /settings.
  const app = FE("src", "App.jsx");
  assert.match(app, /path="\/website" element=\{<ProtectedRoutes><WebsiteSettings \/><\/ProtectedRoutes>\}/);
});

// ---------------------------------------------------------------------------
// One order, one id
// ---------------------------------------------------------------------------

test("REGRESSION: no screen derives an order id by hand any more", () => {
  // The Orders header cut the last SIX characters of the id while the "Order
  // ID" field on the same panel cut the last EIGHT, so one order read #7CA1AC
  // and 657CA1AC at once.
  for (const f of ["Orders.jsx", "Reports.jsx", "KDS.jsx", "OnlineOrders.jsx"]) {
    const src = FE("src", "pages", f);
    assert.ok(
      !/orderNumber \|\| \w+\._id\.slice\(/.test(src),
      `${f} still derives the id inline`,
    );
    assert.match(src, /orderDisplayId\(/, `${f} must use the shared helper`);
  }
});

test("the helper prefers the issued number and falls back to a FIXED length", () => {
  const util = FE("src", "utils", "orderLabels.js");
  assert.match(util, /export const ORDER_ID_FALLBACK_LEN = 6;/);
  assert.match(util, /slice\(-ORDER_ID_FALLBACK_LEN\)\.toUpperCase\(\)/);
  assert.match(util, /if \(issued\) return issued;/, "a real order number always wins");
});

test("REGRESSION: the e-bill quotes the order number, not the session code", () => {
  // sessionCode came first, so a table order carried one identifier on the
  // e-bill and a different one everywhere else, and an operator holding a
  // bill could not find the order.
  const src = SRC("services", "receiptService.js");
  const block = src.slice(src.indexOf("const orderNumber ="), src.indexOf('"N/A";') + 6);
  assert.ok(
    block.indexOf("order?.orderNumber") < block.indexOf("tableSession?.sessionCode"),
    "the order number must be preferred",
  );
  assert.match(block, /tableSession\?\.sessionCode/, "still a fallback for a session with no order");
});

// ---------------------------------------------------------------------------
// Per-store local lists
// ---------------------------------------------------------------------------

test("REGRESSION: locally-created groups and areas are scoped to one store", () => {
  // Stored under a bare key, the browser handed the same list to every store:
  // a newly created takeaway opened with the previous one's groups already in
  // it, and editing them changed both.
  const store = FE("src", "utils", "storeSession.js");
  assert.match(store, /\$\{key\}:\$\{storeId\}/);
  assert.match(store, /localStorage\.getItem\(key\)/, "old unscoped values still readable once");

  for (const [f, key] of [
    [["src", "components", "dashboard", "ManageMenu.jsx"], "kk_custom_groups"],
    [["src", "pages", "Tables.jsx"], "kk_custom_areas"],
  ]) {
    const src = FE(...f);
    assert.match(src, new RegExp(`writeStoreScoped\\("${key}"`), `${key} must be written scoped`);
    assert.ok(
      !new RegExp(`localStorage\\.setItem\\("${key}"`).test(src),
      `${key} is still written unscoped`,
    );
  }
});
