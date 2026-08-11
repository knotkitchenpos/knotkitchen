const crypto = require("crypto");
const createHttpError = require("http-errors");
const Razorpay = require("razorpay");
const config = require("../config/config");
const PaymentLink = require("../models/paymentLinkModel");
const PaymentTransaction = require("../models/paymentTransactionModel");
const Bill = require("../models/billModel");
const TableSession = require("../models/tableSessionModel");

// ============================================================
// Create a payment link for a bill (POS or QR requested)
// ============================================================
const createPaymentLink = async (req, res, next) => {
  try {
    const { billId, tableSessionId, expiresInHours = 24 } = req.body;
    if (!billId) throw createHttpError(400, "billId is required!");

    const scopeQuery = { restaurantId: req.user.restaurantId };
    if (req.user.outletId) scopeQuery.outletId = req.user.outletId;

    const bill = await Bill.findOne({ _id: billId, ...scopeQuery, isDeleted: { $ne: true } });
    if (!bill) throw createHttpError(404, "Bill not found!");
    if (bill.status === "PAID") throw createHttpError(400, "Bill already paid!");

    const linkToken = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + Number(expiresInHours) * 3600 * 1000);

    let gatewayOrderId = "";
    // Create Razorpay order so customer can pay via link
    if (config.razorpayKeyId && config.razorpaySecretKey) {
      const razorpay = new Razorpay({ key_id: config.razorpayKeyId, key_secret: config.razorpaySecretKey });
      const order = await razorpay.orders.create({
        amount: Math.round(bill.dueAmount * 100),
        currency: bill.currency || "INR",
        receipt: `link_${linkToken.slice(0, 10)}`,
      });
      gatewayOrderId = order.id;
    }

    const link = await PaymentLink.create({
      restaurantId: bill.restaurantId,
      outletId: bill.outletId || req.user.outletId,
      billId: bill._id,
      tableSessionId: tableSessionId || bill.tableSessionId,
      customerId: bill.customerId,
      linkToken,
      amount: bill.dueAmount,
      currency: bill.currency || "INR",
      gatewayOrderId,
      expiresAt,
      createdBy: req.user._id,
    });

    res.status(201).json({
      success: true,
      data: {
        ...link.toObject(),
        paymentUrl: `${process.env.FRONTEND_URL || "http://localhost:5173"}/pay/${linkToken}`,
      },
    });
  } catch (error) { next(error); }
};

// ============================================================
// Public: resolve a payment link (customer opens /pay/:token)
// ============================================================
const getPaymentLink = async (req, res, next) => {
  try {
    const { token } = req.params;
    const link = await PaymentLink.findOne({ linkToken: token, isDeleted: { $ne: true } }).populate("billId");
    if (!link) throw createHttpError(404, "Payment link not found.");
    if (link.status === "PAID") throw createHttpError(400, "This payment link has already been paid.");
    if (link.status === "EXPIRED" || Date.now() > new Date(link.expiresAt).getTime()) {
      throw createHttpError(400, "This payment link has expired.");
    }

    const bill = link.billId;
    res.status(200).json({
      success: true,
      data: {
        linkToken: link.linkToken,
        amount: bill?.dueAmount ?? link.amount,
        currency: link.currency,
        gatewayOrderId: link.gatewayOrderId,
        restaurantId: link.restaurantId,
        billNumber: bill?.billNumber,
        expiresAt: link.expiresAt,
      },
    });
  } catch (error) { next(error); }
};

// ============================================================
// Public: capture verified Razorpay payment on a link
// Records PaymentTransaction + marks bill/session/link paid.
// Idempotent — a successful payment for the same idempotency
// key is returned as-is (never double-applies).
// ============================================================
const verifyAndCaptureLinkPayment = async (req, res, next) => {
  const mongoSession = await require("mongoose").startSession();
  mongoSession.startTransaction();
  try {
    const { token } = req.params;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, idempotencyKey } = req.body;

    const link = await PaymentLink.findOne({ linkToken: token, isDeleted: { $ne: true } }).session(mongoSession);
    if (!link) throw createHttpError(404, "Payment link not found.");
    if (link.status === "PAID") throw createHttpError(400, "Payment link already paid.");

    // Verify signature server-side
    const expected = crypto
      .createHmac("sha256", config.razorpaySecretKey)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");
    if (expected !== razorpay_signature) throw createHttpError(400, "Invalid payment signature!");

    // Idempotency: already-captured link payment
    const existingTxn = idempotencyKey
      ? await PaymentTransaction.findOne({
          restaurantId: link.restaurantId,
          idempotencyKey,
          status: "PAID",
        }).session(mongoSession)
      : null;
    if (existingTxn) {
      await mongoSession.commitTransaction();
      return res.status(200).json({ success: true, data: existingTxn, deduplicated: true });
    }

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
          method: "PAYMENT_LINK",
          amount: link.amount,
          status: "PAID",
          provider: "RAZORPAY",
          transactionId: razorpay_payment_id,
          gatewayOrderId: razorpay_order_id,
          gatewayPaymentId: razorpay_payment_id,
          idempotencyKey: idempotencyKey || "",
          paidAt: new Date(),
        },
      ],
      { session: mongoSession }
    );

    // Update link + bill
    link.status = "PAID";
    link.paidAmount = link.amount;
    link.paidAt = new Date();
    await link.save({ session: mongoSession });

    await Bill.findOneAndUpdate(
      { _id: link.billId, restaurantId: link.restaurantId },
      { status: "PAID", paidAmount: link.amount, dueAmount: 0, settledAt: new Date() },
      { session: mongoSession }
    );

    // If linked to a session, close it + free table
    if (link.tableSessionId) {
      const session = await TableSession.findOne({
        _id: link.tableSessionId,
        restaurantId: link.restaurantId,
        status: { $ne: "CLOSED" },
      }).session(mongoSession);
      if (session) {
        session.status = "CLOSED";
        session.closedAt = new Date();
        session.payment = { method: "PAYMENT_LINK", status: "PAID", transactionId: razorpay_payment_id, paidAt: new Date() };
        session.paymentHistory = session.paymentHistory || [];
        session.paymentHistory.push({
          method: "PAYMENT_LINK",
          amount: link.amount,
          status: "PAID",
          transactionId: razorpay_payment_id,
          idempotencyKey: idempotencyKey || "",
          at: new Date(),
        });
        session.timeline.push({ event: "PAYMENT_COMPLETED", note: "Paid via payment link", actorType: "QR" });
        session.timeline.push({ event: "SESSION_CLOSED", note: "Session closed after link payment", actorType: "QR" });
        await session.save({ session: mongoSession });
        await TableSession.populate(session, { path: "tableId" });
        if (session.tableId?._id) {
          const Table = require("../models/tableModel");
          await Table.findOneAndUpdate(
            { _id: session.tableId._id, restaurantId: session.restaurantId },
            { status: "available", currentOrderId: null },
            { session: mongoSession }
          );
        }
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
  } catch (error) { next(error); }
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
  } catch (error) { next(error); }
};

module.exports = {
  createPaymentLink,
  getPaymentLink,
  verifyAndCaptureLinkPayment,
  listPaymentLinks,
  listPaymentTransactions,
};