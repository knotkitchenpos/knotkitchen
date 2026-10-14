/**
 * Cashfree PG webhook.
 *
 * The safety net for the case the browser cannot cover: a diner who pays and
 * then closes the tab, loses signal, or gets a phone call before the checkout
 * modal can report back. Without this their table stays open and unpaid even
 * though the money moved.
 *
 * Trust model, in order — nothing is acted on until every step has passed:
 *
 *   1. Parse the body enough to find `order_id`. This is UNTRUSTED; it is
 *      used only to look something up.
 *   2. Find OUR record carrying that gateway order id. If we never opened it,
 *      there is nothing to settle and we stop. This is what stops a forged
 *      event settling an arbitrary bill.
 *   3. Resolve the gateway secret belonging to THAT tenant, and verify the
 *      signature with it. A signature that verifies under some other store's
 *      secret is not good enough.
 *   4. Ask Cashfree what the order status actually is. Even a correctly
 *      signed "success" event is not taken at its word about the money.
 *
 * Acknowledging with 200 is deliberate for every outcome but one: a webhook
 * that answers 4xx or 5xx is retried for days. The exception is a diner's
 * payment we could not apply and could not refund either (or could not apply
 * yet, or refunded but could not record on the table): that answers 500 so
 * Cashfree retries it, and the refund id is fixed per order, so a retry can
 * never refund twice.
 */

const TableSession = require("../models/tableSessionModel");
const PaymentLink = require("../models/paymentLinkModel");
const RechargeOrder = require("../models/rechargeOrderModel");
const WebsiteCheckout = require("../models/websiteCheckoutModel");
const {
  resolveGateway,
  resolvePlatformGateway,
  PROVIDERS,
} = require("../services/paymentGateway");
const cashfree = require("../services/gateways/cashfree");
const { round2, toRupees } = require("../services/money");

const ack =(res, note, extra = {}) => {
  if (note) console.warn(`[cashfree-webhook] ${note}`);
  return res.status(200).json({ success: true, ...extra });
};

