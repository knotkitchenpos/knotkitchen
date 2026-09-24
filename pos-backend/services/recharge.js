/**
 * Topping up the KnotKitchen Business Balance.
 *
 * The one thing that distinguishes this from every other payment in the
 * system: the money is KnotKitchen's, not the restaurant's. It therefore uses
 * `resolvePlatformGateway` and never `resolveGateway` -- the latter prefers a
 * store's own Cashfree account so diners pay restaurants directly, and running
 * a recharge through it would pay the restaurant its own money while still
 * crediting its balance here. Free balance, funded by nobody.
 *
 * Trust model matches the diner webhook: the intent row is written before the
 * browser leaves, the callback is only ever used to look that row up, and the
 * amount is read back from Cashfree rather than believed from the payload.
 * Nothing credits a balance on a client's say-so.
 */

const crypto = require("crypto");
const { SUPPORT_PHONE } = require("../constants/support");
const RechargeOrder = require("../models/rechargeOrderModel");
const Restaurant = require("../models/restaurantModel");
const { resolvePlatformGateway } = require("./paymentGateway");
const cashfree = require("./gateways/cashfree");
const { credit } = require("./ledger");
const { settlePendingCharges } = require("./orderCharge");
const { evaluateLock } = require("./accountLock");
const { afterRecharge, minimumTopUpPaise } = require("./subscription");
const { toPaise, toRupees, formatINR } = require("./money");

class RechargeError extends Error {
  constructor(message, status = 400, code = "") {
    super(message);
    this.name = "RechargeError";
    this.status = status;
    if (code) this.code = code;
    // Every message here is written to be read by whoever pressed the button.
    // Without this a 503 reaches them as "Internal server error", which reads
    // as a crash rather than as "someone has not finished the setup".
    this.expose = true;
  }
}

/** One key per gateway order, so a redelivered callback credits once. */
const idempotencyKeyFor = (gatewayOrderId) => `recharge-${gatewayOrderId}`;

const newGatewayOrderId = (restaurantId) =>
  `KKBAL-${String(restaurantId).slice(-6)}-${Date.now().toString(36)}-${crypto
    .randomBytes(3)
    .toString("hex")}`.toUpperCase();

const platformOrThrow = () => {
  const gw = resolvePlatformGateway();
  if (!gw.enabled) {
    throw new RechargeError(
      "KnotKitchen's payment gateway is not set up yet, so balance top-ups cannot be taken. Please contact KnotKitchen support on " + SUPPORT_PHONE + ".",
      503,
      "GATEWAY_NOT_CONFIGURED",
    );
  }
  return gw;
};

/**
 * Open a top-up.
 *
 * Returns the payment session the browser hands to Cashfree's SDK. No balance
 * moves here -- only `finalizeRecharge` credits, and only after asking
 * Cashfree what actually happened.
 */
/** Only our own https origins may be a checkout's return page. */
const ownReturnUrl = (raw) => {
  try {
    const url = new URL(String(raw || ""));
    return url.protocol === "https:" && require("../config/config").frontendUrls.includes(url.origin) ? url.href : undefined;
  } catch {
    return undefined;
  }
};

const createRecharge = async ({ restaurantId, amountPaise, createdBy = null, returnUrl } = {}) => {
  const amount = Math.round(Number(amountPaise) || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new RechargeError("Enter an amount greater than zero.");
  }
  // Cashfree bills in rupees; a fraction of a paise cannot be collected, and
  // crediting more than was charged is the wrong way to round.
  if (amount % 1 !== 0) throw new RechargeError("Amount must be a whole number of paise.");

  // Until the POS plan has started, one top-up has to cover the minimum: that
  // top-up is what starts it (services/subscription afterRecharge).
  const minimum = await minimumTopUpPaise(restaurantId);
  if (amount < minimum) {
    throw new RechargeError(
      `The first top-up must be at least ${formatINR(minimum)}. Your POS plan starts automatically when it arrives, and the rest stays in your wallet.`,
      400,
      "FIRST_TOPUP_MINIMUM",
    );
  }

  return openPayment({ restaurantId, amountPaise: amount, createdBy, returnUrl });
};

