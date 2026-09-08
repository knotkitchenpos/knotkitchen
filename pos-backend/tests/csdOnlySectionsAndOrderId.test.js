const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { csdOnly } = require("../middlewares/csdOnly");

const SRC = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const FE = (...p) => fs.readFileSync(path.join(__dirname, "..", "..", "pos-frontend", ...p), "utf8");

/**
 * Manage Website and the Activity Log belong to CSD, and an order has one id.
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

test("REGRESSION: locking Manage Website did not take Order Toggles with it", () => {
  // POS Settings writes `ordering`, `couponsConfig` and `freeItemConfig`
  // through the SAME endpoint. A route-level lock would have broken Order
  // Toggles and Rules & Charges, so the boundary is per field.
  const ctrl = SRC("controllers", "websiteSettingsController.js");
  for (const open of ["ordering", "couponsConfig", "freeItemConfig"]) {
    assert.ok(
      !new RegExp(`"${open}",`).test(ctrl.slice(ctrl.indexOf("const CSD_ONLY_FIELDS"), ctrl.indexOf("];"))),
      `${open} must stay writable from the POS`,
    );
  }
  for (const locked of ["branding", "theme", "paymentGateways", "customDomain", "banners"]) {
    assert.match(
      ctrl.slice(ctrl.indexOf("const CSD_ONLY_FIELDS"), ctrl.indexOf("];")),
      new RegExp(`"${locked}",`),
      `${locked} belongs to Manage Website`,
    );
  }

  // And the route itself stays open, or the rest of Settings dies with it.
  assert.match(
    SRC("routes", "websiteRoute.js"),
    /\.put\(isVerifiedUser, requireProtectedAction, updateWebsiteSettings\);/,
  );
});

test("the storefront read stays open to the till", () => {
  // OrderPanel and Reports treat it as the authoritative source for online
  // pricing; locking the GET would stop orders, not lock a section.
  assert.match(SRC("routes", "websiteRoute.js"), /\.get\(isVerifiedUser, getWebsiteSettings\)/);
});

test("neither section is offered in the POS any more", () => {
  const settings = FE("src", "pages", "Settings.jsx");
  assert.ok(!/title: "10\. Manage Website"/.test(settings));
  assert.ok(!/title: "11\. Activity Log & Audit Trail"/.test(settings));
  assert.match(FE("src", "App.jsx"), /path="\/website" element=\{<Navigate to="\/settings" replace \/>\}/);
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
