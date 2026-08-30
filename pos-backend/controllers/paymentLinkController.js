const crypto = require("crypto");
const createHttpError = require("http-errors");
const Razorpay = require("razorpay");
const config = require("../config/config");
const PaymentLink = require("../models/paymentLinkModel");
const PaymentTransaction = require("../models/paymentTransactionModel");
const Bill = require("../models/billModel");
const Order = require("../models/orderModel");
const TableSession = require("../models/tableSessionModel");
const Restaurant = require("../models/restaurantModel");
const { sendPaymentLinkMessage } = require("../services/messagingService");
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
      const paymentUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/pay/${existingActiveLink.linkToken}`;
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
    const settings = await WebsiteSettings.findOne({
      $or: [{ restaurantId: req.user.restaurantId }, { storeId: req.user.storeId }],
    });

    const activeGw = (settings?.paymentGateways?.activeGateway || "razorpay").toLowerCase();
    const gwConfig = settings?.paymentGateways?.[activeGw];

    let gatewayOrderId = "";
    let gatewayKeyId = config.razorpayKeyId;
    let gatewaySecret = config.razorpaySecretKey;

    if (gwConfig && gwConfig.isConfigured) {
      if (activeGw === "razorpay" && gwConfig.keyId) {
        gatewayKeyId = gwConfig.keyId;
        if (gwConfig.keySecretEncrypted) {
          gatewaySecret = Buffer.from(gwConfig.keySecretEncrypted, "base64").toString("utf-8");
        }
      } else if (activeGw === "cashfree" && gwConfig.clientId) {
        gatewayKeyId = gwConfig.clientId;
        if (gwConfig.clientSecretEncrypted) {
          gatewaySecret = Buffer.from(gwConfig.clientSecretEncrypted, "base64").toString("utf-8");
        }
      } else if (activeGw === "phonepe" && gwConfig.merchantId) {
        gatewayKeyId = gwConfig.merchantId;
        if (gwConfig.saltKeyEncrypted) {
          gatewaySecret = Buffer.from(gwConfig.saltKeyEncrypted, "base64").toString("utf-8");
        }
      }
    }

    if (activeGw === "razorpay" && gatewayKeyId && gatewaySecret) {
      try {
        const razorpay = new Razorpay({ key_id: gatewayKeyId, key_secret: gatewaySecret });
        const order = await razorpay.orders.create({
          amount: Math.round(calculatedAmount * 100),
          currency: targetBill?.currency || "INR",
          receipt: `link_${linkToken.slice(0, 10)}`,
        });
        gatewayOrderId = order.id;
      } catch (err) {
        console.warn("Razorpay order creation skipped:", err.message);
      }
    } else if (activeGw === "cashfree" || activeGw === "phonepe") {
      gatewayOrderId = `${activeGw.toUpperCase()}_LINK_${Date.now().toString(36)}`;
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
      gatewayName: activeGw.toUpperCase(),
      gatewayOrderId,
      expiresAt,
      createdBy: req.user._id,
    });

    const paymentUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/pay/${linkToken}`;

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
        // The customer page passes this to Razorpay Checkout as `order_id`
        // (pos-frontend/src/pages/PaymentLink.jsx). It was missing from this
        // payload, so checkout opened with order_id: undefined. Not a secret —
        // it is a gateway order handle that is useless without a valid
        // signature, and the capture endpoint now requires one that matches
        // this exact value.
        gatewayOrderId: link.gatewayOrderId || "",
        gatewayName: link.gatewayName || "RAZORPAY",
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
        availablePaymentMethods: ["RAZORPAY", "CARD", "UPI", "NETBANKING"],
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
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, idempotencyKey, paymentMethod = "RAZORPAY" } = req.body;

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
    // The previous guard was:
    //
    //   if (config.razorpaySecretKey && razorpay_order_id && razorpay_payment_id)
    //
    // Two of those three operands are attacker-controlled request-body fields,
    // so simply OMITTING them skipped verification entirely and fell through to
    // the "mark everything paid" code below. `POST /:token/verify` with a body
    // of `{"paymentMethod":"UPI"}` settled any bill for free.
    //
    // Verification is now required, and failure to verify is fatal.
    if (!config.razorpaySecretKey) {
      // Refuse rather than trust: with no secret we cannot tell a real payment
      // from a forged one. Genuine payments still reconcile via the webhook.
      throw createHttpError(503, "Payment verification is unavailable. Please contact the restaurant.");
    }

    // Only Razorpay is actually integrated. The cashfree/phonepe branches in
    // createPaymentLink mint a synthetic gatewayOrderId and never create a real
    // gateway order, so a "capture" for them would be unverifiable by
    // construction. Reject instead of pretending.
    const linkGateway = String(link.gatewayName || "RAZORPAY").toUpperCase();
    if (linkGateway !== "RAZORPAY") {
      throw createHttpError(501, "This payment method cannot be confirmed here.");
    }

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw createHttpError(400, "Invalid payment signature!");
    }

    // Bind the signed payload to THIS link. Without this a valid signature from
    // any other Razorpay order on the same account would settle this link.
    if (link.gatewayOrderId && razorpay_order_id !== link.gatewayOrderId) {
      throw createHttpError(400, "Invalid payment signature!");
    }

    const expected = crypto
      .createHmac("sha256", config.razorpaySecretKey)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    // Constant-time: a plain !== leaks how much of the signature matched.
    if (!timingSafeEquals(expected, String(razorpay_signature))) {
      throw createHttpError(400, "Invalid payment signature!");
    }

    const transactionId = razorpay_payment_id || `txn_${crypto.randomBytes(12).toString("hex")}`;
    const gatewayOrder = razorpay_order_id || link.gatewayOrderId || "";

    // Idempotency check
    const effectiveIdempotencyKey = idempotencyKey || `pay-link-${link._id}-${transactionId}`;
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
          // provider names. `paymentMethod` defaults to "RAZORPAY" and the
          // customer page never sends the field, so this previously threw a
          // ValidationError on every genuine capture and aborted the
          // transaction. See constants/paymentMethods.js.
          method: normalizePaymentMethod(paymentMethod),
          amount: lockedAmount,
          status: "PAID",
          provider: link.gatewayName || "RAZORPAY",
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
