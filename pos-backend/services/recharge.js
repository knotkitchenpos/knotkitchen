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
const RechargeOrder = require("../models/rechargeOrderModel");
const Restaurant = require("../models/restaurantModel");
const { resolvePlatformGateway } = require("./paymentGateway");
const cashfree = require("./gateways/cashfree");
const { credit } = require("./ledger");
const { settlePendingCharges } = require("./orderCharge");
const { evaluateLock } = require("./accountLock");
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
      "KnotKitchen's payment gateway is not set up yet, so balance top-ups cannot be taken. Please contact KnotKitchen support.",
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
const createRecharge = async ({ restaurantId, amountPaise, createdBy = null, returnUrl } = {}) => {
  const amount = Math.round(Number(amountPaise) || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new RechargeError("Enter an amount greater than zero.");
  }
  // Cashfree bills in rupees; a fraction of a paise cannot be collected, and
  // crediting more than was charged is the wrong way to round.
  if (amount % 1 !== 0) throw new RechargeError("Amount must be a whole number of paise.");

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
        phone: restaurant.ownerPhone || restaurant.phone || "",
        email: restaurant.ownerEmail || restaurant.email || "",
      },
      returnUrl,
      // So a top-up is credited even if the operator closes the payment window
      // before the POS can verify it (the webhook credits through the same key).
      notifyUrl: require("../config/config").cashfreeNotifyUrl,
      tags: { purpose: "business_balance_recharge", restaurantId: String(restaurantId) },
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
  if (intent.status === "PAID") return { credited: false, already: true, intent };

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

  const { entry } = await credit({
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

  // Money just arrived, so anything owed can now be collected. Never allowed
  // to fail the top-up -- the credit already happened and is not in doubt.
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

  return { credited: true, intent, entry, settled, lock };
};

module.exports = {
  createRecharge,
  finalizeRecharge,
  idempotencyKeyFor,
  RechargeError,
};
