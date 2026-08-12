const createHttpError = require("http-errors");
const Order = require("../models/orderModel");
const Bill = require("../models/billModel");
const TableSession = require("../models/tableSessionModel");
const Restaurant = require("../models/restaurantModel");
const { buildReceipt } = require("../services/receiptService");
const { sendEBillMessage } = require("../services/messagingService");

/**
 * GET /api/receipts/order/:orderId
 * Get formatted receipt for an order
 */
const getReceiptForOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const scopeQuery = req.user?.restaurantId
      ? { restaurantId: req.user.restaurantId }
      : {};

    const order = await Order.findOne({ _id: orderId, ...scopeQuery, isDeleted: { $ne: true } });
    if (!order) {
      throw createHttpError(404, "Order not found!");
    }

    const restaurant = await Restaurant.findById(order.restaurantId);
    const bill = await Bill.findOne({ orderId: order._id, isDeleted: { $ne: true } });

    const receipt = buildReceipt({
      order,
      bill,
      restaurant,
    });

    return res.status(200).json({
      success: true,
      data: receipt,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/receipts/session/:sessionId
 * Get formatted receipt for a table order session
 */
const getReceiptForSession = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const scopeQuery = req.user?.restaurantId
      ? { restaurantId: req.user.restaurantId }
      : {};

    const session = await TableSession.findOne({ _id: sessionId, ...scopeQuery, isDeleted: { $ne: true } })
      .populate("tableId");

    if (!session) {
      throw createHttpError(404, "Table session not found!");
    }

    const restaurant = await Restaurant.findById(session.restaurantId);
    let bill = null;
    if (session.billId) {
      bill = await Bill.findById(session.billId);
    }

    const receipt = buildReceipt({
      tableSession: session,
      bill,
      restaurant,
    });

    return res.status(200).json({
      success: true,
      data: receipt,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/receipts/send-ebill
 * Deliver electronic bill via SMS / WhatsApp messaging infrastructure.
 */
const sendEBill = async (req, res, next) => {
  try {
    const { orderId, tableSessionId, phone } = req.body;

    if (!orderId && !tableSessionId) {
      throw createHttpError(400, "Either orderId or tableSessionId is required to send e-bill.");
    }

    const scopeQuery = req.user?.restaurantId
      ? { restaurantId: req.user.restaurantId }
      : {};

    let order = null;
    let tableSession = null;
    let bill = null;
    let restaurant = null;

    if (orderId) {
      order = await Order.findOne({ _id: orderId, ...scopeQuery, isDeleted: { $ne: true } });
      if (!order) throw createHttpError(404, "Order not found.");
      bill = await Bill.findOne({ orderId: order._id, isDeleted: { $ne: true } });
      restaurant = await Restaurant.findById(order.restaurantId);
    }

    if (tableSessionId) {
      tableSession = await TableSession.findOne({ _id: tableSessionId, ...scopeQuery, isDeleted: { $ne: true } })
        .populate("tableId");
      if (!tableSession) throw createHttpError(404, "Table session not found.");
      if (tableSession.billId) {
        bill = await Bill.findById(tableSession.billId);
      }
      restaurant = await Restaurant.findById(tableSession.restaurantId);
    }

    const receipt = buildReceipt({
      order,
      tableSession,
      bill,
      restaurant,
    });

    // Resolve customer phone
    const targetPhone = phone || receipt.customerInformation.phone;

    if (!targetPhone) {
      return res.status(400).json({
        success: false,
        sent: false,
        deliveryStatus: "FAILED",
        message: "Customer contact information (phone number) is missing. Cannot send e-bill.",
        data: { receipt },
      });
    }

    // Call messaging infrastructure
    const messagingResult = await sendEBillMessage({
      phone: targetPhone,
      orderNumber: receipt.orderNumber,
      restaurantName: receipt.restaurant.name,
      total: receipt.total,
      itemsCount: receipt.quantities,
      receiptUrl: `${process.env.FRONTEND_URL || "http://localhost:5173"}/receipt/${receipt.orderNumber}`,
    });

    return res.status(200).json({
      success: messagingResult.success,
      sent: messagingResult.sent,
      deliveryStatus: messagingResult.deliveryStatus,
      message: messagingResult.sent ? "E-bill sent successfully." : (messagingResult.error || "E-bill delivery failed."),
      data: {
        receipt,
        messagingDetails: messagingResult,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getReceiptForOrder,
  getReceiptForSession,
  sendEBill,
};
