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
const { PREPARING, SETTLED_STATUSES, CANCELLED_STATUSES, canonicalStatus } = require("../constants/orderStatus");
// Lazy for the same reason as getSocket above: autoReadyService pulls in the
// Order/WebsiteSettings models, and requiring them at module load breaks the
// tests that mock mongoose before the models are loaded.
const computeReadyDueAt = (args) => require("../services/autoReadyService").computeReadyDueAt(args);
const computeCompleteDueAt = (args) => require("../services/autoReadyService").computeCompleteDueAt(args);
const { AUDIENCES, ORDER_TYPES, projectMenus, allowsOrderType, POS_VISIBLE_QUERY } = require("../services/menuCache");
const { resolveGateway, isOnlinePaymentEnabled } = require("../services/paymentGateway");
const config = require("../config/config");
const { rateLimit, clientIp } = require("../middlewares/rateLimiter");
const router = express.Router();

/**
 * Rate limits for the PUBLIC half of this router.
 *
 * Every endpoint below that takes a `:token` is unauthenticated. The token is
 * a table's QR, which anyone who has eaten at that table — or photographed the
 * card stuck to it — keeps indefinitely. None of them were throttled, so a
 * single person could place unlimited orders onto a live table's bill, or hold
 * the waiter alarm on permanently.
 *
 * Reads are keyed per IP and generous: a diner's phone polls the session while
 * they sit there, and throttling that would break the page for a paying
 * customer. Writes are keyed per TABLE as well as per IP, so one table cannot
 * exhaust another's allowance, and switching networks does not reset the count
 * for the table being abused.
 */
const qrReadLimiter = rateLimit({
  windowMs: config.qrReadRateWindowMs,
  max: config.qrReadRateMax,
});

const qrWriteLimiter = rateLimit({
  windowMs: config.qrOrderRateWindowMs,
  max: config.qrOrderRateMax,
  keyGenerator: (req) => `qr:${req.params.token}:${clientIp(req)}`,
  message: "Too many requests for this table. Please wait a moment, or ask a member of staff.",
});

// The waiter call rings until somebody walks over and clears it, so this is
// the tightest limit in the app — and keyed on the TABLE alone, because the
// harm is to the staff, not to the caller.
const qrWaiterLimiter = rateLimit({
  windowMs: config.qrWaiterCallRateWindowMs,
  max: config.qrWaiterCallRateMax,
  keyGenerator: (req) => `qr-waiter:${req.params.token}`,
  message: "Your table has already called for a waiter. Someone is on their way.",
});

/**
 * The in-restaurant menu a diner sees after scanning their table QR.
 *
 * Served from the System Published snapshot — the same catalogue the till
 * shows and the same one enrichItems bills from, so what is displayed and
 * what is charged cannot drift apart. Returning the raw documents (as this
 * used to) also handed every anonymous scanner the live draft plus both
 * snapshots; projecting strips all of that.
 */
const scopedMenu = async (restaurantId, outletId) => {
  const docs = await Menu.find({
    restaurantId,
    outletId: { $in: [outletId, null] },
    isDeleted: false,
    // The same rule the tills use, from the same place. This clause used to be
    // written out by hand here and did not quite agree with it: `published:
    // true` instead of `!== false`, plus an `isPublished: true` alternative
    // that could re-admit a category whose Display Status was off. A table QR
    // is served from the system snapshot, so it follows POS visibility.
    ...POS_VISIBLE_QUERY,
  });
  return projectMenus(docs, AUDIENCES.SYSTEM)
    // A table QR is unambiguously a TABLE order, so a category restricted to
    // collection and/or delivery has no business appearing on it.
    .filter((m) => allowsOrderType(m, ORDER_TYPES.TABLE))
    .map((m) => {
    delete m.systemSnapshot;
    delete m.websiteSnapshot;
    return m;
  });
};