const cashfreeWebhook = async (req, res) => {
  try {
    // The signature is computed over the EXACT bytes received. Re-serialising
    // req.body only matches by luck: key order and any non-ASCII character in
    // a customer name would break it, and genuine webhooks would start
    // failing with no code change.
    const rawBody = req.rawBody ? req.rawBody.toString("utf8") : "";
    if (!rawBody) return ack(res, "no raw body captured; cannot verify");

    const timestamp = String(req.headers["x-webhook-timestamp"] || "");
    const signature = String(req.headers["x-webhook-signature"] || "");
    if (!timestamp || !signature) return ack(res, "missing signature headers");

    // A refund event names a refund we opened, not a payment. It is verified
    // the same way and then Cashfree is ASKED, never believed.
    if (String(req.body?.type || "").toUpperCase().startsWith("REFUND")) {
      return handleRefundEvent(req, res, { rawBody, timestamp, signature });
    }

    const orderId = String(req.body?.data?.order?.order_id || "");
    if (!orderId) return ack(res, "no order_id in payload");

    // Step 2 — is this an order WE opened? A forged event naming an order we
    // never created finds nothing and stops here.
    //
    // Two things open Cashfree orders: a table session paying its own bill,
    // and a payment link sent to a customer. Either may be the one the
    // browser never came back from.
    // N021a: the session's current order, or one it opened before that.
    const session = await TableSession.findOne({
      $or: [{ "payment.gatewayOrderId": orderId }, { "payment.gatewayOrderIds": orderId }],
      "payment.gatewayProvider": PROVIDERS.CASHFREE,
      isDeleted: { $ne: true },
    });
    const link = session
      ? null
      : await PaymentLink.findOne({ gatewayOrderId: orderId, isDeleted: { $ne: true } });

    // A third thing opens Cashfree orders: a restaurant topping up its
    // KnotKitchen Business Balance. That money is the PLATFORM'S, so it is
    // resolved and verified differently -- see below.
    const recharge = session || link ? null : await RechargeOrder.findOne({ gatewayOrderId: orderId });

    if (!session && !link && !recharge) {
      // And a website customer paying for an order (web_<checkoutId>).
      const websiteCheckout = await WebsiteCheckout.findOne({ gatewayOrderId: orderId });
      if (websiteCheckout) return handleWebsiteCheckout(res, { websiteCheckout, orderId, rawBody, timestamp, signature });
      return ack(res, `nothing opened gateway order ${orderId}`);
    }

    // Step 3 — the secret of whoever owns the money.
    //
    // For a diner's payment that is the TENANT's secret, because the money is
    // theirs. For a balance top-up it is KnotKitchen's own, and using
    // resolveGateway here would be a real hole: a restaurant with its own
    // Cashfree account could sign a top-up event with its own secret and
    // credit its balance without KnotKitchen receiving anything.
    const restaurantId = session
      ? session.restaurantId
      : link
        ? link.restaurantId
        : recharge.restaurantId;
    const gw = recharge ? resolvePlatformGateway() : await resolveGateway({ restaurantId });
    if (gw.provider !== PROVIDERS.CASHFREE || !gw.webhookSecret) {
      return ack(res, "no Cashfree secret for this tenant");
    }

    const verified = cashfree.verifyWebhook({
      rawBody,
      timestamp,
      signature,
      secretKey: gw.webhookSecret,
    });
    if (!verified) {
      // A signature that does not verify is the one case worth answering 401:
      // it is either an attack or a misconfigured secret, and Cashfree's
      // retries are not going to fix either.
      console.warn(`[cashfree-webhook] signature rejected for order ${orderId}`);
      return res.status(401).json({ success: false, message: "Invalid signature." });
    }

    // Already settled by THIS order — the browser getting back first, or an
    // earlier delivery of this same event. Nothing to do, and saying so is
    // correct. A table settled any other way still owes this payment back.
    const settledAlready = session
      ? settledBy(session, orderId)
      : link
        ? link.status === "PAID"
        : recharge.status === "PAID";
    if (settledAlready) return ack(res, null, { alreadySettled: true });

    // A top-up settles through the recharge service, which asks Cashfree for
    // the status itself and credits through the ledger's idempotency key -- so
    // this and the browser return can both arrive and only one credits.
    if (recharge) {
      const { finalizeRecharge } = require("../services/recharge");
      const result = await finalizeRecharge({ gatewayOrderId: orderId });
      return ack(res, result.credited ? null : result.reason, { credited: Boolean(result.credited) });
    }

    // Step 4 — even a correctly signed event does not get to assert that money
    // moved. Ask.
    const status = await cashfree.isOrderPaid({
      appId: gw.keyId,
      secretKey: gw.secret,
      environment: gw.environment,
      orderId,
    });
    if (!status.paid) return ack(res, `order ${orderId} is ${status.orderStatus}, not PAID`);


    if (session) {
      const payable = session.bills?.totalWithTax || 0;
      // Opened for the bill plus the platform fee stored with the gateway order.
      const platformFee = session.payment?.platformFee;
      const expected = round2(payable + toRupees(platformFee?.totalPaise));
      const refund = (target, note) => refundTablePayment(res, { session: target, gw, orderId, amount: Number(status.amount), note });
      // N021b: the till settled, closed or merged the table meanwhile.
      if (["PAID", "CLOSED"].includes(session.status)) return refund(session, "Table already settled");
      // N016: the bill moved after checkout opened. It cannot close the table
      // for less than it owes, and nobody can take "the difference" online.
      if (Math.abs(Number(status.amount) - Number(expected)) > 0.01) return refund(session, "Bill changed during payment");

      const { settleSessionFromGateway } = require("./tableSessionController");
      try {
        await settleSessionFromGateway({
          sessionId: session._id,
          restaurantId: session.restaurantId,
          method: "ONLINE",
          amount: payable,
          platformFee,
          transactionId: status.cfOrderId || orderId,
          // The same key the browser path uses, so whichever arrives second is
          // a no-op rather than a second payment.
          idempotencyKey: `qr-online-${status.cfOrderId || orderId}`,
          gatewayOrderId: orderId,
        });
      } catch (settleErr) {
        const fresh = (await TableSession.findById(session._id)) || session;
        // The browser won the race between the two paths: nothing is owed.
        if (settledBy(fresh, orderId)) {
          console.warn(`[cashfree-webhook] settle skipped for ${orderId}: ${settleErr.message}`);
          return ack(res, null, { settled: false });
        }
        // A write clash, not a refusal: the browser's settle may still be
        // committing, and refunding now could both settle and refund. Retry.
        if (!(settleErr.status >= 400 && settleErr.status < 500)) {
          console.error(`[cashfree-webhook] settle failed for ${orderId}, asking for a retry: ${settleErr.message}`);
          return res.status(500).json({ success: false });
        }
        console.warn(`[cashfree-webhook] settle refused for ${orderId}: ${settleErr.message}`);
        return refund(fresh, "Could not be applied to the table");
      }
      return ack(res, null, { settled: "session" });
    }

    // A payment link. finalizePaymentLinkFromGateway does its own amount
    // comparison against the amount locked when the link was created, and is
    // idempotent throughout, so the browser winning this race is a no-op.
    const { finalizePaymentLinkFromGateway } = require("../services/paymentLinkSettlement");
    const result = await finalizePaymentLinkFromGateway({
      gatewayOrderId: orderId,
      gatewayPaymentId: status.cfOrderId || orderId,
      amount: status.amount,
      method: "ONLINE",
    });
    if (result.skipped) return ack(res, `link ${orderId}: ${result.skipped}`, { settled: false });
    return ack(res, null, { settled: "link" });
  } catch (error) {
    // Never 500 at a webhook: it would be retried for days over what is
    // probably our own bug.
    console.error("[cashfree-webhook] handler failed:", error?.message || error);
    return res.status(200).json({ success: true, error: "handler_error" });
  }
};

