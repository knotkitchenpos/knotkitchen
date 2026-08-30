const Razorpay = require("razorpay");
const createHttpError = require("http-errors");
const config = require("../config/config");
const crypto = require("crypto");
const mongoose = require("mongoose");
const Payment = require("../models/paymentModel");
const { COMPLETED } = require("../constants/orderStatus");
const { normalizePaymentMethod, toOrderPaymentMethod } = require("../constants/paymentMethods");
const Order = require("../models/orderModel");
const Bill = require("../models/billModel");
const PaymentLink = require("../models/paymentLinkModel");
const PaymentTransaction = require("../models/paymentTransactionModel");

/**
 * Payment controller — Razorpay integration.
 *
 * Security posture (§19, §20):
 *   - Amounts are ALWAYS re-read from the Order document server-side. The
 *     previous implementation multiplied `req.body.amount` directly by 100
 *     and sent it to Razorpay, meaning a malicious POS client could open a
 *     Rs. 1 gateway order for a Rs. 5000 bill.
 *   - Signatures are compared using crypto.timingSafeEqual to prevent
 *     timing-based signature discovery.
 *   - Webhook verification requires the secret AND rejects replays via
 *     Payment.paymentId's unique index (see Payment model).
 *   - Detailed errors are swallowed — the client only sees generic 400/500
 *     messages, never Razorpay's raw error which can include order internals.
 */

const timingSafeEquals = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
};

