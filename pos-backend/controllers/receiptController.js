const createHttpError = require("http-errors");
const { loadEBillSubject, deliverEBill } = require("../services/eBillService");

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

    const scopeQuery = req.user?.restaurantId ? { restaurantId: req.user.restaurantId } : {};

    // Loading and sending both live in services/eBillService so this button
    // and the automatic send on payment produce the identical message. Two
    // copies would drift, and the drift would be invisible -- both paths
    // would keep answering 200 while one sent the wrong thing.
    const subject = await loadEBillSubject({ orderId, tableSessionId, scopeQuery });
    if (!subject) {
      throw createHttpError(404, tableSessionId ? "Table session not found." : "Order not found.");
    }

    const { receipt, billUrl, result } = await deliverEBill({ ...subject, phone });

    // A missing phone is the operator's problem to fix, not a server error.
    if (result.deliveryStatus === "SKIPPED") {
      return res.status(400).json({
        success: false,
        sent: false,
        deliveryStatus: "FAILED",
        message: "Customer contact information (phone number) is missing. Cannot send e-bill.",
        data: { receipt },
      });
    }

    // `billUrl` goes back even when delivery failed, so the POS can show the
    // operator a link to read out or copy rather than only telling them it
    // did not work.
    return res.status(200).json({
      success: result.success,
      sent: result.sent,
      deliveryStatus: result.deliveryStatus,
      message: result.sent ? "E-bill sent successfully." : result.error || "E-bill delivery failed.",
      data: {
        receipt,
        billUrl,
        messagingDetails: result,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  sendEBill,
};