/** S4b: this gateway order is the one that settled the table. */
const settledBy = (session, orderId) =>
  ["PAID", "CLOSED"].includes(session.status) &&
  session.payment?.method === "ONLINE" &&
  session.payment?.gatewayOrderId === orderId;

/**
 * D1: a table payment we cannot apply goes back to the diner, noted on the
 * table's timeline, and the order is dropped from the session. A refund that
 * fails answers 500 so Cashfree retries; the refund id is fixed per order.
 */
const refundTablePayment = async (res, { session, gw, orderId, amount, note }) => {
  try {
    await cashfree.refundUnappliedPayment({ gw, orderId, amount, note });
  } catch (err) {
    console.error(`[cashfree-webhook] refund of ${orderId} failed: ${err?.message || err}`);
    return res.status(500).json({ success: false });
  }
  try {
    await TableSession.dropRefundedOrder(session._id, orderId, `₹${amount} online payment refunded (order ${orderId}): ${note.toLowerCase()}`);
  } catch (err) {
    // Refunded but still listed: verify could settle with it later. A retry is safe (the refund id is fixed).
    console.error(`[cashfree-webhook] refund of ${orderId} made, but not recorded: ${err?.message || err}`);
    return res.status(500).json({ success: false });
  }
  return ack(res, `refunded ${orderId} (₹${amount}): ${note}`, { refunded: true });
};

/**
 * A website checkout the customer paid for: the same four steps, then the
 * order is placed through the storefront's own settlement, which the browser's
 * verify shares -- whichever arrives second adopts the order. Placed even if
 * the store has been locked or closed since: the money is already taken (N4).
 */
const handleWebsiteCheckout = async (res, { websiteCheckout, orderId, rawBody, timestamp, signature }) => {
  const { restaurantId, storeId } = websiteCheckout;
  const gw = await resolveGateway({ restaurantId, storeId });
  if (gw.provider !== PROVIDERS.CASHFREE || !gw.webhookSecret) return ack(res, "no Cashfree secret for this tenant");
  if (!cashfree.verifyWebhook({ rawBody, timestamp, signature, secretKey: gw.webhookSecret })) {
    console.warn(`[cashfree-webhook] signature rejected for order ${orderId}`);
    return res.status(401).json({ success: false, message: "Invalid signature." });
  }
  if (websiteCheckout.status !== "PENDING") return ack(res, null, { alreadySettled: true });

  const status = await cashfree.isOrderPaid({ appId: gw.keyId, secretKey: gw.secret, environment: gw.environment, orderId });
  if (!status.paid) return ack(res, `order ${orderId} is ${status.orderStatus}, not PAID`);
  if (Math.abs(Number(status.amount) - Number(websiteCheckout.amount)) > 0.01) {
    return ack(res, `amount mismatch on ${orderId}: paid ${status.amount}, checkout ${websiteCheckout.amount}`, { mismatch: true });
  }

  const { placePaidCheckout } = require("./storefrontController");
  let out;
  try {
    out = await placePaidCheckout({
      checkout: websiteCheckout,
      paid: status,
      restaurantId,
      outletId: websiteCheckout.orderData?.outletId || null,
      storeId,
    });
  } catch (err) {
    // The checkout is back to PENDING (e.g. N021c's refund failed): Cashfree
    // retries, and the refund id is fixed per order, so a retry is safe.
    console.error(`[cashfree-webhook] website checkout ${orderId} not placed: ${err?.message || err}`);
    return res.status(500).json({ success: false });
  }
  return ack(res, null, { settled: out.placed ? "website" : false });
};

