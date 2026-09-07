/**
 * E-bills: one implementation, two triggers.
 *
 * The manual "Send E-Bill" button and the automatic send on payment must
 * produce byte-identical messages -- same receipt, same signed link, same
 * variable order. Two copies of that would drift, and the drift would be
 * invisible: both paths would keep answering 200 while one of them quietly
 * sent the wrong thing.
 *
 * Auto-send
 * ---------
 * Off by default, per restaurant, via posSettings.autoEBill. That toggle has
 * existed in Settings for a long time and was read by nothing -- it saved to
 * the database and the operator got no e-bill. It is now the actual switch.
 *
 * Sending is claimed atomically through `eBillSentAt`, so a settle that gets
 * retried (a webhook redelivery, a double-tap on Mark Paid) cannot message the
 * customer twice. The claim is released again if the send fails, so a genuine
 * failure stays retryable rather than being permanently marked as done.
 */

const Order = require("../models/orderModel");
const Bill = require("../models/billModel");
const TableSession = require("../models/tableSessionModel");
const Restaurant = require("../models/restaurantModel");
const { buildReceipt } = require("./receiptService");
const { sendEBillMessage } = require("./messagingService");
const { urlForOrder, urlForSession } = require("./receiptLink");
const { fireEBillCharge } = require("./ebillCharge");

/**
 * Load everything a receipt needs, for either subject.
 *
 * `scopeQuery` is the caller's tenant scope. The automatic path passes none
 * because it already holds a document it loaded within a tenant; the HTTP
 * path always passes one.
 */
const loadEBillSubject = async ({ orderId, tableSessionId, scopeQuery = {} }) => {
  let order = null;
  let tableSession = null;
  let bill = null;
  let restaurantId = null;

  if (orderId) {
    order = await Order.findOne({ _id: orderId, ...scopeQuery, isDeleted: { $ne: true } });
    if (!order) return null;
    bill = await Bill.findOne({ orderId: order._id, isDeleted: { $ne: true } });
    restaurantId = order.restaurantId;
  }

  if (tableSessionId) {
    tableSession = await TableSession.findOne({
      _id: tableSessionId,
      ...scopeQuery,
      isDeleted: { $ne: true },
    }).populate("tableId");
    if (!tableSession) return null;
    if (tableSession.billId) bill = await Bill.findById(tableSession.billId);
    restaurantId = tableSession.restaurantId;
  }

  const restaurant = restaurantId ? await Restaurant.findById(restaurantId) : null;
  return { order, tableSession, bill, restaurant };
};

/**
 * Build the message and send it.
 *
 * Returns the receipt and the link alongside the delivery result, so a caller
 * can show the operator the bill URL even when delivery failed -- they can
 * then read it out or copy it rather than being told only that it did not
 * work.
 */
const deliverEBill = async ({ order, tableSession, bill, restaurant, phone }) => {
  const receipt = buildReceipt({ order, tableSession, bill, restaurant });

  const targetPhone = phone || receipt.customerInformation.phone;
  if (!targetPhone) {
    return {
      receipt,
      billUrl: null,
      result: {
        success: false,
        sent: false,
        deliveryStatus: "SKIPPED",
        error: "No customer phone number on file.",
      },
    };
  }

  // A missing signing key or public origin is a misconfiguration, not a
  // server fault. Report it in the same shape as any other non-delivery,
  // naming what to fix.
  let billUrl;
  try {
    billUrl = tableSession ? urlForSession(tableSession._id) : urlForOrder(order._id);
  } catch (linkErr) {
    return {
      receipt,
      billUrl: null,
      result: {
        success: false,
        sent: false,
        deliveryStatus: "FAILED",
        error: linkErr.message,
      },
    };
  }

  const result = await sendEBillMessage({
    phone: targetPhone,
    orderNumber: receipt.orderNumber,
    restaurantName: receipt.restaurant.name,
    // The template renders "Total: Rs {{2}}", so the variable is the bare
    // amount -- no symbol, always two decimals.
    total: Number(receipt.total || 0).toFixed(2),
    itemsCount: receipt.quantities,
    receiptUrl: billUrl,
  });

  // Charged on DELIVERY, never on an attempt. A send that failed cost the
  // restaurant nothing and must cost them nothing. Fire-and-forget: the
  // message is already gone and a billing problem must not turn a delivered
  // e-bill into an error.
  if (result.sent) {
    fireEBillCharge({
      restaurantId: (order || tableSession)?.restaurantId,
      messageId: result.messageId,
      refType: tableSession ? "TableSession" : "Order",
      refId: (tableSession || order)?._id || null,
      orderNumber: receipt.orderNumber,
    });
  }

  return { receipt, billUrl, result };
};

/** Is auto-send switched on for this restaurant? */
const autoEBillEnabled = (restaurant) =>
  Boolean(restaurant && restaurant.posSettings && restaurant.posSettings.autoEBill);

/**
 * Claim the send.
 *
 * `{ eBillSentAt: null }` matches documents where the field is null AND where
 * it is absent, so this works on records written before the field existed
 * without needing a migration.
 */
const claimSend = async (Model, id) => {
  const claimed = await Model.findOneAndUpdate(
    { _id: id, eBillSentAt: null },
    { $set: { eBillSentAt: new Date() } },
  );
  return Boolean(claimed);
};

const releaseClaim = async (Model, id) => {
  try {
    await Model.updateOne({ _id: id }, { $set: { eBillSentAt: null } });
  } catch (err) {
    console.warn("[AutoEBill] could not release the send claim:", err.message);
  }
};

/**
 * Fire the automatic e-bill for a just-settled order or table session.
 *
 * Never throws and never blocks the settle: the money has already moved, and
 * a messaging failure must not turn a successful payment into an error for
 * the operator. Call it fire-and-forget, the way notifyOrderReady is called.
 */
const maybeSendAutoEBill = async ({ orderId, tableSessionId } = {}) => {
  try {
    if (!orderId && !tableSessionId) return { sent: false, reason: "no subject" };

    const subject = await loadEBillSubject({ orderId, tableSessionId });
    if (!subject) return { sent: false, reason: "not found" };

    if (!autoEBillEnabled(subject.restaurant)) {
      return { sent: false, reason: "auto e-bill is off for this restaurant" };
    }

    const Model = tableSessionId ? TableSession : Order;
    const id = tableSessionId || orderId;

    if (!(await claimSend(Model, id))) {
      return { sent: false, reason: "already sent" };
    }

    const { result } = await deliverEBill(subject);

    if (!result.sent) {
      // Nothing reached the customer, so this must remain sendable -- both by
      // a later retry and by the operator pressing the button.
      await releaseClaim(Model, id);
      console.warn(`[AutoEBill] not sent (${result.deliveryStatus}):`, result.error);
      return { sent: false, reason: result.error };
    }

    return { sent: true };
  } catch (err) {
    console.warn("[AutoEBill] failed:", err && err.message);
    return { sent: false, reason: err && err.message };
  }
};

/** Fire-and-forget wrapper, so call sites stay one line and cannot forget the catch. */
const fireAutoEBill = (subject) => {
  maybeSendAutoEBill(subject).catch((err) => {
    console.warn("[AutoEBill] unhandled:", err && err.message);
  });
};

module.exports = {
  loadEBillSubject,
  deliverEBill,
  maybeSendAutoEBill,
  fireAutoEBill,
  autoEBillEnabled,
};
