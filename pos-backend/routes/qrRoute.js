const express = require("express");
const createHttpError = require("http-errors");
const { isVerifiedUser, resolveTableScope } = require("../middlewares/tokenVerification");
const { requirePermission } = require("../middlewares/requirePermission");
const Table = require("../models/tableModel");
const Menu = require("../models/menuModel");
const Order = require("../models/orderModel");
const TableSession = require("../models/tableSessionModel");
const Bill = require("../models/billModel");
const Restaurant = require("../models/restaurantModel");
const { findActiveSessionByTable, recalculateSessionBill, validateCapacity, enrichItems, runWithSessionRetry, generateSessionCode } = require("../controllers/tableSessionController");
const priceService = require("../services/price");
// Lazy-require services/socket only when we actually need to emit — importing
// it eagerly pulls in socket.io which touches mongoose internals and breaks
// tests that mock mongoose before the models are loaded (tableQROrdering.test).
const getSocket = () => require("../services/socket");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { PREPARING } = require("../constants/orderStatus");
// Lazy for the same reason as getSocket above: autoReadyService pulls in the
// Order/WebsiteSettings models, and requiring them at module load breaks the
// tests that mock mongoose before the models are loaded.
const computeReadyDueAt = (args) => require("../services/autoReadyService").computeReadyDueAt(args);
const router = express.Router();

const scopedMenu = (restaurantId, outletId) =>
  Menu.find({ restaurantId, outletId: { $in: [outletId, null] }, isDeleted: false, $or: [{ published: true }, { isPublished: true }] });

// Public session sanitizer — strips internal fields before returning to the
// customer browser. Never exposes restaurantId/outletId-driven internals
// beyond what the customer page needs.
const sanitizeSession = (session) => {
  if (!session) return null;
  const plain = session.toObject ? session.toObject() : { ...session };
  return {
    _id: plain._id,
    sessionCode: plain.sessionCode,
    status: plain.status,
    customerCount: plain.customerCount,
    customerName: plain.customerName,
    customerPhone: plain.customerPhone,
    items: (plain.items || []).map((it) => ({
      _id: it._id,
      menuItemId: it.menuItemId,
      name: it.name,
      quantity: it.quantity,
      price: it.price,
      total: it.total,
      modifiers: it.modifiers || [],
      note: it.note || "",
      status: it.status,
      addedBy: it.addedBy,
    })),
    bills: plain.bills || { subtotal: 0, tax: 0, discount: 0, charges: 0, totalWithTax: 0 },
    openedAt: plain.openedAt,
    billRequestedAt: plain.billRequestedAt,
    payment: plain.payment
      ? {
          status: plain.payment.status,
          method: plain.payment.method || "",
        }
      : { status: "PENDING", method: "" },
  };
};

