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

test("every way a customer orders checks it", () => {
  assert.match(SRC("services/storefrontResolver.js"), /orderingLocked: await isOrderingLocked\(restaurantId\)/);

  const storefront = SRC("controllers/storefrontController.js");
  assert.match(storefront, /if \(ctx\.orderingLocked\) return next\(createHttpError\(409, CUSTOMER_PAUSED_MESSAGE\)\)/, "website checkout");
  assert.match(storefront, /if \(orderingLocked && !preview\)/, "the site shows every channel closed");

  const bookings = SRC("controllers/tableBookingController.js");
  assert.match(bookings, /if \(ctx\.orderingLocked\) throw createHttpError\(409, CUSTOMER_PAUSED_MESSAGE\)/, "table booking");

  const qr = SRC("routes/qrRoute.js");
  assert.equal((qr.match(/if \(await accountLock\(\)\.isOrderingLocked\(restaurantId\)\)/g) || []).length, 2, "both QR order routes");
  assert.match(qr, /orderingPaused: await accountLock\(\)\.isOrderingLocked\(restaurantId\)/, "the QR page is told");

  // A seated party can still pay and call a waiter: those routes are not gated.
  for (const route of ["payment-intent", "payment-verify", "waiter-call/:token"]) {
    const at = qr.indexOf(`router.route("/${route}`);
    const body = qr.slice(at, qr.indexOf("router.route(", at + 10));
    assert.ok(!/isOrderingLocked/.test(body), `${route} must stay open`);
  }

  const page = FE("src/pages/OrderOnline.jsx");
  assert.match(page, /disabled=\{placing \|\| Boolean\(paused\)\}/);
});