// Public session sanitizer — strips internal fields before returning to the
// customer browser. Never exposes restaurantId/outletId-driven internals
// beyond what the customer page needs.
const sanitizeSession = (session, extra = {}) => {
  if (!session) return null;
  const plain = session.toObject ? session.toObject() : { ...session };
  return {
    _id: plain._id,
    sessionCode: plain.sessionCode,
    status: plain.status,
    // The kitchen's own status for this table, so the diner sees Preparing →
    // Ready on their phone instead of a page that says "pending" forever.
    // Resolved by the caller because it lives on the Order, not the session.
    orderStatus: extra.orderStatus ?? null,
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
      // A dish the kitchen pulled (out of stock, say) must be visible as
      // cancelled on the diner's own screen, with the reason they were given.
      cancelledAt: it.cancelledAt || null,
      cancelReason: it.cancelReason || "",
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

/**
 * The kitchen status the diner should see for their table.
 *
 * The session carries a per-item status, but nothing ever advanced it past
 * "pending" — the auto-ready sweep and the POS both write to the ORDER. So a
 * table the till had already marked Ready still read "pending" on the phone.
 * Read it from the order that actually owns the status.
 */
const kitchenStatusForSession = async (session) => {
  if (!session?._id) return null;
  try {
    const order = await Order.findOne({
      tableSessionId: session._id,
      isDeleted: { $ne: true },
      orderStatus: { $nin: CANCELLED_STATUSES },
    })
      .sort({ createdAt: -1 })
      .select("orderStatus")
      .lean();
    return order ? canonicalStatus(order.orderStatus) : null;
  } catch {
    // A status the diner cannot see is a cosmetic loss; failing their whole
    // page over it is not. Fall back to "no status yet".
    return null;
  }
};

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
router.route("/table/:token").get(qrReadLimiter, resolveTableScope, async (req, res, next) => {
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
        table: {
          _id: table._id,
          tableNumber: table.tableNumber,
          // The name the restaurant actually gave this table ("GF1"). The
          // diner's page only ever had the number, so it could only say
          // "Table 1" while the staff called it something else.
          displayId: table.displayId || "",
          tableName: table.tableName || "",
          capacity: table.capacity,
          // "cleaning" means the previous party has paid and staff are
          // clearing the table. Exposed so the page can say so rather than
          // silently refusing the first order.
          status: table.status,
          restaurantId,
          outletId,
        },
        restaurant: restaurant
          ? {
              _id: restaurant._id,
              name: restaurant.name,
              currency: restaurant.currency || "INR",
              branding: restaurant.branding || {},
              address: restaurant.address || {},
              // Whether this store can take money online at all. The diner
              // must not be offered "Pay online" against a store with no
              // gateway -- the button would simply fail. Only the boolean is
              // exposed; keys never leave the server.
              //
              // This used to read `restaurant.razorpay.isConfigured`. There is
              // no `razorpay` field on the Restaurant model, so it was always
              // false and no store could ever take a QR payment. The gateway
              // lives on WebsiteSettings (or the platform env keys) --
              // services/paymentGateway is the one place that knows.
              onlinePaymentEnabled: await isOnlinePaymentEnabled({ restaurantId }),
            }
          : null,
        menu,
        activeSession: sanitizeSession(activeSession, {
          orderStatus: await kitchenStatusForSession(activeSession),
        }),
      },
    });
  } catch (error) { next(error); }
});

// Public: full active session detail for a table (re-scan / "continue ordering").
// Token-scoped: the session is always resolved from the QR's tableId —
// a customer can never request another table's session.
router.route("/session/:token").get(qrReadLimiter, resolveTableScope, async (req, res, next) => {
  try {
    const { table, restaurantId } = req.scope;
    const activeSession = await getActiveSessionForTable({ tableId: table._id, restaurantId });
    if (!activeSession) {
      return res.status(404).json({ success: false, message: "No active session for this table." });
    }
    res.status(200).json({
      success: true,
      data: {
        session: sanitizeSession(activeSession, {
          orderStatus: await kitchenStatusForSession(activeSession),
        }),
      },
    });
  } catch (error) { next(error); }
});

