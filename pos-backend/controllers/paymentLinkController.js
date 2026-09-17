const crypto = require("crypto");
const createHttpError = require("http-errors");
const config = require("../config/config");
const PaymentLink = require("../models/paymentLinkModel");
const PaymentTransaction = require("../models/paymentTransactionModel");
const Bill = require("../models/billModel");
const Order = require("../models/orderModel");
const TableSession = require("../models/tableSessionModel");
const Restaurant = require("../models/restaurantModel");
const { sendPaymentLinkMessage } = require("../services/messagingService");
const { resolveGateway, PROVIDERS } = require("../services/paymentGateway");
const { COMPLETED, SETTLED_STATUSES } = require("../constants/orderStatus");
const { normalizePaymentMethod, toOrderPaymentMethod } = require("../constants/paymentMethods");

/**
 * Constant-time string comparison for gateway signatures. Mirrors the helper in
 * paymentController.js — a plain `!==` returns early on the first differing
 * byte and leaks how much of a guessed signature was correct.
 */
const timingSafeEquals = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
};

/**
 * Validate customer phone number for collection payment links.
 * Rejects missing, invalid, or malformed phone numbers.
 */
const validateCollectionPhone = (phone) => {
  if (!phone || typeof phone !== "string" || !phone.trim()) {
    return { valid: false, error: "Customer phone number is required to generate payment link." };
  }
  const cleanPhone = phone.trim().replace(/\D/g, "");
  if (cleanPhone.length < 10 || cleanPhone.length > 15) {
    return { valid: false, error: "Invalid or malformed phone number. Must contain 10 to 15 digits." };
  }
  return { valid: true, phone: cleanPhone };
};