const getActiveSessionForTable = async ({ tableId, restaurantId }) =>
  TableSession.findOne({
    tableId,
    restaurantId,
    status: { $in: ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"] },
    isDeleted: { $ne: true },
  });

router.route("/tables/:tableId/generate").post(isVerifiedUser, requirePermission("TABLE_UPDATE"), async (req, res, next) => {
  try {
    const token = crypto.randomBytes(16).toString("hex");
    const qrUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/order?table=${token}`;
    const table = await Table.findOneAndUpdate({ _id: req.params.tableId, restaurantId: req.user.restaurantId }, { qrToken: token, qrCode: qrUrl }, { new: true });
    if (!table) return res.status(404).json({ success: false, message: "Table not found!" });
    res.status(200).json({ success: true, data: table });
  } catch (error) { next(error); }
});

// Public: table info + restaurant info + menu + active session detail.
// Tenant is resolved server-side from the secure QR token — the client can
// never change restaurant/outlet/table through URL or body manipulation.
router.route("/table/:token").get(resolveTableScope, async (req, res, next) => {
  try {
    const { table, restaurantId, outletId } = req.scope;
    const menu = await scopedMenu(restaurantId, outletId);
    const activeSession = await getActiveSessionForTable({ tableId: table._id, restaurantId });

    const restaurant = await Restaurant.findOne({
      _id: restaurantId,
      isDeleted: { $ne: true },
    }).lean();

    res.status(200).json({
      success: true,
      data: {
        table: { _id: table._id, tableNumber: table.tableNumber, capacity: table.capacity, restaurantId, outletId },
        restaurant: restaurant
          ? {
              _id: restaurant._id,
              name: restaurant.name,
              currency: restaurant.currency || "INR",
              branding: restaurant.branding || {},
              address: restaurant.address || {},
            }
          : null,
        menu,
        activeSession: sanitizeSession(activeSession),
      },
    });
  } catch (error) { next(error); }
});

// Public: full active session detail for a table (re-scan / "continue ordering").
// Token-scoped: the session is always resolved from the QR's tableId —
// a customer can never request another table's session.
router.route("/session/:token").get(resolveTableScope, async (req, res, next) => {
  try {
    const { table, restaurantId } = req.scope;
    const activeSession = await getActiveSessionForTable({ tableId: table._id, restaurantId });
    if (!activeSession) {
      return res.status(404).json({ success: false, message: "No active session for this table." });
    }
    res.status(200).json({ success: true, data: { session: sanitizeSession(activeSession) } });
  } catch (error) { next(error); }
});

// Public: customers add items to an existing session (or auto-create one).
// Token-scoped: the table is resolved from the QR token — a client-supplied
// tableId in the URL/body is NEVER trusted.
// Transactional + E11000 retry prevents concurrent duplicate session creation,
// so repeated scans during an active session reuse the SAME session.
router.route("/session/items/:token").post(resolveTableScope, async (req, res, next) => {
  try {
    const { table, restaurantId, outletId } = req.scope;
    const { items, customerCount, customerName, customerPhone, requestId } = req.body;
    if (!table.qrEnabled) return res.status(403).json({ success: false, message: "QR ordering disabled for this table." });
    if (!items || !items.length) return res.status(400).json({ success: false, message: "items required!" });

    if (requestId) {
      const dup = await Order.findOne({ restaurantId, table: table._id, requestId, isDeleted: { $ne: true } });
      if (dup) return res.status(200).json({ success: true, data: { order: dup, deduplicated: true } });
    }

    let result;
    try {
      ({ result } = await runWithSessionRetry(async (mongoSession) => {
        // Re-read table inside the transaction for consistency
        const tableInTxn = await Table.findOne({ _id: table._id, isDeleted: { $ne: true } }).session(mongoSession);
        if (!tableInTxn) throw createHttpError(404, "Table not found!");
        if (!tableInTxn.qrEnabled) throw createHttpError(403, "QR ordering disabled for this table.");

        let session = await TableSession.findOne({
          tableId: tableInTxn._id,
          status: { $in: ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"] },
          isDeleted: { $ne: true },
        }).session(mongoSession);

        let created = false;
        if (!session) {
          session = await TableSession.create(
            [
              {
                sessionCode: generateSessionCode(),
                restaurantId, outletId, tableId: tableInTxn._id, status: "OCCUPIED", source: "QR",
                customerCount: validateCapacity(tableInTxn, customerCount),
                customerName: customerName || "", customerPhone: customerPhone || "",
                items: [], bills: { subtotal: 0, tax: 0, discount: 0, charges: 0, totalWithTax: 0 },
                payment: { method: "", status: "PENDING", transactionId: "", paidAt: null },
                openedAt: new Date(),
                timeline: [{ event: "SESSION_OPENED", note: `Table ${tableInTxn.tableNumber} opened by QR`, actorType: "QR" }],
              },
            ],
            { session: mongoSession }
          );
          session = session[0];
          created = true;
          tableInTxn.status = "occupied";
          await tableInTxn.save({ session: mongoSession });
        } else {
          if (customerCount) { validateCapacity(tableInTxn, customerCount); session.customerCount = Number(customerCount); }
          if (customerName) session.customerName = customerName;
          if (customerPhone) session.customerPhone = customerPhone;
        }

        const validatedItems = await enrichItems({ items, restaurantId, outletId, addedBy: "QR" });
        session.items.push(...validatedItems);
        session.timeline.push({ event: "ITEMS_ADDED", note: `${validatedItems.length} item(s) added by QR`, actorType: "QR" });
        await recalculateSessionBill(session);

        // Module 4 §4 lists Table orders as auto-ready eligible, and
        // autoReadyService has a "table" bucket for exactly this. Without a
        // readyDueAt the sweep's `readyDueAt: { $ne: null }` filter skips the
        // order entirely, so a QR order would sit in Preparing forever.
        const readyDueAt = await computeReadyDueAt({ restaurantId, orderType: "dine-in" });

        const kitchenOrder = await Order.create(
          [
            {
              requestId: requestId || "",
              customerDetails: { name: session.customerName || "Guest", phone: session.customerPhone || "", guests: session.customerCount || 1 },
              orderType: "dine-in", orderStatus: PREPARING, bills: session.bills, readyDueAt,
              items: validatedItems.map((it) => ({ menuItemId: it.menuItemId, name: it.name, quantity: it.quantity, price: it.price, total: it.total, modifiers: it.modifiers || [], note: it.note || "", status: "pending" })),
              table: tableInTxn._id, restaurantId, outletId, createdBy: null, tableSessionId: session._id, orderDate: new Date(),
              // Origin tag → POS UI can distinguish QR-scan orders from
              // walk-in POS / marketplace / phone orders, and the realtime
              // popup can show "New QR Order — Table {n}".
              source: "QR",
            },
          ],
          { session: mongoSession }
        );

        const kitchenOrderDoc = kitchenOrder[0];
        const startIdx = session.items.length - validatedItems.length;
        validatedItems.forEach((it, idx) => {
          const si = session.items[startIdx + idx];
          if (si) { si.orderId = kitchenOrderDoc._id; si.kdsItemId = kitchenOrderDoc.items[idx]?._id; }
        });

        if (!session.billId) {
          const bill = await Bill.create(
            [
              {
                billNumber: `BL_${session.sessionCode}`, restaurantId, outletId, tableSessionId: session._id,
                customerDetails: { name: session.customerName || "Guest", phone: session.customerPhone || "", guests: session.customerCount || 1 },
                bills: session.bills, status: "PENDING", dueAmount: session.bills.totalWithTax,
              },
            ],
            { session: mongoSession }
          );
          session.billId = bill[0]._id;
        }

        // Keep table occupancy + currentOrder in sync
        tableInTxn.currentOrderId = kitchenOrderDoc._id;
        tableInTxn.currentOccupancy = session.customerCount || 0;
        await tableInTxn.save({ session: mongoSession });
        await session.save({ session: mongoSession });

        return { session, kitchenOrder: kitchenOrderDoc, created };
      }));
    } catch (err) {
      return next(err);
    }

    // Realtime notify the POS the moment a customer QR order lands so the
    // biller sees a popup with the table number + item list instantly (no
    // polling needed). The socket event name (`onlineOrder:created`) matches
    // what useOnlineOrders and MarketplaceOrderPopup already listen for.
    //
    // We repopulate the order's `table` field before emitting so the socket
    // payload carries `table.tableNumber` / `table.displayId` (the popup
    // renders "New Table Order · Table {n}" straight from this payload).
    try {
      const populatedOrder = await Order.findById(result.kitchenOrder._id).populate("table");
      getSocket().emitOrderCreated({
        restaurantId: result.session.restaurantId,
        outletId: result.session.outletId,
        order: populatedOrder || result.kitchenOrder,
      });
    } catch (socketErr) {
      console.warn("[qrRoute] socket emit failed:", socketErr.message);
    }

    res.status(201).json({
      success: true,
      data: {
        session: sanitizeSession(result.session),
        order: result.kitchenOrder,
        created: result.created,
      },
    });
  } catch (error) { next(error); }
});

// Public: customer requests bill for the table's ACTIVE session.
// Token-scoped — the session is resolved from the QR token's table,
// never from a client-supplied sessionId (prevents IDOR / cross-table bills).
// Transitions OCCUPIED/PROCESSING → BILL_REQUESTED.
router.route("/request-bill/:token").post(resolveTableScope, async (req, res, next) => {
  try {
    const { table, restaurantId } = req.scope;
    const session = await getActiveSessionForTable({ tableId: table._id, restaurantId });
    if (!session) return res.status(404).json({ success: false, message: "No active session for this table!" });
    if (session.status === "PAID" || session.status === "CLOSED") {
      return res.status(400).json({ success: false, message: "Session already settled." });
    }

    session.status = "BILL_REQUESTED";
    session.billRequestedAt = new Date();
    session.timeline.push({ event: "BILL_REQUESTED", note: "Bill requested by QR", actorType: "QR" });

    // Lazily create the canonical Bill so the bill stays persistent + historical
    if (!session.billId) {
      const bill = await Bill.create([
        {
          billNumber: `BL_${session.sessionCode}`,
          restaurantId,
          outletId: session.outletId || req.scope.outletId,
          tableSessionId: session._id,
          customerDetails: {
            name: session.customerName || "Guest",
            phone: session.customerPhone || "",
            guests: session.customerCount || 1,
          },
          bills: session.bills,
          status: "PENDING",
          requestedAt: new Date(),
          dueAmount: session.bills?.totalWithTax || 0,
        },
      ]);
      session.billId = bill[0]._id;
    }

    await session.save();
    res.status(200).json({ success: true, data: sanitizeSession(session) });
  } catch (error) { next(error); }
});

// Public: customer selects payment (prepare payment UI + amount).
// Transitions BILL_REQUESTED → PAYMENT_PENDING. Full payment capture is
// handled separately by the POS — this only moves the bill to payment-pending
// and returns what the customer page needs to render the payment section.
router.route("/payment-intent/:token").post(resolveTableScope, async (req, res, next) => {
  try {
    const { table, restaurantId } = req.scope;
    const session = await getActiveSessionForTable({ tableId: table._id, restaurantId });
    if (!session) return res.status(404).json({ success: false, message: "No active session for this table!" });
    if (session.status === "PAID" || session.status === "CLOSED") {
      return res.status(400).json({ success: false, message: "Session already settled." });
    }

    // BILL_REQUESTED → PAYMENT_PENDING (customer selected payment)
    if (session.status !== "PAYMENT_PENDING") {
      session.status = "PAYMENT_PENDING";
      session.paymentRequestedAt = new Date();
      session.timeline.push({ event: "PAYMENT_PENDING", note: "Payment selected by QR customer", actorType: "QR" });
      await session.save();
    }

    const payable = session.bills?.totalWithTax || 0;
    res.status(200).json({
      success: true,
      data: {
        sessionId: session._id,
        sessionCode: session.sessionCode,
        status: session.status,
        amount: payable,
        currency: "INR",
        paymentStatus: session.payment?.status || "PENDING",
      },
    });
  } catch (error) { next(error); }
});

// Legacy single-shot QR order — tenant-scoped + server-priced + idempotent
router.route("/order/:token").post(resolveTableScope, async (req, res, next) => {
  try {
    const { table, restaurantId, outletId } = req.scope;
    const { items, customerName, phone, guests, requestId } = req.body;
    if (!items || !items.length) return res.status(400).json({ success: false, message: "items required!" });

    if (requestId) {
      const dup = await Order.findOne({ restaurantId, table: table._id, requestId, isDeleted: { $ne: true } });
      if (dup) return res.status(200).json({ success: true, data: dup, deduplicated: true });
    }

    const validatedItems = await enrichItems({ items, restaurantId, outletId, addedBy: "QR" });
    const bills = priceService.calculateBill({ items: validatedItems.map((i) => ({ price: i.price, quantity: i.quantity })) });
    // See the note on the other QR order-creation path above.
    const readyDueAt = await computeReadyDueAt({ restaurantId, orderType: "dine-in" });
    const order = await Order.create({
      requestId: requestId || "",
      customerDetails: { name: customerName || "Guest", phone: phone || "", guests: guests || 1 },
      orderType: "dine-in", orderStatus: PREPARING, bills, readyDueAt,
      items: validatedItems.map((it) => ({ menuItemId: it.menuItemId, name: it.name, quantity: it.quantity, price: it.price, total: it.total, modifiers: it.modifiers || [], note: it.note || "", status: "pending" })),
      table: table._id, restaurantId, outletId, orderDate: new Date(), createdBy: null,
    });
    await Table.findOneAndUpdate({ _id: table._id }, { status: "occupied" });
    res.status(201).json({ success: true, data: order });
  } catch (error) { next(error); }
});

// Public: call waiter
router.route("/waiter-call/:token").post(resolveTableScope, async (req, res, next) => {
  try {
    await Table.findOneAndUpdate({ _id: req.scope.table._id }, { waiterCallActive: true, waiterCallRequestedAt: new Date() }, { new: true });
    res.status(200).json({ success: true, message: "Waiter called!" });
  } catch (error) { next(error); }
});

// Public: request payment (session-aware)
router.route("/pay-request/:token").post(resolveTableScope, async (req, res, next) => {
  try {
    const { table, restaurantId } = req.scope;
    const session = await findActiveSessionByTable({ tableId: table._id, restaurantId });
    const order = session ? await Order.findById(session.items[0]?.orderId) : await Order.findById(table.currentOrderId);
    if (!order && !session) return res.status(404).json({ success: false, message: "No active order for this table!" });
    res.status(200).json({ success: true, data: { session, order, message: "Payment request sent!" } });
  } catch (error) { next(error); }
});

// Dismiss waiter call
router.route("/waiter-call/:tableId/dismiss").post(isVerifiedUser, async (req, res, next) => {
  try {
    const table = await Table.findOneAndUpdate({ _id: req.params.tableId, restaurantId: req.user.restaurantId }, { waiterCallActive: false }, { new: true });
    if (!table) return res.status(404).json({ success: false, message: "Table not found!" });
    res.status(200).json({ success: true, data: table });
  } catch (error) { next(error); }
});

module.exports = router;