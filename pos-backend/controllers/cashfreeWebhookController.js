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
 * Acknowledging with 200 is deliberate for every outcome that is not our bug:
 * a webhook that answers 4xx is retried for days.
 */

const TableSession = require("../models/tableSessionModel");
const PaymentLink = require("../models/paymentLinkModel");
const { resolveGateway, PROVIDERS } = require("../services/paymentGateway");
const cashfree = require("../services/gateways/cashfree");

const ack = (res, note, extra = {}) => {
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

    const orderId = String(req.body?.data?.order?.order_id || "");
    if (!orderId) return ack(res, "no order_id in payload");

    // Step 2 — is this an order WE opened? A forged event naming an order we
    // never created finds nothing and stops here.
    //
    // Two things open Cashfree orders: a table session paying its own bill,
    // and a payment link sent to a customer. Either may be the one the
    // browser never came back from.
    const session = await TableSession.findOne({
      "payment.gatewayOrderId": orderId,
      "payment.gatewayProvider": PROVIDERS.CASHFREE,
      isDeleted: { $ne: true },
    });
    const link = session
      ? null
      : await PaymentLink.findOne({ gatewayOrderId: orderId, isDeleted: { $ne: true } });

    if (!session && !link) return ack(res, `nothing opened gateway order ${orderId}`);

    // Step 3 — the secret of the tenant that owns it, and only that one.
    const restaurantId = session ? session.restaurantId : link.restaurantId;
    const gw = await resolveGateway({ restaurantId });
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

    // Already settled — by the browser getting back first, or by an earlier
    // delivery of this same event. Nothing to do, and saying so is correct.
    const settledAlready = session
      ? ["PAID", "CLOSED"].includes(session.status)
      : link.status === "PAID";
    if (settledAlready) return ack(res, null, { alreadySettled: true });

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
      if (Math.abs(Number(status.amount) - Number(payable)) > 0.01) {
        // The bill moved after checkout opened. Settling it here would close
        // the table for less than it owes; leave it for staff.
        return ack(
          res,
          `amount mismatch on ${orderId}: paid ${status.amount}, bill ${payable}`,
          { mismatch: true },
        );
      }

      const { settleSessionFromGateway } = require("./tableSessionController");
      try {
        await settleSessionFromGateway({
          sessionId: session._id,
          restaurantId: session.restaurantId,
          method: "ONLINE",
          amount: payable,
          transactionId: status.cfOrderId || orderId,
          // The same key the browser path uses, so whichever arrives second is
          // a no-op rather than a second payment.
          idempotencyKey: `qr-online-${status.cfOrderId || orderId}`,
        });
      } catch (settleErr) {
        // The browser almost certainly won the race between the two paths.
        console.warn(`[cashfree-webhook] settle skipped for ${orderId}: ${settleErr.message}`);
        return ack(res, null, { settled: false });
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

module.exports = { cashfreeWebhook };