// ============================================================
// Create a payment link for a collection order or bill
// ============================================================
const createPaymentLink = async (req, res, next) => {
  try {
    const { billId, orderId, tableSessionId, expiresInHours = 24, phone } = req.body;

    if (!billId && !orderId) {
      throw createHttpError(400, "Either orderId or billId is required!");
    }

    const scopeQuery = { restaurantId: req.user.restaurantId };
    if (req.user.outletId) scopeQuery.outletId = req.user.outletId;

    let targetOrder = null;
    let targetBill = null;
    let customerPhone = phone;

    // 1. Resolve Order if orderId provided
    if (orderId) {
      targetOrder = await Order.findOne({ _id: orderId, ...scopeQuery, isDeleted: { $ne: true } });
      if (!targetOrder) throw createHttpError(404, "Order not found!");

      // isSettled covers every finished spelling, not just lowercase
      // "completed" — otherwise an already-settled order could be sent a
      // second payment link.
      const hasPaidPayment = targetOrder.payments?.some((p) => p.status === "paid");
      if (hasPaidPayment || SETTLED_STATUSES.includes(targetOrder.orderStatus)) {
        throw createHttpError(400, "Order is already paid!");
      }

      if (!customerPhone) {
        customerPhone = targetOrder.customerDetails?.phone;
      }

      // Check if bill already exists for this order
      targetBill = await Bill.findOne({ orderId: targetOrder._id, restaurantId: req.user.restaurantId, isDeleted: { $ne: true } });
      if (!targetBill) {
        // Create 1-to-1 bill for this order
        const billTotal = targetOrder.bills?.totalWithTax || targetOrder.bills?.total || 0;
        targetBill = await Bill.create({
          billNumber: `BILL-${Date.now().toString(36).toUpperCase()}`,
          restaurantId: targetOrder.restaurantId,
          outletId: targetOrder.outletId || req.user.outletId,
          orderId: targetOrder._id,
          customerId: targetOrder.customerId,
          customerDetails: targetOrder.customerDetails,
          bills: {
            subtotal: targetOrder.bills?.subtotal || 0,
            tax: targetOrder.bills?.tax || 0,
            discount: targetOrder.bills?.discount || 0,
            charges: (targetOrder.bills?.packagingFee || 0) + (targetOrder.bills?.deliveryFee || 0),
            totalWithTax: billTotal,
          },
          dueAmount: billTotal,
          status: "PENDING",
          createdBy: req.user._id,
        });
      }
    }

    // 2. Resolve Bill if billId provided and not already resolved
    if (billId && !targetBill) {
      targetBill = await Bill.findOne({ _id: billId, ...scopeQuery, isDeleted: { $ne: true } });
      if (!targetBill) throw createHttpError(404, "Bill not found!");
      if (targetBill.status === "PAID") throw createHttpError(400, "Bill already paid!");

      if (!customerPhone) {
        customerPhone = targetBill.customerDetails?.phone;
      }

      if (targetBill.orderId && !targetOrder) {
        targetOrder = await Order.findOne({ _id: targetBill.orderId, restaurantId: req.user.restaurantId });
      }
    }

    // 3. Strict Phone Number Validation (Mandatory for payment link creation)
    const phoneCheck = validateCollectionPhone(customerPhone);
    if (!phoneCheck.valid) {
      throw createHttpError(400, phoneCheck.error);
    }
    const validatedPhone = phoneCheck.phone;

    // 4. Idempotency / Duplicate Generation Guard: Check for existing active link
    const queryLink = targetOrder
      ? { orderId: targetOrder._id, status: "ACTIVE", expiresAt: { $gt: new Date() }, isDeleted: { $ne: true } }
      : { billId: targetBill._id, status: "ACTIVE", expiresAt: { $gt: new Date() }, isDeleted: { $ne: true } };

    const existingActiveLink = await PaymentLink.findOne(queryLink);
    if (existingActiveLink) {
      const paymentUrl = `${config.frontendUrl}/pay/${existingActiveLink.linkToken}`;
      return res.status(200).json({
        success: true,
        message: "Active payment link already exists for this order/bill.",
        data: {
          ...existingActiveLink.toObject(),
          paymentUrl,
        },
        deduplicated: true,
      });
    }

    // 5. Backend calculates exact payable amount (never trust client input)
    const calculatedAmount = targetOrder
      ? (targetOrder.bills?.totalWithTax || targetOrder.bills?.total || 0)
      : (targetBill?.dueAmount || targetBill?.bills?.totalWithTax || 0);

    if (calculatedAmount <= 0) {
      throw createHttpError(400, "Invalid order/bill amount for payment link.");
    }

    // 6. Generate non-guessable, unique 64-char hex token
    const linkToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + Number(expiresInHours) * 3600 * 1000);

    // Module 5 §1 — Active Payment Gateway Resolution
    const WebsiteSettings = require("../models/websiteSettingsModel");
    // Which gateway, and whose credentials. This used to be a fourth
    // hand-written copy of that resolution -- the QR page, the storefront and
    // paymentGateway.js each had their own, and they disagreed. One answer.
    const gw = await resolveGateway({
      restaurantId: req.user.restaurantId,
      storeId: req.user.storeId,
    });

    let gatewayOrderId = "";
    let paymentSessionId = "";

    if (gw.enabled && gw.provider === PROVIDERS.CASHFREE) {
      // A REAL Cashfree order. This branch used to mint a synthetic
      // `CASHFREE_LINK_<ts>` id without ever calling the provider, which meant
      // the link could be opened, could not be paid, and could not have been
      // verified even if it had been.
      const cashfree = require("../services/gateways/cashfree");
      const order = await cashfree.createOrder({
        appId: gw.keyId,
        secretKey: gw.secret,
        environment: gw.environment,
        amount: calculatedAmount,
        currency: targetBill?.currency || "INR",
        orderId: `lnk_${linkToken.slice(0, 24)}`,
        customer: { id: `lnk_${linkToken.slice(0, 20)}`, phone: validatedPhone },
        notifyUrl: config.cashfreeNotifyUrl,
      });
      gatewayOrderId = order.orderId;
      paymentSessionId = order.paymentSessionId;
    } else {
      // No usable gateway. Refusing here is the honest outcome: a link the
      // customer cannot pay is worse than no link, and the operator finds out
      // now rather than after they have sent it.
      throw createHttpError(
        503,
        "No payment gateway is configured for this store, so a payment link cannot be created.",
      );
    }

    // 7. Save Payment Link to Database with Active Gateway Association (Module 5 §6)
    const link = await PaymentLink.create({
      restaurantId: targetBill?.restaurantId || targetOrder?.restaurantId || req.user.restaurantId,
      outletId: targetBill?.outletId || targetOrder?.outletId || req.user.outletId,
      billId: targetBill?._id,
      orderId: targetOrder?._id,
      tableSessionId: tableSessionId || targetBill?.tableSessionId || targetOrder?.tableSessionId,
      customerId: targetBill?.customerId || targetOrder?.customerId,
      customerPhone: validatedPhone,
      linkToken,
      amount: calculatedAmount,
      currency: targetBill?.currency || "INR",
      gatewayName: gw.provider.toUpperCase(),
      gatewayOrderId,
      paymentSessionId,
      gatewayMode: gw.environment === "PROD" ? "production" : "sandbox",
      expiresAt,
      createdBy: req.user._id,
    });

    const paymentUrl = `${config.frontendUrl}/pay/${linkToken}`;

    // 8. Fetch restaurant name for messaging
    const restaurant = await Restaurant.findById(link.restaurantId);
    const restaurantName = restaurant?.name || "Knot Kitchen";
    const orderNumber = targetOrder?.marketplaceOrderId || targetOrder?._id?.toString().slice(-6) || targetBill?.billNumber || "N/A";

    // 9. Send payment link via messaging provider
    const messagingResult = await sendPaymentLinkMessage({
      phone: validatedPhone,
      linkUrl: paymentUrl,
      orderNumber,
      restaurantName,
      amount: calculatedAmount,
    });

    res.status(201).json({
      success: true,
      data: {
        ...link.toObject(),
        paymentUrl,
        messaging: messagingResult,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// Public: resolve payment link (customer opens /pay/:token)
// Returns all required payment page details
// ============================================================
const getPaymentLink = async (req, res, next) => {
  try {
    const { token } = req.params;
    const link = await PaymentLink.findOne({ linkToken: token, isDeleted: { $ne: true } })
      .populate("billId")
      .populate("orderId")
      .populate("restaurantId", "name phone logo address");

    if (!link) throw createHttpError(404, "Payment link not found.");
    if (link.status === "PAID") throw createHttpError(400, "This payment link has already been paid.");
    if (link.status === "EXPIRED" || Date.now() > new Date(link.expiresAt).getTime()) {
      throw createHttpError(400, "This payment link has expired.");
    }

    const bill = link.billId;
    const order = link.orderId;
    const restaurant = link.restaurantId;

    // The store whose gateway this link was opened against. Only the
    // PUBLIC half is read out below.
    const linkGw = await resolveGateway({ restaurantId: restaurant?._id || restaurant });

    const orderedItems = (order?.items || []).map((item) => ({
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      total: item.total,
      modifiers: item.modifiers || [],
    }));

    const quantities = orderedItems.reduce((sum, item) => sum + item.quantity, 0);

    const subtotal = bill?.bills?.subtotal ?? order?.bills?.subtotal ?? link.amount;
    const taxes = bill?.bills?.tax ?? order?.bills?.tax ?? 0;
    const charges = bill?.bills?.charges ?? ((order?.bills?.packagingFee || 0) + (order?.bills?.deliveryFee || 0));

    res.status(200).json({
      success: true,
      data: {
        linkToken: link.linkToken,
        // A gateway order handle, not a secret: it is useless on its own,
        // and capture re-reads the order's status from the gateway rather
        // than believing anything the browser says about it.
        gatewayOrderId: link.gatewayOrderId || "",
        gatewayName: link.gatewayName || "CASHFREE",
        // What the browser needs to open checkout: the payment session
        // Cashfree minted, and which environment to open it against. Getting
        // the mode wrong makes the SDK fail silently.
        paymentSessionId: link.paymentSessionId || "",
        gatewayMode: link.gatewayMode || "sandbox",
        restaurantName: restaurant?.name || "Knot Kitchen",
        orderNumber: order?.marketplaceOrderId || order?._id?.toString() || bill?.billNumber || "N/A",
        orderedItems,
        quantities,
        subtotal,
        taxes,
        charges,
        total: link.amount, // Backend locked amount
        amount: link.amount,
        currency: link.currency || "INR",
        paymentStatus: link.status,
        availablePaymentMethods: ["CARD", "UPI", "NETBANKING"],
        expiresAt: link.expiresAt,
        billNumber: bill?.billNumber,
        customerPhone: link.customerPhone,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// Public: capture & verify payment on a link
// Idempotent & secure payment capture
// ============================================================
const verifyAndCaptureLinkPayment = async (req, res, next) => {
  const mongoose = require("mongoose");
  const mongoSession = await mongoose.startSession();
  mongoSession.startTransaction();
  try {
    const { token } = req.params;
    const { paymentMethod = "ONLINE" } = req.body;

    const link = await PaymentLink.findOne({ linkToken: token, isDeleted: { $ne: true } }).session(mongoSession);
    if (!link) throw createHttpError(404, "Payment link not found.");
    if (link.status === "PAID") throw createHttpError(400, "Payment link already paid.");

    if (link.status === "EXPIRED" || Date.now() > new Date(link.expiresAt).getTime()) {
      throw createHttpError(400, "Payment link has expired.");
    }

    // ---- Gateway signature verification (MANDATORY) ----
    //
    // This endpoint is PUBLIC — anyone holding a link token can call it, and
    // every customer sent a payment link holds one. It marks the link, the
    // bill and the order paid and closes the table session, so it must never
    // run on unverified input.
    //
    // The guard here once depended on request-body fields, so simply OMITTING
    // them skipped verification entirely and fell through to the "mark
    // everything paid" code below: `POST /:token/verify` with a body of
    // `{"paymentMethod":"UPI"}` settled any bill for free. Nothing the caller
    // sends may influence whether verification happens.
    //
    // Verification is required, and failure to verify is fatal. Which check
    // runs is read from the LINK, never from the request, so a caller cannot
    // pick a weaker path by naming a different gateway.
    const linkGateway = String(link.gatewayName || "CASHFREE").toUpperCase();
    const gw = await resolveGateway({ restaurantId: link.restaurantId });

    let transactionId = "";
    let gatewayOrder = "";

    if (linkGateway === "CASHFREE") {
      // Cashfree hands the browser nothing worth trusting, so ask Cashfree.
      // No client-supplied value is in this decision at all.
      if (gw.provider !== PROVIDERS.CASHFREE || !gw.enabled) {
        throw createHttpError(503, "Payment verification is unavailable. Please contact the restaurant.");
      }
      if (!link.gatewayOrderId) {
        throw createHttpError(400, "This payment link was never opened with the gateway.");
      }

      const cashfree = require("../services/gateways/cashfree");
      let status;
      try {
        status = await cashfree.isOrderPaid({
          appId: gw.keyId,
          secretKey: gw.secret,
          environment: gw.environment,
          orderId: link.gatewayOrderId,
        });
      } catch (cfErr) {
        // Could not find out. NOT treated as unpaid: the money may have moved,
        // and telling the customer it failed invites them to pay twice.
        console.warn("[paymentLink] cashfree status check failed:", cfErr?.message || cfErr);
        throw createHttpError(
          502,
          "We could not confirm that payment yet. Please contact the restaurant before paying again.",
        );
      }

      if (!status.paid) {
        throw createHttpError(400, "That payment has not completed.");
      }
      if (Math.abs(Number(status.amount) - Number(link.amount)) > 0.01) {
        throw createHttpError(409, "The amount paid does not match this bill. Please contact the restaurant.");
      }

      transactionId = status.cfOrderId || link.gatewayOrderId;
      gatewayOrder = link.gatewayOrderId;
    } else {
      // PhonePe and anything else: no secret exists for it anywhere in the
      // configuration, so a "capture" would be unverifiable by construction.
      throw createHttpError(501, "This payment method cannot be confirmed here.");
    }

    // Idempotency: derived from the link and the gateway transaction, never
    // taken from the body. This is a public endpoint and the replay branch
    // returns the matched transaction, so a caller-chosen key would let one
    // customer read another's payment record. The webhook derives the same
    // key (services/paymentLinkSettlement.js), so browser and webhook collapse
    // to one transaction.
    const effectiveIdempotencyKey = `pay-link-${link._id}-${transactionId}`;
    const existingTxn = await PaymentTransaction.findOne({
      restaurantId: link.restaurantId,
      idempotencyKey: effectiveIdempotencyKey,
      status: "PAID",
    }).session(mongoSession);

    if (existingTxn) {
      await mongoSession.commitTransaction();
      return res.status(200).json({ success: true, data: existingTxn, deduplicated: true });
    }

    // Backend calculated amount is locked
    const lockedAmount = link.amount;

    // Record ledger entry
    const txn = await PaymentTransaction.create(
      [
        {
          restaurantId: link.restaurantId,
          outletId: link.outletId,
          billId: link.billId,
          tableSessionId: link.tableSessionId,
          customerId: link.customerId,
          paymentLinkId: link._id,
          // `method` is the payment INSTRUMENT and its enum does not include
          // provider names, so it has to be normalised. Passing a provider
          // name straight through threw a ValidationError on every genuine
          // capture and aborted the transaction. See
          // constants/paymentMethods.js.
          method: normalizePaymentMethod(paymentMethod),
          amount: lockedAmount,
          status: "PAID",
          provider: link.gatewayName || "CASHFREE",
          transactionId,
          gatewayOrderId: gatewayOrder,
          gatewayPaymentId: transactionId,
          idempotencyKey: effectiveIdempotencyKey,
          paidAt: new Date(),
        },
      ],
      { session: mongoSession }
    );

    // Update link status
    link.status = "PAID";
    link.paidAmount = lockedAmount;
    link.paidAt = new Date();
    await link.save({ session: mongoSession });

    // Update Bill if present
    if (link.billId) {
      await Bill.findOneAndUpdate(
        { _id: link.billId, restaurantId: link.restaurantId },
        { status: "PAID", paidAmount: lockedAmount, dueAmount: 0, settledAt: new Date() },
        { session: mongoSession }
      );
    }

    // Update Order if present
    if (link.orderId) {
      await Order.findOneAndUpdate(
        // Guard on "not already paid" so a concurrent webhook and browser
        // callback cannot both append a payment for the same settlement.
        { _id: link.orderId, restaurantId: link.restaurantId, "payments.status": { $ne: "paid" } },
        {
          $set: {
            // COMPLETED, not READY. The webhook path (paymentController
            // .finalizePaymentLinkFromGateway) already sets COMPLETED, so a
            // paid order's status used to depend on which path happened to win
            // the race. Settling a bill completes the order in both.
            orderStatus: COMPLETED,
            paymentMethod: normalizePaymentMethod(paymentMethod),
          },
          // $push, not assignment. Assigning replaced the whole array and
          // discarded any earlier partial/split payments on the order.
          $push: {
            payments: {
              method: toOrderPaymentMethod(paymentMethod),
              amount: lockedAmount,
              status: "paid",
              transactionId,
            },
            timeline: { status: "Completed", timestamp: new Date(), user: "Payment Link" },
          },
        },
        { session: mongoSession }
      );
    }

    // If linked to a table session, close it & free table
    if (link.tableSessionId) {
      const session = await TableSession.findOne({
        _id: link.tableSessionId,
        restaurantId: link.restaurantId,
        status: { $ne: "CLOSED" },
      }).session(mongoSession);

      if (session) {
        session.status = "CLOSED";
        session.closedAt = new Date();
        session.payment = { method: "PAYMENT_LINK", status: "PAID", transactionId, paidAt: new Date() };
        session.paymentHistory = session.paymentHistory || [];
        session.paymentHistory.push({
          method: "PAYMENT_LINK",
          amount: lockedAmount,
          status: "PAID",
          transactionId,
          idempotencyKey: effectiveIdempotencyKey,
          at: new Date(),
        });
        await session.save({ session: mongoSession });
      }
    }

    await mongoSession.commitTransaction();
    res.status(200).json({ success: true, data: txn[0] });
  } catch (error) {
    await mongoSession.abortTransaction();
    next(error);
  } finally {
    mongoSession.endSession();
  }
};

// ============================================================
// POS: list payment links (tenant-scoped)
// ============================================================
const listPaymentLinks = async (req, res, next) => {
  try {
    const scopeQuery = { restaurantId: req.user.restaurantId };
    if (req.user.outletId) scopeQuery.outletId = req.user.outletId;
    const links = await PaymentLink.find({ ...scopeQuery, isDeleted: { $ne: true } })
      .sort({ createdAt: -1 })
      .limit(100);
    res.status(200).json({ success: true, data: links });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// POS: list payment transactions (ledger)
// ============================================================
const listPaymentTransactions = async (req, res, next) => {
  try {
    const scopeQuery = { restaurantId: req.user.restaurantId };
    if (req.user.outletId) scopeQuery.outletId = req.user.outletId;
    const { status } = req.query;
    if (status) scopeQuery.status = status;
    const txns = await PaymentTransaction.find({ ...scopeQuery, isDeleted: { $ne: true } })
      .populate("billId", "billNumber")
      .sort({ createdAt: -1 })
      .limit(200);
    res.status(200).json({ success: true, data: txns });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  validateCollectionPhone,
  createPaymentLink,
  getPaymentLink,
  verifyAndCaptureLinkPayment,
  listPaymentLinks,
  listPaymentTransactions,
};