/**
 * REFUND_STATUS_EVENT. Find the attempt by the refund id we minted and the
 * gateway order it belongs to, verify the signature with that tenant's
 * secret, then let syncRefund fetch the status from Cashfree and record it.
 */
const handleRefundEvent = async (req, res, { rawBody, timestamp, signature }) => {
  const refund = req.body?.data?.refund || {};
  const orderId = String(refund.order_id || "");
  const refundId = String(refund.refund_id || "");
  if (!orderId || !refundId) return ack(res, "refund event without order_id / refund_id");
  if (refundId.startsWith("ua_")) return handleUnappliedRefundEvent(res, { orderId, refundId, rawBody, timestamp, signature });

  const Order = require("../models/orderModel");
  const order = await Order.findOne({
    "paymentData.gatewayOrderId": orderId,
    "refunds.gateway.refundId": refundId,
    isDeleted: { $ne: true },
  });
  if (!order) return ack(res, `no refund ${refundId} on gateway order ${orderId}`);

  const gw = await resolveGateway({ restaurantId: order.restaurantId, storeId: order.storeId });
  if (gw.provider !== PROVIDERS.CASHFREE || !gw.webhookSecret) return ack(res, "no Cashfree secret for this tenant");
  if (!cashfree.verifyWebhook({ rawBody, timestamp, signature, secretKey: gw.webhookSecret })) {
    console.warn(`[cashfree-webhook] signature rejected for refund ${refundId}`);
    return res.status(401).json({ success: false, message: "Invalid signature." });
  }

  const { syncRefund } = require("../services/refunds");
  const { entry, changed } = await syncRefund(order, { refundId });
  return ack(res, null, { refund: entry ? entry.status : null, changed: Boolean(changed) });
};

/**
 * A refund of a payment we could not apply (D1, "ua_"). No Order carries it:
 * the table it was refunded from (refundedOrderIds) or the website checkout
 * names the tenant. Only a CANCELLED one needs anyone: the diner was told the
 * money is coming back, so it is logged and noted on the table, never silent.
 */
const handleUnappliedRefundEvent = async (res, { orderId, refundId, rawBody, timestamp, signature }) => {
  const session = await TableSession.findOne({ "payment.refundedOrderIds": orderId, isDeleted: { $ne: true } });
  const checkout = session ? null : await WebsiteCheckout.findOne({ gatewayOrderId: orderId });
  const owner = session || checkout;
  if (!owner) return ack(res, `no refund ${refundId} on gateway order ${orderId}`);

  const gw = await resolveGateway({ restaurantId: owner.restaurantId, ...(checkout ? { storeId: checkout.storeId } : {}) });
  if (gw.provider !== PROVIDERS.CASHFREE || !gw.webhookSecret) return ack(res, "no Cashfree secret for this tenant");
  if (!cashfree.verifyWebhook({ rawBody, timestamp, signature, secretKey: gw.webhookSecret })) {
    console.warn(`[cashfree-webhook] signature rejected for refund ${refundId}`);
    return res.status(401).json({ success: false, message: "Invalid signature." });
  }

  const status = await cashfree.getRefund({ appId: gw.keyId, secretKey: gw.secret, environment: gw.environment, orderId, refundId });
  if (status.status === "CANCELLED") {
    console.error(`[cashfree-webhook] refund ${refundId} of ₹${status.amount} on order ${orderId} was CANCELLED: the customer has not been paid back`);
    if (session) {
      await TableSession.updateOne(
        { _id: session._id },
        { $push: { timeline: { event: "ONLINE_REFUND_CANCELLED", note: `₹${status.amount} refund of order ${orderId} was cancelled by Cashfree: pay the diner back`, actorType: "SYSTEM", at: new Date() } } },
      );
    }
  }
  return ack(res, null, { refund: status.status });
};

module.exports = { cashfreeWebhook };