/**
 * Buy a printer through the gateway: the price + GST is charged by Cashfree,
 * not taken from the wallet. finalizeRecharge records the printer when paid.
 */
const createPrinterPayment = async ({ restaurantId, code, acceptance, shipTo = null, createdBy = null, returnUrl } = {}) => {
  const { printer, pricePaise, totalPaise, lines } = await require("./subscription").preparePrinterPayment({ restaurantId, code, acceptance });
  return openPayment({
    restaurantId,
    amountPaise: totalPaise,
    createdBy,
    returnUrl,
    purpose: "PRINTER",
    item: { code: printer.code, name: printer.name, pricePaise, lines, shipTo },
  });
};

/** Open a Cashfree order for a top-up or a printer. Nothing is credited or bought here. */
const openPayment = async ({ restaurantId, amountPaise: amount, createdBy = null, returnUrl, purpose = "RECHARGE", item } = {}) => {
  const gw = platformOrThrow();

  const restaurant = await Restaurant.findById(restaurantId)
    .select("name storeName ownerPhone phone ownerEmail email")
    .lean();
  if (!restaurant) throw new RechargeError("Restaurant not found.", 404);

  const gatewayOrderId = newGatewayOrderId(restaurantId);

  // Written BEFORE the customer leaves. A callback naming an order we never
  // opened has to find nothing.
  const intent = await RechargeOrder.create({
    restaurantId,
    amountPaise: amount,
    purpose,
    ...(item ? { item } : {}),
    gatewayOrderId,
    gatewayProvider: "cashfree",
    environment: gw.environment,
    createdBy,
  });

  try {
    const order = await cashfree.createOrder({
      appId: gw.keyId,
      secretKey: gw.secret,
      environment: gw.environment,
      amount: toRupees(amount),
      orderId: gatewayOrderId,
      customer: {
        id: String(restaurantId),
        name: restaurant.storeName || restaurant.name || "Restaurant",
        // Cashfree needs a 10-digit phone; the delivery contact's will do
        // for a store whose owner phone was never captured.
        phone: restaurant.ownerPhone || restaurant.phone || item?.shipTo?.phone || "",
        email: restaurant.ownerEmail || restaurant.email || "",
      },
      returnUrl,
      // So a top-up is credited even if the operator closes the payment window
      // before the POS can verify it (the webhook credits through the same key).
      notifyUrl: require("../config/config").cashfreeNotifyUrl,
      tags: { purpose: purpose === "PRINTER" ? "printer_purchase" : "business_balance_recharge", restaurantId: String(restaurantId) },
    });

    intent.paymentSessionId = order.paymentSessionId || "";
    await intent.save();

    return {
      rechargeId: intent._id,
      gatewayOrderId,
      paymentSessionId: intent.paymentSessionId,
      environment: gw.environment,
      amountPaise: amount,
      amountLabel: formatINR(amount),
      purpose,
    };
  } catch (err) {
    intent.status = "FAILED";
    intent.failureReason = err?.message || "Could not open the payment.";
    await intent.save();

    // Re-thrown as a RechargeError so the reason survives to the operator.
    // Cashfree's own wording is the useful part ("a 10-digit customer phone
    // number is required", "insufficient permissions"); as a bare
    // CashfreeError it fell through to a masked 500.
    throw new RechargeError(
      err?.message || "The payment could not be opened.",
      502,
      "GATEWAY_REFUSED",
    );
  }
};

/**
 * Settle a top-up against what Cashfree says actually happened.
 *
 * Safe to call from the browser return, from the webhook, and from both at
 * once -- the ledger's idempotency key is what makes the second one a no-op.
 */
