/**
 * Ready-notification service (Module 4 §3).
 *
 * Single choke-point for sending the "Order is Ready" SMS to a customer.
 * Every code path that transitions an order to Ready — manual mark-ready
 * by staff, KDS auto-transition, and the automatic-ready timer — funnels
 * through here so the duplicate-suppression logic is enforced in exactly
 * one place.
 *
 * Design choices:
 *  - Idempotent by design. Uses a compare-and-set against
 *    `readyNotifiedAt` so two racing callers can never send the SMS
 *    twice. A second caller finds the field already stamped and simply
 *    returns { skipped: true, reason: "duplicate" }.
 *  - Refuses to send when no phone is available. The spec says explicitly:
 *    "Do not send if phone number is unavailable" (Module 4 §3).
 *  - Never throws. The Ready transition itself must succeed even if the
 *    SMS provider is down — we log and return a result object instead.
 */

const mongoose = require("mongoose");
const Order = require("../models/orderModel");
const Restaurant = require("../models/restaurantModel");
const { sendOrderReadyMessage } = require("./messagingService");

const notifyOrderReady = async (orderOrId, { force = false } = {}) => {
  let order = orderOrId;
  if (!order || typeof order === "string" || order instanceof mongoose.Types.ObjectId) {
    order = await Order.findById(orderOrId);
    if (!order) {
      return { success: false, sent: false, reason: "order_not_found" };
    }
  }

  const phone = order.customerDetails?.phone;
  if (!phone || String(phone).replace(/\D/g, "").length < 10) {
    return { success: false, sent: false, reason: "no_phone" };
  }

  // Compare-and-set duplicate guard: only send if readyNotifiedAt is
  // still null. `findOneAndUpdate` with `readyNotifiedAt: null` as part
  // of the filter is atomic in MongoDB, so two workers/requests cannot
  // both flip the flag from null → now.
  if (!force) {
    const claim = await Order.findOneAndUpdate(
      { _id: order._id, readyNotifiedAt: null },
      { $set: { readyNotifiedAt: new Date() } },
      { new: true }
    );
    if (!claim) {
      return { success: true, sent: false, reason: "duplicate" };
    }
    // Use the freshly-updated document below (has the timestamp).
    order = claim;
  }

  let restaurantName = "";
  try {
    if (order.restaurantId) {
      const restaurant = await Restaurant.findById(order.restaurantId).select("name");
      restaurantName = restaurant?.name || "";
    }
  } catch (err) {
    // Non-fatal — the SMS still gets a sane fallback name.
    restaurantName = "";
  }

  const result = await sendOrderReadyMessage({
    phone,
    orderNumber: order.orderNumber || String(order._id).slice(-6).toUpperCase(),
    restaurantName,
    orderType: order.orderType,
  });

  // If the send failed we ROLL BACK the readyNotifiedAt so the next
  // trigger (e.g. the operator clicking "Notify again" or an auto-retry)
  // can attempt again without hitting the duplicate guard. We only roll
  // back on hard failure — a "SKIPPED" result already returned above.
  if (!result.success && !force) {
    try {
      await Order.updateOne(
        { _id: order._id },
        { $set: { readyNotifiedAt: null } }
      );
    } catch (err) {
      // If the rollback itself fails, log and move on — the notification
      // was still attempted; a future manual retry can force=true.
      console.warn("readyNotification rollback failed:", err.message);
    }
  }

  return {
    success: result.success,
    sent: !!result.sent,
    provider: result.provider,
    reason: result.success ? "sent" : (result.error || "send_failed"),
  };
};

module.exports = { notifyOrderReady };