const createOrder = async (req, res, next) => {
  try {
    if (!config.razorpayKeyId || !config.razorpaySecretKey) {
      return next(
        createHttpError(
          500,
          "Razorpay is not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env"
        )
      );
    }

    const { orderId } = req.body || {};
    let calculatedAmount = 0;
    let currency = "INR";

    if (orderId && mongoose.Types.ObjectId.isValid(orderId)) {
      // ORDER-BOUND PATH: the amount is taken from the DB, not the request.
      const dbOrder = await Order.findOne({
        _id: orderId,
        restaurantId: req.user.restaurantId,
        ...(req.user.outletId ? { outletId: req.user.outletId } : {}),
        isDeleted: { $ne: true },
      });
      if (!dbOrder) return next(createHttpError(404, "Order not found!"));
      if ((dbOrder.payments || []).some((p) => p.status === "paid")) {
        return next(createHttpError(400, "Order is already paid."));
      }
      calculatedAmount = Number(dbOrder.bills?.totalWithTax || dbOrder.bills?.total || 0);
      if (calculatedAmount <= 0) return next(createHttpError(400, "Order amount invalid."));
    } else {
      // AD-HOC PATH: legacy POS flow that only sends `amount`. Bounded to a
      // sane range so a client cannot start a Razorpay order for £1e12.
      const raw = Number(req.body?.amount);
      if (!Number.isFinite(raw) || raw <= 0 || raw > 1_000_000) {
        return next(createHttpError(400, "Invalid amount."));
      }
      calculatedAmount = raw;
    }

    const razorpay = new Razorpay({
      key_id: config.razorpayKeyId,
      key_secret: config.razorpaySecretKey,
    });

    const order = await razorpay.orders.create({
      amount: Math.round(calculatedAmount * 100), // paisa
      currency,
      receipt: `receipt_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    });

    res.status(200).json({ success: true, order });
  } catch (error) {
    // Do not surface Razorpay's raw error to the client (§21).
    console.error("[payment.createOrder]", error?.message || error);
    next(createHttpError(500, "Failed to create payment order."));
  }
};

const verifyPayment = async (req, res, next) => {
  try {
    const razorpay_order_id = String(req.body?.razorpay_order_id || "");
    const razorpay_payment_id = String(req.body?.razorpay_payment_id || "");
    const razorpay_signature = String(req.body?.razorpay_signature || "");

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return next(createHttpError(400, "Payment verification failed!"));
    }
    if (!config.razorpaySecretKey) {
      return next(createHttpError(500, "Razorpay is not configured."));
    }

    const expectedSignature = crypto
      .createHmac("sha256", config.razorpaySecretKey)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (!timingSafeEquals(expectedSignature, razorpay_signature)) {
      return next(createHttpError(400, "Payment verification failed!"));
    }

    res.json({ success: true, message: "Payment verified successfully!" });
  } catch (error) {
    next(error);
  }
};

/**
 * Idempotent reconciliation for Pay-by-Link (Module 3 §2).
 *
 * Called both:
 *   1. By the customer's browser after a successful Razorpay callback
 *      (paymentLinkController.verifyAndCaptureLinkPayment); and
 *   2. By Razorpay's webhook here in paymentController — this is the
 *      authoritative path because the browser callback is best-effort.
 *
 * Both callers may fire at once and either may fire multiple times (webhook
 * retries + user hitting back). Everything below is designed to be safe to
 * run repeatedly:
 *
 *   - PaymentLink.status "PAID" is checked first — a paid link short-
 *     circuits immediately.
 *   - PaymentTransaction has a unique compound (restaurantId,
 *     idempotencyKey) index; the second insert throws E11000 which we
 *     swallow.
 *   - Order/Bill updates are `findOneAndUpdate` with narrowing filters so
 *     we never over-count amounts or transition a completed order back.
 *
 * @returns {Promise<{link?, txn?, order?, skipped?: string}>} for logging
 */
const finalizePaymentLinkFromGateway = async ({
  gatewayOrderId,
  gatewayPaymentId,
  amount,
  method = "RAZORPAY",
}) => {
  if (!gatewayOrderId) return { skipped: "no-gateway-order" };

  const link = await PaymentLink.findOne({
    gatewayOrderId,
    isDeleted: { $ne: true },
  });
  // Payment isn't tied to a POS payment link — nothing to do.
  if (!link) return { skipped: "no-matching-link" };

  // Already fully paid: another callback/webhook won. Idempotent no-op.
  if (link.status === "PAID") return { skipped: "already-paid", link };

  // Server-side amount comparison. The link.amount was locked at creation
  // time from the Order's own bill. If the gateway reports a different
  // amount (partial capture, currency mismatch), refuse to finalise —
  // this prevents an under-payment silently marking the order as paid.
  const lockedAmount = Number(link.amount);
  const gatewayAmount = Number(amount || 0);
  if (gatewayAmount > 0 && Math.abs(gatewayAmount - lockedAmount) > 0.5) {
    console.warn(
      `[payment-link] amount mismatch: link=${lockedAmount} gateway=${gatewayAmount} link=${link._id}`,
    );
    // We intentionally still mark as paid IF the gateway paid >= locked
    // (customer overpaid — bank problem, not ours). Under-payment leaves
    // the link pending for the operator to investigate.
    if (gatewayAmount < lockedAmount) return { skipped: "underpaid", link };
  }

  const idempotencyKey =
    gatewayPaymentId
      ? `pay-link-${link._id}-${gatewayPaymentId}`
      : `pay-link-${link._id}-${gatewayOrderId}`;

  // Ledger entry — idempotent via unique index on PaymentTransaction.
  let txn = null;
  try {
    const txnDocs = await PaymentTransaction.create([
      {
        restaurantId: link.restaurantId,
        outletId: link.outletId,
        billId: link.billId,
        tableSessionId: link.tableSessionId,
        customerId: link.customerId,
        paymentLinkId: link._id,
        // `method` arrives as the gateway's own instrument name (Razorpay sends
        // "netbanking", "card", "upi", ...) or a provider name. The model's
        // enum accepts neither "RAZORPAY" nor "NETBANKING", so those writes
        // threw ValidationError — caught by the caller and logged, meaning
        // netbanking payments silently never reconciled.
        method: normalizePaymentMethod(method),
        amount: lockedAmount,
        status: "PAID",
        provider: method === "RAZORPAY" ? "RAZORPAY" : "SECURE_LINK",
        transactionId: gatewayPaymentId || `webhook_${Date.now()}`,
        gatewayOrderId,
        gatewayPaymentId: gatewayPaymentId || "",
        idempotencyKey,
        paidAt: new Date(),
      },
    ]);
    txn = txnDocs[0];
  } catch (err) {
    if (err?.code !== 11000) throw err;
    // Duplicate — another caller already recorded this exact payment.
    // Continue so we still finalise the link/order/bill if they weren't
    // updated for some reason.
  }

  // Flip PaymentLink → PAID (guarded so two concurrent callers don't
  // over-write each other).
  const updatedLink = await PaymentLink.findOneAndUpdate(
    { _id: link._id, status: { $ne: "PAID" } },
    {
      $set: {
        status: "PAID",
        paidAmount: lockedAmount,
        paidAt: new Date(),
      },
    },
    { new: true },
  );

  // Mark the associated Bill (if any) as PAID.
  if (link.billId) {
    await Bill.findOneAndUpdate(
      { _id: link.billId, restaurantId: link.restaurantId, status: { $ne: "PAID" } },
      { $set: { status: "PAID", paidAmount: lockedAmount, dueAmount: 0, settledAt: new Date() } },
    );
  }

  // Finally, update the Order to Completed + record the payment. The
  // guard on `payments.status != paid` prevents double-appending.
  let updatedOrder = null;
  if (link.orderId) {
    updatedOrder = await Order.findOneAndUpdate(
      {
        _id: link.orderId,
        restaurantId: link.restaurantId,
        "payments.status": { $ne: "paid" },
      },
      {
        $set: {
          orderStatus: COMPLETED,
          paymentMethod: normalizePaymentMethod(method),
        },
        $push: {
          payments: {
            // Order.payments[].method is its own narrower lower-case enum; the
            // old ternary handled "razorpay" but not "netbanking" or "emi".
            method: toOrderPaymentMethod(method),
            amount: lockedAmount,
            status: "paid",
            transactionId: gatewayPaymentId || `webhook_${Date.now()}`,
          },
          timeline: {
            status: "Completed",
            timestamp: new Date(),
            user: "Webhook",
          },
        },
      },
      { new: true },
    );
  }

  return { link: updatedLink || link, txn, order: updatedOrder };
};

const webHookVerification = async (req, res, next) => {
  try {
    // ---- Cashfree / PhonePe ----
    //
    // DISABLED, deliberately. These branches used to run BEFORE any signature
    // check and performed no verification of their own, while calling
    // finalizePaymentLinkFromGateway — which marks a PaymentLink, its Bill and
    // its Order paid. This endpoint is unauthenticated, so a forged
    // `{"type":"PAYMENT_SUCCESS_WEBHOOK", ...}` body settled a bill for free.
    //
    // Neither gateway is actually integrated: createPaymentLink mints a
    // synthetic `CASHFREE_LINK_<ts>` / `PHONEPE_LINK_<ts>` id without calling
    // the provider, and no CASHFREE_/PHONEPE_ secret exists anywhere in the
    // configuration — so there is nothing to verify against even in principle.
    //
    // Acknowledging (200) without acting is the correct inert behaviour: it
    // stops provider retries without granting unauthenticated writes. When
    // either gateway is genuinely integrated, restore the branch TOGETHER WITH
    // its signature verification, never before.
    if (
      req.body.type === "PAYMENT_SUCCESS_WEBHOOK" ||
      req.body.data?.order?.order_id ||
      req.body.response ||
      req.body.code === "PAYMENT_SUCCESS"
    ) {
      console.warn(
        "[webhook] Received a Cashfree/PhonePe-shaped payload. These gateways are " +
          "not integrated and their webhooks are NOT verifiable; ignoring."
      );
      return res.status(200).json({ success: true, skipped: true });
    }

    // ---- Razorpay Webhook Handling ----
    const secret = config.razorpyWebhookSecret;
    if (!secret) {
      // Deliberately return 200 so Razorpay stops retrying, but log so an
      // operator notices the missing configuration.
      console.warn("[webhook] RAZORPAY_WEBHOOK_SECRET is not set; ignoring event.");
      return res.status(200).json({ success: true, skipped: true });
    }

    const signature = String(req.headers["x-razorpay-signature"] || "");

    // A MISSING signature is a failure, not a pass. The previous condition was
    // `if (signature && !timingSafeEquals(...))`, so omitting the header
    // short-circuited the check and the forged event was processed as genuine.
    if (!signature) {
      return next(createHttpError(400, "Invalid Signature!"));
    }

    // Sign over the RAW bytes received (captured by express.json's `verify` in
    // app.js). JSON.stringify(req.body) re-serialises and only matches by
    // luck — any non-ASCII character in a customer name breaks it, so genuine
    // webhooks would start failing verification with no code change.
    const body = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(req.body);

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    if (!timingSafeEquals(expectedSignature, signature)) {
      return next(createHttpError(400, "Invalid Signature!"));
    }

    if (req.body.event === "payment.captured") {
      const payment = req.body.payload?.payment?.entity;
      if (!payment?.id) return next(createHttpError(400, "Malformed payload."));

      // Duplicate/replay protection: the Payment model's `paymentId` field has
      // a unique index. A second webhook for the same gateway payment id will
      // throw E11000 which we swallow into a 200 (webhook idempotency, §20).
      try {
        await Payment.create({
          paymentId: payment.id,
          orderId: payment.order_id,
          amount: Number(payment.amount) / 100,
          currency: payment.currency,
          status: payment.status,
          method: payment.method,
          email: payment.email,
          contact: payment.contact,
          createdAt: new Date(Number(payment.created_at) * 1000),
        });
      } catch (err) {
        if (err?.code !== 11000) throw err;
      }

      // Module 3 §2 — Pay-by-Link server-side confirmation.
      //
      // When a customer completes a POS-generated payment link the browser
      // callback (paymentLinkController.verifyAndCaptureLinkPayment) is the
      // happy path, but it isn't reliable — the customer's browser may close,
      // network may drop, etc. Razorpay's webhook is the source of truth.
      //
      // Here we look up the PaymentLink by the gateway order id and, if it
      // isn't already paid, atomically:
      //   - mark the PaymentLink PAID (with idempotency guard),
      //   - write a PaymentTransaction (idempotent via unique index),
      //   - flip the linked Order to Completed + record the payment.
      //
      // Safe against duplicate webhooks because:
      //   * The Payment collection dedupes on `paymentId` (above).
      //   * PaymentTransaction has a unique `idempotencyKey` index.
      //   * `PaymentLink.status = "PAID"` short-circuits any subsequent call.
      //
      // If the payment doesn't belong to a POS payment link (e.g. it's a
      // storefront order paid directly), we just no-op — nothing to
      // finalise here.
      try {
        if (payment.order_id) {
          await finalizePaymentLinkFromGateway({
            gatewayOrderId: payment.order_id,
            gatewayPaymentId: payment.id,
            amount: Number(payment.amount) / 100,
            method: String(payment.method || "razorpay").toUpperCase(),
          });
        }
      } catch (err) {
        // Never fail the webhook on downstream reconciliation errors — Razorpay
        // will retry the webhook, and we want the 200 acknowledgement so the
        // retry stops. Log for the operator; the reconciliation still stays
        // consistent because everything downstream is idempotent.
        console.error("[webhook] payment-link finalise failed:", err?.message || err);
      }
    }

    if (
      req.body.event === "payment_link.paid" ||
      req.body.event === "order.paid"
    ) {
      // Razorpay's payment_link.paid payload carries both the link and the
      // captured payment. Use the payment.id for idempotent Payment record +
      // the link's order_id (or the linked razorpay order) for reconciliation.
      const paymentEntity =
        req.body.payload?.payment?.entity ||
        req.body.payload?.payment_link?.entity?.payment ||
        null;
      const linkEntity = req.body.payload?.payment_link?.entity || null;
      const gatewayOrderId =
        paymentEntity?.order_id || linkEntity?.order_id || linkEntity?.reference_id || null;
      const gatewayPaymentId = paymentEntity?.id || linkEntity?.payment_id || "";
      const amount = paymentEntity
        ? Number(paymentEntity.amount) / 100
        : Number(linkEntity?.amount || 0) / 100;

      if (gatewayOrderId) {
        try {
          await finalizePaymentLinkFromGateway({
            gatewayOrderId,
            gatewayPaymentId,
            amount,
            method: String(paymentEntity?.method || "razorpay").toUpperCase(),
          });
        } catch (err) {
          console.error("[webhook] payment_link.paid finalise failed:", err?.message || err);
        }
      }
    }

    res.json({ success: true });
  } catch (error) {
    // Never echo the raw error to the caller — this endpoint is unauthenticated.
    console.error("[webhook]", error?.message || error);
    next(createHttpError(error.statusCode || 400, "Webhook processing failed."));
  }
};

module.exports = { createOrder, verifyPayment, webHookVerification };