const finalizeRecharge = async ({ gatewayOrderId }) => {
  const intent = await RechargeOrder.findOne({ gatewayOrderId });
  if (!intent) return { credited: false, reason: "No such top-up." };
  // Already settled (the webhook got there first): a printer is still reported as bought.
  if (intent.status === "PAID") return { credited: false, already: true, purchased: intent.purpose === "PRINTER", intent };

  const gw = platformOrThrow();

  // A TEST payment must not be able to credit a balance real money is
  // measured in. The environment is recorded on the intent for exactly this.
  if (intent.environment !== gw.environment) {
    return {
      credited: false,
      reason: `Top-up was opened in ${intent.environment} but the gateway is now ${gw.environment}.`,
      intent,
    };
  }

  const status = await cashfree.isOrderPaid({
    appId: gw.keyId,
    secretKey: gw.secret,
    environment: gw.environment,
    orderId: gatewayOrderId,
  });

  if (!status.paid) {
    return { credited: false, reason: `Order is ${status.orderStatus}, not PAID.`, intent };
  }

  // Credit what was PAID, not what was asked for. They should be equal; if
  // they are not, the amount that actually arrived is the honest one.
  const paidPaise = toPaise(status.amount);
  if (paidPaise !== intent.amountPaise) {
    console.warn(
      `[recharge] ${gatewayOrderId}: opened for ${intent.amountPaise}p, paid ${paidPaise}p`,
    );
  }

  // A printer paid through the gateway: record it; the wallet is not touched.
  if (intent.purpose === "PRINTER") {
    const { recorded, invoice } = await require("./subscription").recordPrinterPayment({ intent, paidPaise });
    // KnotKitchen now delivers it. Never fails the payment -- a request that
    // did not open is opened when the store next opens Billing.
    try {
      const requests = require("./hardwareRequests");
      const request = await requests.openRequest({
        type: "PRINTER",
        key: `printer-pay-${intent.gatewayOrderId}`,
        restaurantId: intent.restaurantId,
        item: { code: intent.item?.code, name: intent.item?.name },
        payment: { amountPaise: paidPaise, gatewayOrderId: intent.gatewayOrderId },
        shipTo: intent.item?.shipTo || null,
      });
      // Cancelled and refunded while its invoice was still missing: the one
      // just issued is voided (or noted) now. Every step runs once.
      if (request?.status === "CANCELLED") await requests.settleCancellation(request);
    } catch (err) {
      console.warn("[recharge] opening the printer request failed:", err.message);
    }
    intent.status = "PAID";
    intent.paidAt = intent.paidAt || new Date();
    intent.gatewayPaymentId = status.cfOrderId || "";
    await intent.save();
    return { credited: false, purchased: true, already: !recorded, intent, invoice };
  }

  const { entry, duplicate } = await credit({
    restaurantId: intent.restaurantId,
    kind: "RECHARGE",
    amountPaise: paidPaise,
    description: "Business Balance top-up",
    idempotencyKey: idempotencyKeyFor(gatewayOrderId),
    refType: "RechargeOrder",
    refId: intent._id,
    meta: { gatewayOrderId, cfOrderId: status.cfOrderId || "" },
  });

  intent.status = "PAID";
  intent.paidAt = new Date();
  intent.gatewayPaymentId = status.cfOrderId || "";
  intent.ledgerEntryId = entry._id;
  await intent.save();

  // Money just arrived: start the POS plan (a first top-up at the minimum),
  // earn a tablet credit, renew an expired plan. Only the call that actually
  // credited does this, so a callback racing the browser cannot count twice.
  // Never allowed to fail the top-up -- the credit already happened and is
  // not in doubt.
  let plan = null;
  if (!duplicate) {
    try {
      plan = await afterRecharge({ restaurantId: intent.restaurantId, amountPaise: paidPaise });
    } catch (err) {
      console.warn("[recharge] plan update after top-up failed:", err.message);
    }
  }

  // Anything owed can now be collected, the same way.
  let settled = null;
  try {
    settled = await settlePendingCharges(intent.restaurantId);
  } catch (err) {
    console.warn("[recharge] settling dues after top-up failed:", err.message);
  }

  // "After successful payment, the account should automatically unlock."
  // Awaited, not fired: a caller that just paid should be told, in the same
  // response, that it worked -- not have to poll for it.
  let lock = null;
  try {
    lock = await evaluateLock(intent.restaurantId);
  } catch (err) {
    console.warn("[recharge] lock re-evaluation failed:", err.message);
  }

  return { credited: true, intent, entry, plan, settled, lock };
};

module.exports = {
  createPrinterPayment,
  ownReturnUrl,
  createRecharge,
  finalizeRecharge,
  idempotencyKeyFor,
  RechargeError,
};