// Public: customers add items to an existing session (or auto-create one).
// Token-scoped: the table is resolved from the QR token — a client-supplied
// tableId in the URL/body is NEVER trusted.
// Transactional + E11000 retry prevents concurrent duplicate session creation,
// so repeated scans during an active session reuse the SAME session.
router.route("/session/items/:token").post(qrWriteLimiter, resolveTableScope, async (req, res, next) => {
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
          // The party that was here has paid and the table has not been
          // cleared yet. Their browser still holds the QR page, so without
          // this the same link would happily open a SECOND session on a
          // table that is mid-reset — a paid order followed by a fresh one
          // nobody at the till expected. The QR itself is unchanged; it
          // simply has nothing to join until staff have turned the table.
          if (tableInTxn.status === "cleaning") {
            throw createHttpError(
              409,
              "This table has just been settled and is being prepared. Please ask a member of staff, or scan again in a moment.",
            );
          }

          // OPENING the table: this is the diner's first scan, and the only
          // moment their details are asked for. Enforced here rather than
          // trusted from the browser, and ONLY on creation -- a later scan
          // joins the open session and must never be asked again.
          const name = String(customerName || "").trim();
          const phone = String(customerPhone || "").replace(/\D/g, "").slice(-10);
          if (!name) throw createHttpError(400, "Please enter your name to start the table.");
          if (!/^\d{10}$/.test(phone)) {
            throw createHttpError(400, "Please enter a valid 10-digit phone number to start the table.");
          }

          session = await TableSession.create(
            [
              {
                sessionCode: generateSessionCode(),
                restaurantId, outletId, tableId: tableInTxn._id, status: "OCCUPIED", source: "QR",
                // Guests is no longer collected from the diner. Absent, this
                // resolves to 1; the till can still set a real count.
                customerCount: validateCapacity(tableInTxn, customerCount),
                customerName: name, customerPhone: phone,
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
        // ...and the same for Auto-Complete. This was missing, so the "table"
        // auto-complete duration an operator configured had no effect at all:
        // with completeDueAt left null the sweep's `completeDueAt: { $ne: null }`
        // filter never matched a table order. Collection and delivery orders
        // got their clock from orderController; table orders got none.
        const completeDueAt = await computeCompleteDueAt({ restaurantId, orderType: "dine-in" });

        // A table that is already mid-meal has an open kitchen order. Extra
        // items belong ON that order, not on a second one: the spec is
        // explicit that additions must never create a new order, and a
        // second order would also split the table across two kitchen
        // tickets and two POS cards for one bill.
        //
        // The additions land as item.status "pending" so the till can accept
        // or reject them; accepted items become "preparing" and only then
        // reach the kitchen.
        const openOrder = await Order.findOne({
          tableSessionId: session._id,
          isDeleted: { $ne: true },
          orderStatus: { $nin: [...SETTLED_STATUSES, ...CANCELLED_STATUSES] },
        }).sort({ createdAt: -1 }).session(mongoSession);

        const asOrderItems = (list, status) =>
          list.map((it) => ({
            menuItemId: it.menuItemId, name: it.name, quantity: it.quantity,
            price: it.price, total: it.total, modifiers: it.modifiers || [],
            note: it.note || "", status,
          }));

        let kitchenOrderDoc;
        let appendedToExisting = false;

        if (openOrder) {
          // Append to the order this table already has.
          openOrder.items.push(...asOrderItems(validatedItems, "pending"));
          openOrder.bills = session.bills;
          await openOrder.save({ session: mongoSession });
          kitchenOrderDoc = openOrder;
          appendedToExisting = true;
        } else {
        const kitchenOrder = await Order.create(
          [
            {
              requestId: requestId || "",
              customerDetails: { name: session.customerName || "Guest", phone: session.customerPhone || "", guests: session.customerCount || 1 },
              orderType: "dine-in", orderStatus: PREPARING, bills: session.bills, readyDueAt,
              ...(completeDueAt ? { completeDueAt } : {}),
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
          kitchenOrderDoc = kitchenOrder[0];
        }

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

        return { session, kitchenOrder: kitchenOrderDoc, created, appendedToExisting, addedCount: validatedItems.length };
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
      const order = populatedOrder || result.kitchenOrder;

      if (result.appendedToExisting) {
        // Additions to a table that is already mid-meal are a DIFFERENT event
        // from a brand new order: the till has already accepted this table, so
        // it needs to review just what was added rather than the whole ticket.
        getSocket().emitToRestaurant(result.session.restaurantId, "tableOrder:itemsAdded", {
          orderId: String(order._id),
          tableSessionId: String(result.session._id),
          tableNumber: order.table?.tableNumber ?? null,
          displayId: order.table?.displayId || order.table?.tableName || "",
          addedCount: result.addedCount,
          pendingItems: (order.items || [])
            .filter((i) => i.status === "pending")
            .map((i) => ({ name: i.name, quantity: i.quantity, total: i.total })),
          bills: order.bills,
        });
      } else {
        getSocket().emitOrderCreated({
          restaurantId: result.session.restaurantId,
          outletId: result.session.outletId,
          order,
        });
      }
    } catch (socketErr) {
      console.warn("[qrRoute] socket emit failed:", socketErr.message);
    }

    res.status(201).json({
      success: true,
      data: {
        session: sanitizeSession(result.session, {
          orderStatus: canonicalStatus(result.kitchenOrder?.orderStatus),
        }),
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
router.route("/request-bill/:token").post(qrWriteLimiter, resolveTableScope, async (req, res, next) => {
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
    res.status(200).json({
      success: true,
      data: sanitizeSession(session, { orderStatus: await kitchenStatusForSession(session) }),
    });
  } catch (error) { next(error); }
});

// Public: customer selects payment (prepare payment UI + amount).
// Transitions BILL_REQUESTED → PAYMENT_PENDING. Full payment capture is
// handled separately by the POS — this only moves the bill to payment-pending
// and returns what the customer page needs to render the payment section.
router.route("/payment-intent/:token").post(qrWriteLimiter, resolveTableScope, async (req, res, next) => {
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

    // Open a real gateway order so the diner can be handed straight to
    // checkout. The amount comes from the session's own bill -- never from
    // the request -- so a tampered browser cannot pay less than it owes.
    let checkout = null;
    const gw = await resolveGateway({ restaurantId });
    if (gw.enabled && payable > 0) {
      try {
        const Razorpay = require("razorpay");
        const client = new Razorpay({ key_id: gw.keyId, key_secret: gw.secret });
        const gatewayOrder = await client.orders.create({
          amount: Math.round(payable * 100), // paisa
          currency: "INR",
          receipt: `tbl_${session.sessionCode}`.slice(0, 40),
          notes: { tableSessionId: String(session._id) },
        });
        checkout = {
          gateway: gw.gateway,
          gatewayOrderId: gatewayOrder.id,
          // The PUBLIC key id. Razorpay Checkout needs it in the browser;
          // the secret never leaves this process.
          keyId: gw.keyId,
          amount: payable,
          currency: "INR",
        };
      } catch (gwErr) {
        // A gateway that will not open an order is not a reason to fail the
        // whole request -- the diner still needs to see their bill and be
        // able to call a member of staff.
        console.warn("[qrRoute] gateway order failed:", gwErr?.message || gwErr);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        sessionId: session._id,
        sessionCode: session.sessionCode,
        status: session.status,
        amount: payable,
        currency: "INR",
        paymentStatus: session.payment?.status || "PENDING",
        onlinePaymentEnabled: Boolean(checkout),
        checkout,
      },
    });
  } catch (error) { next(error); }
});

// Public: the diner's browser reports back from the gateway.
//
// NOTHING here trusts the browser about whether money moved. The signature is
// re-computed from the gateway order id + payment id with the store's own
// secret; only a signature we can reproduce settles the table. On success the
// session goes through exactly the same settle path the till uses, so the
// table closes, the orders are marked paid and the cooldown starts.
router.route("/payment-verify/:token").post(qrWriteLimiter, resolveTableScope, async (req, res, next) => {
  try {
    const { table, restaurantId } = req.scope;
    const orderId = String(req.body?.razorpay_order_id || "");
    const paymentId = String(req.body?.razorpay_payment_id || "");
    const signature = String(req.body?.razorpay_signature || "");
    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({ success: false, message: "Incomplete payment confirmation." });
    }

    const session = await getActiveSessionForTable({ tableId: table._id, restaurantId });
    if (!session) return res.status(404).json({ success: false, message: "No active session for this table!" });

    const gw = await resolveGateway({ restaurantId });
    if (!gw.enabled) {
      return res.status(400).json({ success: false, message: "Online payment is not available for this store." });
    }

    const crypto = require("crypto");
    const expected = crypto
      .createHmac("sha256", gw.secret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(400).json({ success: false, message: "Payment could not be verified." });
    }

    const payable = session.bills?.totalWithTax || 0;
    const { settleSessionFromGateway } = require("../controllers/tableSessionController");
    await settleSessionFromGateway({
      sessionId: session._id,
      restaurantId,
      method: "ONLINE",
      amount: payable,
      transactionId: paymentId,
      // A double-submit from a flaky phone must not settle twice.
      idempotencyKey: `qr-online-${paymentId}`,
    });

    const settled = await TableSession.findById(session._id);
    res.status(200).json({
      success: true,
      message: "Payment received. Thank you!",
      data: sanitizeSession(settled, { orderStatus: await kitchenStatusForSession(settled) }),
    });
  } catch (error) { next(error); }
});

// Legacy single-shot QR order — tenant-scoped + server-priced + idempotent
router.route("/order/:token").post(qrWriteLimiter, resolveTableScope, async (req, res, next) => {
  try {
    const { table, restaurantId, outletId } = req.scope;
    const { items, customerName, phone, guests, requestId } = req.body;
    if (!items || !items.length) return res.status(400).json({ success: false, message: "items required!" });

    if (requestId) {
      const dup = await Order.findOne({ restaurantId, table: table._id, requestId, isDeleted: { $ne: true } });
      if (dup) return res.status(200).json({ success: true, data: dup, deduplicated: true });
    }

    const validatedItems = await enrichItems({ items, restaurantId, outletId, addedBy: "QR" });
    // GST only where the store is registered and has a rate configured.
    const qrGst = await require("../services/gst").resolveGstForRestaurant(restaurantId, "system");
    const bills = priceService.calculateBill({
      items: validatedItems.map((i) => ({ price: i.price, quantity: i.quantity })),
      taxRate: qrGst.rate,
    });
    // See the note on the other QR order-creation path above.
    const readyDueAt = await computeReadyDueAt({ restaurantId, orderType: "dine-in" });
    const completeDueAt = await computeCompleteDueAt({ restaurantId, orderType: "dine-in" });
    const order = await Order.create({
      requestId: requestId || "",
      customerDetails: { name: customerName || "Guest", phone: phone || "", guests: guests || 1 },
      orderType: "dine-in", orderStatus: PREPARING, bills, readyDueAt,
      ...(completeDueAt ? { completeDueAt } : {}),
      items: validatedItems.map((it) => ({ menuItemId: it.menuItemId, name: it.name, quantity: it.quantity, price: it.price, total: it.total, modifiers: it.modifiers || [], note: it.note || "", status: "pending" })),
      table: table._id, restaurantId, outletId, orderDate: new Date(), createdBy: null,
    });
    await Table.findOneAndUpdate({ _id: table._id }, { status: "occupied" });
    res.status(201).json({ success: true, data: order });
  } catch (error) { next(error); }
});

// Public: call waiter.
//
// This used to set a flag on the Table and stop there — nothing was pushed to
// the POS, so the only way a cashier learned a table wanted service was to
// happen to reload the Tables screen. It now emits on the restaurant's socket
// room so the till can raise an alert the moment the customer taps.
router.route("/waiter-call/:token").post(qrWaiterLimiter, resolveTableScope, async (req, res, next) => {
  try {
    const { table, restaurantId, outletId } = req.scope;
    const requestedAt = new Date();
    await Table.findOneAndUpdate(
      { _id: table._id },
      { waiterCallActive: true, waiterCallRequestedAt: requestedAt },
      { new: true },
    );

    try {
      getSocket().emitToRestaurant(restaurantId, "waiter:called", {
        tableId: String(table._id),
        tableNumber: table.tableNumber,
        displayId: table.displayId || table.tableName || "",
        area: table.area || table.floor || "",
        restaurantId: String(restaurantId),
        outletId: outletId ? String(outletId) : null,
        requestedAt,
      });
    } catch (socketErr) {
      // A dropped notification must never fail the customer's request.
      console.warn("[qrRoute] waiter:called emit failed:", socketErr.message);
    }

    res.status(200).json({ success: true, message: "Waiter called!" });
  } catch (error) { next(error); }
});

// Public: request payment (session-aware)
router.route("/pay-request/:token").post(qrWriteLimiter, resolveTableScope, async (req, res, next) => {
  try {
    const { table, restaurantId } = req.scope;
    const session = await findActiveSessionByTable({ tableId: table._id, restaurantId });
    const order = session ? await Order.findById(session.items[0]?.orderId) : await Order.findById(table.currentOrderId);
    if (!order && !session) return res.status(404).json({ success: false, message: "No active order for this table!" });
    res.status(200).json({ success: true, data: { session, order, message: "Payment request sent!" } });
  } catch (error) { next(error); }
});

// Acknowledge a waiter call. Emits so every till silences its alert, not just
// the one that happened to press the button.
router.route("/waiter-call/:tableId/dismiss").post(isVerifiedUser, async (req, res, next) => {
  try {
    const table = await Table.findOneAndUpdate({ _id: req.params.tableId, restaurantId: req.user.restaurantId }, { waiterCallActive: false }, { new: true });
    if (!table) return res.status(404).json({ success: false, message: "Table not found!" });

    try {
      getSocket().emitToRestaurant(req.user.restaurantId, "waiter:cleared", {
        tableId: String(table._id),
        acknowledgedBy: req.user?.name || "",
      });
    } catch (socketErr) {
      console.warn("[qrRoute] waiter:cleared emit failed:", socketErr.message);
    }

    res.status(200).json({ success: true, data: table });
  } catch (error) { next(error); }
});

module.exports = router;