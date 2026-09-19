const mongoose = require("mongoose");
const { logActivity } = require("../services/auditService");
const { buildCooldownUpdate } = require("../services/tableCooldownService");
const { userScope } = require("../services/tenantContext");
const { round2 } = require("../services/money");
const { resolveGstForRestaurant } = require("../services/gst");
const Table = require("../models/tableModel");
const TableSession = require("../models/tableSessionModel");
const Order = require("../models/orderModel");
const PaymentTransaction = require("../models/paymentTransactionModel");
const Bill = require("../models/billModel");
const priceService = require("../services/price");
const {
  emitOrderCreated,
  emitOrderStatusChanged,
  emitTableSessionUpdated,
} = require("../services/socket");

const createHttpError = require("http-errors");
const {
  PREPARING,
  PAID,
  CANCELLED,
  canonicalStatus,
  SETTLED_STATUSES,
  CANCELLED_STATUSES,
  READY_STATUSES,
  isFinished,
} = require("../constants/orderStatus");
const { computeReadyDueAt, computeCompleteDueAt } = require("../services/autoReadyService");
const { fireAutoEBill } = require("../services/eBillService");

const crypto = require("crypto");
const { findActiveBlock, blockedError } = require("./tableBookingController");

const SESSION_CODE_PREFIX = "TS";

/**
 * Put a round of items on the table's open kitchen order, or start one.
 *
 * A table has ONE order while it is being served. Every POS path used to
 * create a fresh Order per round, so a table ordered from the QR and topped
 * up at the till showed as two orders on the Orders page, two kitchen
 * tickets and two cards for one bill. The QR route already appended; this is
 * the same rule for the till.
 *
 * Links each new session item to its kitchen line by counting back from the
 * END of the order, which is right for an appended round as well as a new
 * order.
 */
const addRoundToKitchenOrder = async ({ session, validatedItems, tableId, createdBy, mongoSession }) => {
  const lines = validatedItems.map((it) => ({
    menuItemId: it.menuItemId,
    name: it.name,
    quantity: it.quantity,
    price: it.price,
    total: it.total,
    modifiers: it.modifiers || [],
    note: it.note || "",
    status: "pending",
  }));

  let order = await Order.findOne(
    {
      tableSessionId: session._id,
      isDeleted: { $ne: true },
      orderStatus: { $nin: [...SETTLED_STATUSES, ...CANCELLED_STATUSES] },
    },
    null,
    { sort: { createdAt: -1 }, session: mongoSession },
  );
  const appended = Boolean(order);

  if (order) {
    order.items.push(...lines);
    order.bills = session.bills;
    // New dishes mean the table is being cooked for again.
    if (READY_STATUSES.includes(order.orderStatus)) {
      order.orderStatus = PREPARING;
      order.readyDueAt = await computeReadyDueAt({ restaurantId: session.restaurantId, orderType: "dine-in" });
    }
    await order.save({ session: mongoSession });
  } else {
    [order] = await Order.create(
      [
        {
          customerDetails: {
            name: session.customerName || "Guest",
            phone: session.customerPhone || "",
            guests: session.customerCount || 1,
          },
          orderType: "dine-in",
          orderStatus: PREPARING,
          // Table orders are auto-ready and auto-complete eligible; without
          // these dates the sweeps skip them and they sit in Preparing forever.
          readyDueAt: await computeReadyDueAt({ restaurantId: session.restaurantId, orderType: "dine-in" }),
          completeDueAt: await computeCompleteDueAt({ restaurantId: session.restaurantId, orderType: "dine-in" }),
          bills: session.bills,
          items: lines,
          table: tableId,
          tableSessionId: session._id,
          restaurantId: session.restaurantId,
          outletId: session.outletId,
          createdBy: createdBy || null,
          // The order belongs to whoever opened the table, not whoever added
          // this round: Reports count a QR-opened table as a Table QR order.
          source: session.source === "QR" ? "QR" : "POS",
        },
      ],
      { session: mongoSession },
    );
  }

  const startIdx = session.items.length - validatedItems.length;
  const kitchenStartIdx = order.items.length - validatedItems.length;
  validatedItems.forEach((it, idx) => {
    const sessionItem = session.items[startIdx + idx];
    if (sessionItem) {
      sessionItem.orderId = order._id;
      sessionItem.kdsItemId = order.items[kitchenStartIdx + idx]?._id;
    }
  });

  return { order, appended };
};

/** A new order pops up on the tills; an appended round only refreshes them. */
const announceKitchenOrder = ({ session, order, appended, items, table }) => {
  try {
    const emit = appended ? emitOrderStatusChanged : emitOrderCreated;
    emit({ restaurantId: session.restaurantId, outletId: session.outletId, order });
    // A round added mid-meal: the kitchen printer needs the new lines.
    if (appended && items?.length) {
      require("../services/socket").emitKitchenRound({
        restaurantId: session.restaurantId,
        outletId: session.outletId,
        order,
        items,
        table,
      });
    }
  } catch (socketErr) {
    console.warn("[tableSession] socket emit failed:", socketErr.message);
  }
};

/**
 * Mint the diner's claim on a session.
 *
 * Separate from the sessionCode on purpose: the code is printed on the bill
 * as `BL_<sessionCode>`, so it is public the moment a receipt is handed over.
 * This one only ever reaches the browser that is ordering at the table.
 */
const generateSessionAccessToken = () => crypto.randomBytes(24).toString("hex");

const generateSessionCode = () =>
  `${SESSION_CODE_PREFIX}_${Date.now().toString(36).toUpperCase()}_${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;

/**
 * Execute a transactional work function with automatic retry on
 * duplicate-key (E11000) errors caused by concurrent active-session
 * creation for the same table.
 *
 * Only one active session may exist per table (enforced by a partial
 * unique index on TableSession.tableId). When two requests try to open
 * the same table at the same time, one will win and the loser receives
 * E11000. We abort and retry so the loser can re-find and reuse the
 * winning session — never creating a duplicate.
 */
const runWithSessionRetry = async (work, { retries = 3 } = {}) => {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    let mongoSession = null;
    try {
      mongoSession = await mongoose.startSession();
      mongoSession.startTransaction();
    } catch (sessionErr) {
      // Standalone MongoDB instances (like default local `mongod`) do not
      // support transactions ("Transaction numbers are only allowed on a
      // replica set member or mongos"). Fall back gracefully to running
      // non-transactionally so local development works without replica set.
      if (
        sessionErr?.message?.includes("replica set member") ||
        sessionErr?.code === 20
      ) {
        const result = await work(null);
        return { result, mongoSession: null };
      }
      throw sessionErr;
    }

    try {
      const result = await work(mongoSession);
      await mongoSession.commitTransaction();
      return { result, mongoSession };
    } catch (error) {
      // If startTransaction succeeded but commit failed because transactions
      // aren't supported on this deployment, fall back to no-session work.
      if (
        error?.message?.includes("replica set member") ||
        error?.code === 20
      ) {
        try {
          await mongoSession.abortTransaction();
        } catch (_) {}
        mongoSession.endSession();
        const result = await work(null);
        return { result, mongoSession: null };
      }

      try {
        await mongoSession.abortTransaction();
      } catch (abortError) {
        // Transaction may already be aborted by Mongo — ignore
      }
      lastError = error;
      if (attempt === retries || error.code !== 11000) break;
    } finally {
      if (mongoSession) mongoSession.endSession();
    }
  }
  throw lastError;
};

const addTimeline = (session, event, note, actorType = "SYSTEM", actorId = null) => {
  session.timeline.push({ event, note, actorType, actorId, at: new Date() });
};

// ============================================================
// State-machine helpers for the table billing lifecycle
//
//   OPEN
//    ↓
//   OCCUPIED
//    ↓
//   PROCESSING
//    ↓
//   BILL_REQUESTED
//    ↓
//   PAYMENT_PENDING
//    ↓
//   PAID
//    ↓
//   CLOSED
//
// Invalid transitions (must be rejected):
//   CLOSED → add item
//   PAID   → add item
//   CLOSED → pay again
//   PAID   → pay again
// ============================================================
const ACTIVE_SESSION_STATUSES = ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"];
const SETTLED_SESSION_STATUSES = ["PAID", "CLOSED"];

const assertNotSettled = (session) => {
  if (SETTLED_SESSION_STATUSES.includes(session.status)) {
    throw createHttpError(
      400,
      `This table session is already settled (${session.status}) — no further changes are allowed.`
    );
  }
};

const assertCanTransition = (session, allowedFrom, to) => {
  assertNotSettled(session);
  if (!allowedFrom.includes(session.status)) {
    throw createHttpError(
      400,
      `Invalid state transition: cannot move session from "${session.status}" to "${to}".`
    );
  }
};

// Adding items is only valid while the session is still active/orderable.
const assertActiveForItems = (session) => assertNotSettled(session);

const recalculateSessionBill = async (session) => {
  // A table order is on the "system" channel. GST is charged only if this
  // store has a GST number and a rate; otherwise the rate is zero.
  const gst = await resolveGstForRestaurant(session.restaurantId, "system");

  // Dine-in service charge: a percentage of the bill after discount and tax,
  // from Settings > Rules & Charges (read with the GST settings). Zero unless
  // set, and zero once the guest has asked for it to be taken off.
  const serviceChargeWaived = session.bills?.serviceChargeWaived === true;
  const pct = serviceChargeWaived ? 0 : Math.max(0, Math.min(25, Number(gst.serviceChargePercent) || 0));
  const live = session.items.filter((i) => i.status !== "cancelled").map((i) => ({ price: i.price, quantity: i.quantity }));

  const bills = priceService.calculateBill({
    items: live,
    discount: session.bills?.discount || 0,
    serviceChargePercent: pct,
    taxRate: gst.rate,
    taxInclusive: gst.inclusive,
  });
  const tip = Number(session.bills?.tip) || 0;
  session.bills = { ...bills, serviceChargePercent: pct, serviceChargeWaived, tip };
  await session.save();
  return session;
};

const getScopeQuery = (req) => userScope(req.user);

/**
 * Validate capacity for a table.
 * A table with capacity N admits at most N customers (1..N).
 * Always rejects counts > N regardless of the source.
 */
const validateCapacity = (table, customerCount) => {
  const capacity = Number(table.capacity) || 4;
  let count = Number(customerCount);
  if (isNaN(count) || count < 1) count = 1;
  if (count > capacity) {
    throw createHttpError(
      400,
      `Table ${table.tableNumber} has a maximum capacity of ${capacity} customers.`
    );
  }
  return count;
};

/**
 * Shared item enrichment — server-side price resolution.
 * Never trusts browser prices.
 */
/**
 * Is this payment settled the moment the operator picks the method?
 *
 * Methods taken in person are: the staff member has the cash in hand, or has
 * watched the UPI or card payment succeed on their own device. Choosing one
 * IS the confirmation -- the POS has no terminal integration to ask.
 *
 * Rails that settle asynchronously somewhere else (ONLINE, PAYMENT_LINK) wait
 * for an explicit success, because at the moment of choosing them no money
 * has moved.
 *
 * UPI and CARD used to be missing, so choosing either recorded the payment as
 * FAILED and left the session PAYMENT_PENDING -- which meant the table never
 * closed and never freed itself.
 */
const COUNTER_SETTLED_METHODS = ["CASH", "UPI", "CARD", "QR_CODE"];

const { displayPaymentMethod } = require("../constants/paymentMethods");

const isPaidOnSelection = ({ method, paymentStatus } = {}) =>
  paymentStatus === "success" ||
  COUNTER_SETTLED_METHODS.includes(String(method || "").toUpperCase());

const enrichItems = async ({ items, restaurantId, outletId, addedBy = "SYSTEM" }) => {
  if (!items || !items.length) throw createHttpError(400, "At least one item is required!");

  const validatedItems = [];
  for (const rawItem of items) {
    if (!rawItem.menuItemId) throw createHttpError(400, "Each item must have menuItemId!");
    if (!rawItem.quantity || rawItem.quantity < 1) throw createHttpError(400, "Quantity must be at least 1!");

    const { item } = await priceService.resolveMenuItem({
      menuItemId: rawItem.menuItemId,
      restaurantId,
      outletId,
    });

    const { unitPrice, variant, addons, modifiers } = priceService.calculateUnitPrice({
      item,
      variantId: rawItem.variantId,
      addonIds: rawItem.addonIds || [],
      modifierSelections: rawItem.modifierSelections || {},
    });

    // Components -- the variant, the add-ons and the modifier options -- were
    // all priced into `unitPrice` and then thrown away: only `modifiers` was
    // stored. The diner was charged for "Extra cheese" and for a "Large" and
    // saw neither on the cart, the receipt or the bill, which reads as the
    // total being wrong.
    //
    // Add-ons are additive, exactly like modifier options, so they join the
    // same list -- one shape, and every surface that already renders
    // `modifiers` picks them up for free.
    //
    // The variant is NOT additive: its price REPLACES the base rather than
    // adding to it, so putting it in this list would corrupt anything that
    // derives a base price by subtracting the modifiers (OrderPanel does
    // exactly that). It belongs in the name, which is how a variant reads on
    // a receipt anyway.
    const components = [...(addons || []), ...(modifiers || [])];

    validatedItems.push({
      menuItemId: item._id,
      name: variant?.name ? `${item.name} (${variant.name})` : item.name,
      quantity: Number(rawItem.quantity),
      price: unitPrice,
      total: round2(unitPrice * Number(rawItem.quantity)),
      modifiers: components,
      note: rawItem.note || "",
      addedBy,
      status: "pending",
    });
  }
  return validatedItems;
};

// ============================================================
// POS: Open session (or reuse existing) AND add items
// Wrapped in a single transaction with E11000 retry to prevent
// concurrent duplicate session creation.
// Partial unique index also enforces one-active-session-per-table.
// ============================================================
const addItemsToSession = async (req, res, next) => {
  let result;
  try {
    ({ result } = await runWithSessionRetry(async (mongoSession) => {
      const { tableId, items, customerCount, customerName, customerPhone, idempotencyKey } = req.body;

      if (!tableId) throw createHttpError(400, "Table ID is required!");
      if (!items || !items.length) throw createHttpError(400, "At least one item is required!");

      const scopeQuery = getScopeQuery(req);
      const table = await Table.findOne({
        _id: tableId,
        ...scopeQuery,
        isDeleted: { $ne: true },
      }).session(mongoSession);
      if (!table) throw createHttpError(404, "Table not found!");

      const count = validateCapacity(table, customerCount);

      // Find existing active session
      let session = await TableSession.findOne({
        tableId,
        status: { $in: ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"] },
        isDeleted: { $ne: true },
      }).session(mongoSession);

      if (!session) {
        // A table promised to a booking stops taking new parties from its
        // block start. Seating the booking (Manage Tables) releases it.
        const block = await findActiveBlock(table._id);
        if (block) throw blockedError(block, table);

        // Create new session
        const sessionCode = generateSessionCode();
        const created = await TableSession.create(
          [
            {
              sessionCode,
              accessToken: generateSessionAccessToken(),
              restaurantId: table.restaurantId || req.user?.restaurantId,
              outletId: table.outletId || req.user?.outletId,
              tableId: table._id,
              status: "OCCUPIED",
              customerCount: count,
              customerName: customerName || "",
              customerPhone: customerPhone || "",
              items: [],
              bills: { subtotal: 0, tax: 0, discount: 0, charges: 0, totalWithTax: 0 },
              payment: { method: "", status: "PENDING", transactionId: "", paidAt: null },
              openedAt: new Date(),
              openedBy: req.user?._id,
              timeline: [],
            },
          ],
          { session: mongoSession }
        );
        session = created[0];
        addTimeline(session, "SESSION_OPENED", `Table ${table.tableNumber} opened by POS`, "POS", req.user?._id);

        table.status = "occupied";
        table.currentOccupancy = count;
        await table.save({ session: mongoSession });
      } else {
        // Existing session: capacity re-validate
        validateCapacity(table, count || session.customerCount);
        session.customerCount = count || session.customerCount;
        table.currentOccupancy = session.customerCount;
        await table.save({ session: mongoSession });
        if (customerName) session.customerName = customerName;
        if (customerPhone) session.customerPhone = customerPhone;

        // OPEN → OCCUPIED: placing an order on an open session marks it occupied
        if (session.status === "OPEN") {
          session.status = "OCCUPIED";
          addTimeline(session, "OCCUPIED", "Session occupied by order", "POS", req.user?._id);
        }
      }

      const validatedItems = await enrichItems({
        items,
        restaurantId: session.restaurantId,
        outletId: session.outletId,
        addedBy: "POS",
      });

      session.items.push(...validatedItems);
      if (!session.originalItemsCount) session.originalItemsCount = validatedItems.length;
      addTimeline(session, "ITEMS_ADDED", `${validatedItems.length} item(s) added`, "POS", req.user?._id);

      await recalculateSessionBill(session);

      const { order: kitchenOrder, appended } = await addRoundToKitchenOrder({
        session,
        validatedItems,
        tableId: table._id,
        createdBy: req.user?._id,
        mongoSession,
      });
      const kitchenOrderId = kitchenOrder._id;

      // Keep the table's currentOrder in sync with the session's kitchen order
      table.currentOrderId = kitchenOrderId;
      await table.save({ session: mongoSession });
      await session.save({ session: mongoSession });

      return { session, kitchenOrder, appended, validatedItems, table };
    }));

    announceKitchenOrder({
      session: result.session,
      order: result.kitchenOrder,
      appended: result.appended,
      items: result.validatedItems,
      table: result.table,
    });
  } catch (error) {
    return next(error);
  }

  // Best-effort: logActivity never throws, so a failed audit cannot fail the order.
  await logActivity({
    req,
    action: "TABLE_SESSION.ITEMS_ADDED",
    resource: "TableSession",
    resourceId: result.session._id,
    description: `Added ${result.validatedItems.length} item(s) to ${result.session.sessionCode}`,
  });

  res.status(200).json({
    success: true,
    message: "Items added to table session!",
    data: result.session,
  });
};

// ============================================================
// Add items to an existing session by session id
// ============================================================
const addItemsToExistingSession = async (req, res, next) => {
  let result;
  try {
    ({ result } = await runWithSessionRetry(async (mongoSession) => {
      const { id } = req.params;
      const { items, customerCount } = req.body;
      if (!mongoose.Types.ObjectId.isValid(id)) throw createHttpError(404, "Invalid id!");

      const scopeQuery = getScopeQuery(req);
      const session = await TableSession.findOne({
        _id: id,
        ...scopeQuery,
        isDeleted: { $ne: true },
      }).session(mongoSession);
      if (!session) throw createHttpError(404, "Table session not found!");
      // STATE VALIDATION: reject CLOSED → add item and PAID → add item
      assertActiveForItems(session);

      // OPEN → OCCUPIED: placing an order on an open session marks it occupied
      if (session.status === "OPEN") {
        session.status = "OCCUPIED";
        addTimeline(session, "OCCUPIED", "Session occupied by order", "POS", req.user?._id);
      }

      let table = null;
      if (customerCount) {
        table = await Table.findOne({ _id: session.tableId, ...scopeQuery }).session(mongoSession);
        if (!table) throw createHttpError(404, "Table not found!");
        validateCapacity(table, customerCount);
        session.customerCount = Number(customerCount);
        table.currentOccupancy = session.customerCount;
        await table.save({ session: mongoSession });
      }

      const validatedItems = await enrichItems({
        items,
        restaurantId: session.restaurantId,
        outletId: session.outletId,
        addedBy: "POS",
      });

      session.items.push(...validatedItems);
      addTimeline(session, "ITEMS_ADDED", `${validatedItems.length} item(s) added`, "POS", req.user?._id);
      await recalculateSessionBill(session);

      const { order: kitchenOrder, appended } = await addRoundToKitchenOrder({
        session,
        validatedItems,
        tableId: session.tableId,
        createdBy: req.user?._id,
        mongoSession,
      });

      // Keep the table's currentOrder in sync
      if (!table) {
        table = await Table.findOne({ _id: session.tableId, ...scopeQuery }).session(mongoSession);
      }
      if (table) {
        table.currentOrderId = kitchenOrder._id;
        await table.save({ session: mongoSession });
      }

      await session.save({ session: mongoSession });

      return { session, kitchenOrder, appended, validatedItems };
    }));

    announceKitchenOrder({ session: result.session, order: result.kitchenOrder, appended: result.appended });
  } catch (error) {
    return next(error);
  }

  res.status(200).json({ success: true, message: "Items added!", data: result.session });
};

// ============================================================
// Get all sessions (with activeSessions for table grid)
// ============================================================
const getSessions = async (req, res, next) => {
  try {
    const scopeQuery = getScopeQuery(req);
    const { status } = req.query;
    const query = { ...scopeQuery, isDeleted: { $ne: true } };
    if (status) query.status = status;

    const sessions = await TableSession.find(query)
      .populate("tableId", "tableNumber capacity zone")
      .sort({ createdAt: -1 });

    const activeSessions = await TableSession.find({
      ...scopeQuery,
      status: { $in: ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"] },
      isDeleted: { $ne: true },
    }).populate("tableId", "tableNumber capacity zone");

    const decorate = (s) => {
      const plain = s.toObject ? s.toObject() : s;
      plain.sessionDurationMs = plain.openedAt
        ? Math.max(0, new Date() - new Date(plain.openedAt))
        : null;
      plain.sessionDuration = plain.openedAt
        ? formatDuration(plain.sessionDurationMs)
        : null;
      return plain;
    };

    res.status(200).json({
      success: true,
      data: {
        sessions: sessions.map(decorate),
        activeSessions: activeSessions.map(decorate),
      },
    });
  } catch (error) {
    next(error);
  }
};

const formatDuration = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
};

const getSessionById = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) throw createHttpError(404, "Invalid id!");
    const scopeQuery = getScopeQuery(req);
    const session = await TableSession.findOne({ _id: id, ...scopeQuery, isDeleted: { $ne: true } })
      .populate("tableId", "tableNumber capacity zone");
    if (!session) throw createHttpError(404, "Table session not found!");

    const data = session.toObject();
    data.sessionDurationMs = data.openedAt
      ? Math.max(0, new Date() - new Date(data.openedAt))
      : null;
    data.sessionDuration = data.openedAt ? formatDuration(data.sessionDurationMs) : null;

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// Request bill
// OCCUPIED/PROCESSING → BILL_REQUESTED
// ============================================================
const requestBill = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) throw createHttpError(404, "Invalid id!");
    const scopeQuery = getScopeQuery(req);
    const session = await TableSession.findOne({ _id: id, ...scopeQuery, isDeleted: { $ne: true } });
    if (!session) throw createHttpError(404, "Table session not found!");

    // STATE VALIDATION: only an active session may request a bill
    assertCanTransition(
      session,
      ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"],
      "BILL_REQUESTED"
    );

    session.status = "BILL_REQUESTED";
    session.billRequestedAt = new Date();
    addTimeline(session, "BILL_REQUESTED", "Bill requested", "POS", req.user?._id);

    // Lazily create the canonical Bill so the bill display endpoint
    // always has a persistent record to reference.
    if (!session.billId) {
      const bill = await Bill.create([
        {
          billNumber: `BL_${session.sessionCode}`,
          restaurantId: session.restaurantId,
          outletId: session.outletId,
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
          createdBy: req.user?._id,
        },
      ]);
      session.billId = bill[0]._id;
    }

    await session.save();

    res.status(200).json({ success: true, message: "Bill requested!", data: session });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// Mark payment pending
// BILL_REQUESTED → PAYMENT_PENDING
// Triggered when the customer or biller selects payment.
// ============================================================
const markPaymentPending = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) throw createHttpError(404, "Invalid id!");
    const scopeQuery = getScopeQuery(req);
    const session = await TableSession.findOne({ _id: id, ...scopeQuery, isDeleted: { $ne: true } });
    if (!session) throw createHttpError(404, "Table session not found!");

    // STATE VALIDATION: only an active session may enter payment-pending
    assertCanTransition(
      session,
      ["OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"],
      "PAYMENT_PENDING"
    );

    session.status = "PAYMENT_PENDING";
    session.paymentRequestedAt = new Date();
    addTimeline(session, "PAYMENT_PENDING", "Payment requested — awaiting capture", "POS", req.user?._id);
    await session.save();

    res.status(200).json({ success: true, message: "Payment now pending!", data: session });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// Bill display
// Returns every item, quantity, subtotal, taxes, charges, total,
// table number and session/order number. Totals are always
// re-calculated server-side.
// ============================================================
const getSessionBill = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) throw createHttpError(404, "Invalid id!");
    const scopeQuery = getScopeQuery(req);

    const session = await TableSession.findOne({ _id: id, ...scopeQuery, isDeleted: { $ne: true } });
    if (!session) throw createHttpError(404, "Table session not found!");

    let billDoc = null;
    if (session.billId) {
      try {
        billDoc = await Bill.findOne({ _id: session.billId, restaurantId: session.restaurantId });
      } catch {
        billDoc = null;
      }
    }

    let table = null;
    try {
      table = await Table.findOne({ _id: session.tableId, ...scopeQuery, isDeleted: { $ne: true } });
    } catch {
      table = null;
    }

    const items = (session.items || [])
      .filter((i) => i.status !== "cancelled")
      .map((i) => ({
        menuItemId: i.menuItemId,
        name: i.name,
        quantity: i.quantity,
        price: i.price,
        total: i.total,
        modifiers: i.modifiers || [],
        note: i.note || "",
        status: i.status,
        orderId: i.orderId || null,
        kdsItemId: i.kdsItemId || null,
      }));

    // Server-side total calculation — never trusts client figures
    const billGst = await resolveGstForRestaurant(session.restaurantId, "system");
    const totals = priceService.calculateBill({
      items: items.map((i) => ({ price: i.price, quantity: i.quantity })),
      discount: session.bills?.discount || 0,
      additionalCharges: session.bills?.charges || 0,
      taxRate: billGst.rate,
      taxInclusive: billGst.inclusive,
    });

    const isSettled = session.status === "PAID" || session.status === "CLOSED";

    res.status(200).json({
      success: true,
      data: {
        billId: session.billId || null,
        billNumber: billDoc?.billNumber || `BL_${session.sessionCode}`,
        billStatus: billDoc?.status || (isSettled ? "PAID" : "PENDING"),
        sessionId: session._id,
        sessionCode: session.sessionCode,
        sessionStatus: session.status,
        table: { id: session.tableId, tableNumber: table?.tableNumber ?? null },
        customerCount: session.customerCount || 0,
        customerName: session.customerName || "",
        items,
        bills: totals,
        totals,
        requestedAt: session.billRequestedAt || null,
        paidAt: session.payment?.paidAt || null,
        paymentMethod: session.payment?.method || "",
      },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// Record payment against session (Cash / Restaurant QR / Online)
// Payment amount must equal server-calculated total.
// Session closes only on successful server-side payment.
// ============================================================
const recordSessionPayment = async (req, res, next) => {
  let mongoSession = null;
  try {
    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();
  } catch (sessionErr) {
    if (
      sessionErr?.message?.includes("replica set member") ||
      sessionErr?.code === 20 ||
      sessionErr?.name === "MongoServerError"
    ) {
      mongoSession = null;
    } else {
      return next(sessionErr);
    }
  }
  try {
    const { id } = req.params;
    const { method, transactionId, amount, paymentStatus, idempotencyKey } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) throw createHttpError(404, "Invalid id!");
    const scopeQuery = getScopeQuery(req);

    const session = await TableSession.findOne({ _id: id, ...scopeQuery, isDeleted: { $ne: true } }).session(mongoSession);
    if (!session) throw createHttpError(404, "Table session not found!");

    // A tip left at settle, and the buyer for a B2B (GST) bill. Both optional.
    const tip = Math.max(0, Math.min(100000, Math.round((Number(req.body.tip) || 0) * 100) / 100));
    const buyer = require("../services/gst").buyerFrom(req.body.buyer || {});
    if (buyer) {
      session.customerCompany = buyer.company;
      session.customerGstin = buyer.gstin;
    }
    if (tip > 0) session.bills.tip = tip;
    // STATE VALIDATION: prevent CLOSED → pay again and PAID → pay again
    assertCanTransition(session, ["OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"], "PAID");
    if (session.payment?.status === "PAID") {
      throw createHttpError(400, "This table session has already been paid.");
    }

    const allowedMethods = ["CASH", "QR_CODE", "ONLINE", "PAYMENT_LINK", "CARD", "UPI", "WALLET", "SPLIT"];
    const normalizedMethod = String(method || "").toUpperCase();
    if (!allowedMethods.includes(normalizedMethod)) {
      throw createHttpError(400, "Invalid payment method!");
    }

    // The bill, plus any tip: that is what changes hands.
    const billAmount = session.bills?.totalWithTax || 0;
    const payableAmount = Math.round((billAmount + tip) * 100) / 100;
    if (!billAmount || billAmount <= 0) {
      throw createHttpError(400, "No payable amount on this session.");
    }

    // Idempotency: prevent duplicate payments
    if (idempotencyKey) {
      const existingPayment = (session.paymentHistory || []).find(
        (p) => p.idempotencyKey === idempotencyKey && p.status === "PAID"
      );
      if (existingPayment) {
        await mongoSession?.commitTransaction();
        return res.status(200).json({ success: true, message: "Payment already recorded!", data: session });
      }
    }

    if (Number(amount) !== payableAmount) {
      throw createHttpError(400, `Payment amount mismatch. Expected ₹${payableAmount}.`);
    }

    // A split: several counter methods that add up to the bill. Each part is
    // its own history line and ledger entry; the session and the kitchen
    // order read "Split (Cash ₹500 + UPI ₹300)".
    let parts = [{ method: normalizedMethod, amount: payableAmount }];
    if (normalizedMethod === "SPLIT") {
      const { validateSplits } = require("../services/splitPayment");
      const check = validateSplits(req.body.splits, payableAmount);
      if (!check.ok) throw createHttpError(400, check.message);
      parts = check.parts;
    }

    const paid =
      normalizedMethod === "SPLIT"
        ? parts.every((p) => isPaidOnSelection({ method: p.method, paymentStatus }))
        : isPaidOnSelection({ method: normalizedMethod, paymentStatus });

    session.paymentHistory = session.paymentHistory || [];
    parts.forEach((p, i) => {
      session.paymentHistory.push({
        method: p.method,
        amount: p.amount,
        status: paid ? "PAID" : "FAILED",
        transactionId: transactionId || "",
        idempotencyKey: idempotencyKey ? (parts.length > 1 ? `${idempotencyKey}-${i}` : idempotencyKey) : "",
        at: new Date(),
        recordedBy: req.user?._id,
      });
    });

    // Keep the gateway handles an online checkout opened: a refund later
    // needs the merchant order id.
    const gatewayOrderId = session.payment?.gatewayOrderId || "";
    const gatewayProvider = session.payment?.gatewayProvider || "";
    session.payment = {
      method: normalizedMethod,
      status: paid ? "PAID" : "FAILED",
      transactionId: transactionId || "",
      paidAt: paid ? new Date() : null,
      recordedBy: req.user?._id,
      gatewayProvider,
      gatewayOrderId,
    };

    if (paid) {
      session.paymentRequestedAt = session.paymentRequestedAt || new Date();

      // 3. Mark session PAID — the lifecycle passes through PAID before closing.
      //    (1. payment already marked successful above, 2. bill marked PAID below)
      session.status = "PAID";
      addTimeline(session, "PAYMENT_COMPLETED", `Payment of ₹${payableAmount} received via ${normalizedMethod}`, "POS", req.user?._id);
      addTimeline(session, "SESSION_PAID", "Session marked PAID", "POS", req.user?._id);

      // 4 + 5. Close the session and make the table available
      session.status = "CLOSED";
      session.closedAt = new Date();
      session.closedBy = req.user?._id;
      addTimeline(session, "SESSION_CLOSED", "Session closed after payment", "POS", req.user?._id);

      // A paid table goes into its cooldown rather than straight back into
      // service, so the next party is not seated onto a table nobody has
      // cleared. The update frees it immediately when the restaurant has the
      // wait set to 0.
      await Table.findOneAndUpdate(
        { _id: session.tableId },
        await buildCooldownUpdate(session.restaurantId),
        { session: mongoSession }
      );
    } else {
      session.status = "PAYMENT_PENDING";
      addTimeline(session, "PAYMENT_FAILED", `Payment failed: ${normalizedMethod}`, "POS", req.user?._id);
    }

    // Write standalone ledger entries, one per part (dedupe via PaymentTransaction unique index)
    await PaymentTransaction.create(
      parts.map((p, i) => ({
        restaurantId: session.restaurantId,
        outletId: session.outletId,
        billId: session.billId || undefined,
        tableSessionId: session._id,
        customerId: session.customerId || undefined,
        method: p.method,
        amount: p.amount,
        status: paid ? "PAID" : "FAILED",
        transactionId: transactionId || "",
        idempotencyKey: idempotencyKey ? (parts.length > 1 ? `${idempotencyKey}-${i}` : idempotencyKey) : "",
        recordedBy: req.user?._id,
        paidAt: paid ? new Date() : null,
      })),
      { session: mongoSession }
    );

    // Keep canonical Bill in sync — create lazily if POS session never requested one
    let billId = session.billId;
    if (!billId) {
      const bill = await Bill.create(
        [
          {
            billNumber: `BL_${session.sessionCode}`,
            restaurantId: session.restaurantId,
            outletId: session.outletId,
            tableSessionId: session._id,
            customerDetails: {
              name: session.customerName || "Guest",
              phone: session.customerPhone || "",
              guests: session.customerCount || 1,
            },
            bills: session.bills,
            status: paid ? "PAID" : "PENDING",
            paidAmount: paid ? payableAmount : 0,
            dueAmount: paid ? 0 : payableAmount,
            settledAt: paid ? new Date() : undefined,
          },
        ],
        { session: mongoSession }
      );
      billId = bill[0]._id;
      session.billId = billId;
    } else {
      await Bill.findOneAndUpdate(
        { _id: billId, restaurantId: session.restaurantId },
        {
          status: paid ? "PAID" : "PARTIAL",
          paidAmount: payableAmount,
          dueAmount: paid ? 0 : payableAmount,
          settledAt: paid ? new Date() : undefined,
          bills: session.bills,
        },
        { session: mongoSession }
      );
    }

    // Ensure the ledger entry references the canonical bill
    if (billId) {
      await PaymentTransaction.updateMany(
        { tableSessionId: session._id, billId: { $exists: false }, restaurantId: session.restaurantId },
        { $set: { billId } },
        { session: mongoSession }
      );
    }

    // Preserve historical kitchen orders — mark them paid, never delete them.
    //
    // The status alone was not enough. Payment Status on the Orders screen is
    // read from `payments[0].status` and Payment Method from `paymentMethod`,
    // and a table order carried neither — so a table the operator had just
    // settled in cash still displayed "Pending" with no method against it.
    // Both are written here, from the method that was actually taken.
    if (paid) {
      await Order.updateMany(
        { tableSessionId: session._id, isDeleted: { $ne: true } },
        {
          $set: {
            orderStatus: PAID,
            "bills.totalWithTax": billAmount,
            "bills.serviceCharge": session.bills?.serviceCharge || 0,
            "bills.taxPercent": session.bills?.taxPercent || 0,
            "bills.tax": session.bills?.tax || 0,
            "bills.tip": tip,
            tips: tip,
            ...(gatewayOrderId ? { "paymentData.gatewayOrderId": gatewayOrderId, "paymentData.gatewayPaymentId": transactionId || "" } : {}),
            ...(buyer ? { "customerDetails.company": buyer.company, "customerDetails.gstin": buyer.gstin } : {}),
            paymentMethod:
              parts.length > 1
                ? require("../services/splitPayment").splitLabel(parts, displayPaymentMethod)
                : displayPaymentMethod(normalizedMethod),
            completedAt: new Date(),
            // Nothing is left to sweep once the bill is settled.
            completeDueAt: null,
            payments: parts.map((p) => ({
              method: parts.length > 1 ? "split" : normalizedMethod.toLowerCase(),
              amount: p.amount,
              status: "paid",
              transactionId: transactionId || "",
              paidAt: new Date(),
              ...(req.user?._id ? { paidBy: req.user._id } : {}),
            })),
          },
        },
        { session: mongoSession }
      );
    }

    await session.save({ session: mongoSession });
    await mongoSession?.commitTransaction();

    // AFTER the commit, never inside it -- an e-bill means an outbound HTTP
    // call to Fast2SMS, and holding a Mongo transaction open across a network
    // round trip to a third party is how a busy till starts timing out.
    // No-op unless the restaurant has autoEBill on.
    if (paid) fireAutoEBill({ tableSessionId: session._id });

    // The table is free the moment the bill is settled, so there is no wait
    // to report. `cooldownMinutes` stays in the response as 0 rather than
    // disappearing, because a client still reading it should see "no wait"
    // rather than `undefined`.
    const cooldownMinutes = 0;

    res.status(200).json({
      success: true,
      message: paid
        ? `Paid via ${normalizedMethod}. Table is available again.`
        : "Payment failed.",
      data: paid ? { ...(session.toObject ? session.toObject() : session), cooldownMinutes } : session,
    });
  } catch (error) {
    await mongoSession?.abortTransaction();
    next(error);
  } finally {
    mongoSession?.endSession();
  }
};

// ============================================================
// Move a party to another table
// ============================================================

/**
 * POST /api/table-session/:id/move { tableId }
 *
 * The party, their order and their bill go to another free table. The
 * kitchen orders follow (their `table` is rewritten) so the KOT, the Orders
 * screen and the e-bill all say the new table.
 */
const moveSession = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { tableId } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(tableId)) {
      throw createHttpError(404, "Invalid id!");
    }
    const scopeQuery = getScopeQuery(req);
    const session = await TableSession.findOne({ _id: id, ...scopeQuery, isDeleted: { $ne: true } });
    if (!session) throw createHttpError(404, "Table session not found!");
    assertNotSettled(session);
    if (String(session.tableId) === String(tableId)) throw createHttpError(400, "The party is already at that table.");

    const target = await Table.findOne({ _id: tableId, restaurantId: session.restaurantId, isDeleted: { $ne: true } });
    if (!target) throw createHttpError(404, "Table not found!");
    if (target.isEnabled === false) throw createHttpError(400, "That table is disabled.");
    const busy = await TableSession.findOne({
      tableId: target._id,
      restaurantId: session.restaurantId,
      status: { $in: ACTIVE_SESSION_STATUSES },
      isDeleted: { $ne: true },
    }).select("_id");
    if (busy) throw createHttpError(409, "That table already has a party. Merge into it instead.");
    validateCapacity(target, session.customerCount);

    const from = session.tableId;
    session.tableId = target._id;
    addTimeline(session, "TABLE_MOVED", `Moved to ${target.displayId || target.tableName || `Table ${target.tableNumber}`}`, "POS", req.user?._id);
    await session.save();

    await Order.updateMany({ tableSessionId: session._id, isDeleted: { $ne: true } }, { $set: { table: target._id } });
    const latest = await Order.findOne({ tableSessionId: session._id, isDeleted: { $ne: true } }).sort({ createdAt: -1 }).select("_id");
    await Table.findOneAndUpdate({ _id: from }, { status: "available", currentOrderId: null, currentOccupancy: 0 });
    await Table.findOneAndUpdate(
      { _id: target._id },
      { status: "occupied", currentOccupancy: session.customerCount || 1, currentOrderId: latest?._id || null },
    );

    for (const tid of [from, target._id]) {
      emitTableSessionUpdated({ restaurantId: session.restaurantId, outletId: session.outletId, tableId: tid, session, reason: "moved" });
    }
    res.status(200).json({ success: true, message: "Party moved.", data: session });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// Merge another table's party into this one
// ============================================================

/**
 * POST /api/table-session/:id/merge { fromSessionId }
 *
 * Everything on the other table's tab -- its items, guests and kitchen
 * orders -- joins this session; one bill at the end. The other session is
 * closed as merged and its table freed.
 */
const mergeSessions = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { fromSessionId } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(fromSessionId)) {
      throw createHttpError(404, "Invalid id!");
    }
    if (String(id) === String(fromSessionId)) throw createHttpError(400, "Choose a different table to merge from.");
    const scopeQuery = getScopeQuery(req);
    const [target, source] = await Promise.all([
      TableSession.findOne({ _id: id, ...scopeQuery, isDeleted: { $ne: true } }),
      TableSession.findOne({ _id: fromSessionId, ...scopeQuery, isDeleted: { $ne: true } }),
    ]);
    if (!target || !source) throw createHttpError(404, "Table session not found!");
    assertNotSettled(target);
    assertNotSettled(source);

    const sourceTable = await Table.findById(source.tableId).select("tableNumber tableName displayId");
    const sourceLabel = sourceTable?.displayId || sourceTable?.tableName || `Table ${sourceTable?.tableNumber ?? "?"}`;

    for (const it of source.items || []) {
      const plain = it.toObject ? it.toObject() : { ...it };
      delete plain._id;
      target.items.push(plain);
    }
    target.customerCount = (Number(target.customerCount) || 1) + (Number(source.customerCount) || 1);
    if (!target.customerName && source.customerName) target.customerName = source.customerName;
    if (!target.customerPhone && source.customerPhone) target.customerPhone = source.customerPhone;
    addTimeline(target, "TABLES_MERGED", `${sourceLabel} merged in (${(source.items || []).length} item(s))`, "POS", req.user?._id);
    await recalculateSessionBill(target); // saves

    // The other party's kitchen orders now belong here.
    await Order.updateMany(
      { tableSessionId: source._id, isDeleted: { $ne: true } },
      { $set: { tableSessionId: target._id, table: target.tableId } },
    );

    source.status = "CLOSED";
    source.closedAt = new Date();
    source.closedBy = req.user?._id;
    addTimeline(source, "SESSION_CLOSED", `Merged into another table's session ${target.sessionCode}`, "POS", req.user?._id);
    await source.save();

    await Table.findOneAndUpdate({ _id: source.tableId }, { status: "available", currentOrderId: null, currentOccupancy: 0 });
    await Table.findOneAndUpdate({ _id: target.tableId }, { currentOccupancy: target.customerCount });

    emitTableSessionUpdated({ restaurantId: target.restaurantId, outletId: target.outletId, tableId: target.tableId, session: target, reason: "merged" });
    emitTableSessionUpdated({ restaurantId: source.restaurantId, outletId: source.outletId, tableId: source.tableId, session: source, reason: "merged_away" });
    res.status(200).json({ success: true, message: `${sourceLabel} merged in.`, data: target });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// Close session without payment (admin)
// ============================================================
const closeSessionWithoutPayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) throw createHttpError(404, "Invalid id!");
    const scopeQuery = getScopeQuery(req);
    const session = await TableSession.findOne({ _id: id, ...scopeQuery, isDeleted: { $ne: true } });
    if (!session) throw createHttpError(404, "Table session not found!");
    if (session.status === "PAID" || session.status === "CLOSED") {
      throw createHttpError(400, "This table session has already been closed.");
    }

    session.status = "CLOSED";
    session.closedAt = new Date();
    session.closedBy = req.user?._id;
    addTimeline(session, "SESSION_CLOSED", "Session closed without payment", "POS", req.user?._id);
    await session.save();

    await Table.findOneAndUpdate(
      { _id: session.tableId },
      { status: "available", currentOrderId: null, currentOccupancy: 0 }
    );

    res.status(200).json({ success: true, message: "Table session closed!", data: session });
  } catch (error) {
    next(error);
  }
};

/**
 * Settle a table session that a DINER paid online, through exactly the same
 * code path the till uses.
 *
 * Deliberately an adapter over `recordSessionPayment` rather than a second
 * implementation. Settling a table touches seven things — payment, history,
 * session state, the Bill, the ledger, every kitchen order, and the table's
 * cooldown — and a parallel copy of that for QR payments would drift the
 * first time one of them changed. The money path stays singular; this only
 * supplies a caller that is a customer instead of a staff member.
 *
 * `recordedBy` is left unset on purpose: nobody at the counter recorded this.
 * The gateway's transaction id is the record.
 */
const settleSessionFromGateway = async ({
  sessionId,
  restaurantId,
  method = "ONLINE",
  amount,
  transactionId,
  idempotencyKey,
}) => {
  const req = {
    params: { id: String(sessionId) },
    body: { method, amount, transactionId, idempotencyKey, paymentStatus: "success" },
    user: { restaurantId },
  };

  let payload = null;
  const res = {
    status() {
      return this;
    },
    json(body) {
      payload = body;
      return this;
    },
  };

  let failure = null;
  await recordSessionPayment(req, res, (err) => {
    failure = err;
  });
  if (failure) throw failure;
  return payload;
};

// ============================================================
// Cancel ONE item on a live table session (POST /:id/items/:itemId/cancel)
//
// The floor needs this the moment the kitchen runs out of something: the
// dish has to come off the bill AND off the diner's own QR page, which is
// reading the same session. Until now a table order was write-only once
// placed — the only way to remove a dish was to void the whole session.
//
// The cancellation is written in three places because three things read it:
// the session item (the diner's page), the matching kitchen order item (the
// POS ticket and KDS), and the recalculated bill (which already excludes
// cancelled items).
// ============================================================
/**
 * Which kitchen line a cancelled session item refers to.
 *
 * A session's dishes are spread over one kitchen order per round, and the
 * cancelled line lives in exactly ONE of them -- so this returns a single
 * line, never a set. The order of preference is what keeps it honest:
 *
 *   kdsItemId   the line this item was actually created as, exact
 *   orderId     the round it was added in, then matched by name within it
 *   name        last resort, earliest round first
 *
 * Name matching is last precisely because two rounds can hold the same dish.
 * Cancelling round one's coffee when round two's was pulled takes a cooked
 * plate off the pass and leaves the wrong one on the ticket.
 *
 * `orders` are Mongoose documents (items expose `.id()`); plain objects work
 * too as long as they provide one.
 */
const findCancelTarget = (item, orders) => {
  const lineIn = (order) =>
    (item.kdsItemId && order.items.id(item.kdsItemId)) ||
    order.items.find(
      (oi) => oi.status !== "cancelled" && String(oi.name) === String(item.name),
    ) ||
    null;

  const owner =
    (item.kdsItemId && orders.find((o) => o.items.id(item.kdsItemId))) ||
    orders.find((o) => String(o._id) === String(item.orderId || "") && lineIn(o)) ||
    orders.find((o) => lineIn(o));

  return owner ? lineIn(owner) : null;
};

/**
 * An order was cancelled somewhere else -- free the table.
 *
 * Cancelling only ever wrote Order.orderStatus. The table session and the
 * Table itself were never told, so the Orders screen showed "Cancelled"
 * while Manage Tables kept the table occupied and the diner's QR page kept
 * the dishes. Nothing else revisits those records, so the table stayed
 * blocked until someone cleared it by hand.
 *
 * Every cancel route calls this, rather than each one growing its own copy.
 *
 * The table is released only when NOTHING live is left: no un-cancelled item
 * on the session, and no other open order against it. A table mid-meal on a
 * second round must not be handed to the next party because one round was
 * voided.
 */
/**
 * Free a table whose cancelled order never had a session.
 *
 * Same rule as the session path: the table goes back only when nothing else
 * live is on it, so a table mid-meal on a second order is left alone.
 */
const releaseTableForCancelledOrderWithoutSession = async (order) => {
  if (!order?.table) return null;

  const otherLive = await Order.countDocuments({
    table: order.table,
    _id: { $ne: order._id },
    isDeleted: { $ne: true },
    orderStatus: { $nin: [...CANCELLED_STATUSES, ...SETTLED_STATUSES] },
  });
  if (otherLive > 0) return null;

  const liveSession = await TableSession.findOne({
    tableId: order.table,
    status: { $in: ACTIVE_SESSION_STATUSES },
    isDeleted: { $ne: true },
  });
  // Somebody is sitting there under a session of their own. Not ours to close.
  if (liveSession) return null;

  return Table.findOneAndUpdate(
    { _id: order.table },
    await buildCooldownUpdate(order.restaurantId),
  );
};

const releaseSessionForCancelledOrder = async (order, actor = "POS") => {
  if (!order?.tableSessionId) {
    // Not every table order has a session. A dine-in order typed at the till,
    // and the legacy single-shot QR route, both stamp `table` and mark it
    // occupied without ever opening one. Cancelling those freed nothing, so
    // the table sat occupied with no session for anybody to close -- the
    // stranded tables staff had no way to release.
    await releaseTableForCancelledOrderWithoutSession(order);
    return null;
  }

  const session = await TableSession.findOne({
    _id: order.tableSessionId,
    isDeleted: { $ne: true },
  });
  if (!session) return null;

  // A settled bill is history.
  if (SETTLED_SESSION_STATUSES.includes(session.status)) return null;

  // Is this the session's only order? If so its items are this order's items,
  // even the ones written before `orderId` was stamped on them.
  const otherLive = await Order.countDocuments({
    tableSessionId: session._id,
    _id: { $ne: order._id },
    isDeleted: { $ne: true },
    orderStatus: { $nin: [...CANCELLED_STATUSES, ...SETTLED_STATUSES] },
  });

  const at = new Date();
  session.items.forEach((si) => {
    if (si.status === "cancelled") return;
    const mine = si.orderId ? String(si.orderId) === String(order._id) : otherLive === 0;
    if (!mine) return;
    si.status = "cancelled";
    si.cancelledAt = at;
    si.cancelReason = "Order cancelled";
  });

  const anyLiveItem = session.items.some((si) => si.status !== "cancelled");
  const freed = !anyLiveItem && otherLive === 0;

  if (freed) {
    session.status = "CLOSED";
    session.closedAt = at;
    addTimeline(session, "SESSION_CLOSED", "Order cancelled", actor);
    await Table.findOneAndUpdate(
      { _id: session.tableId },
      await buildCooldownUpdate(session.restaurantId),
    );
  }

  // Saves the session, and drops the cancelled lines from its bill.
  await recalculateSessionBill(session);

  try {
    emitTableSessionUpdated({
      restaurantId: session.restaurantId,
      outletId: session.outletId,
      tableId: session.tableId,
      session,
      reason: freed ? "order_cancelled_table_freed" : "order_cancelled",
    });
  } catch (err) {
    console.warn("emitTableSessionUpdated failed:", err.message);
  }

  return session;
};

const cancelSessionItem = async (req, res, next) => {
  try {
    const { id, itemId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) throw createHttpError(404, "Invalid session id!");

    const session = await TableSession.findOne({
      _id: id,
      ...getScopeQuery(req),
      isDeleted: { $ne: true },
    });
    if (!session) throw createHttpError(404, "Table session not found!");

    // A settled bill is history. Removing a dish after the money is taken
    // would silently change what the customer already paid for.
    if (["PAID", "CLOSED"].includes(session.status)) {
      throw createHttpError(409, "This table has already been settled — its items can no longer be changed.");
    }

    const item = session.items.id(itemId);
    if (!item) throw createHttpError(404, "That item is not on this table's order.");
    if (item.status === "cancelled") {
      throw createHttpError(409, "That item has already been cancelled.");
    }

    const reason = String(req.body?.reason || "").trim().slice(0, 200);

    item.status = "cancelled";
    item.cancelledAt = new Date();
    item.cancelReason = reason;

    addTimeline(
      session,
      "ITEM_CANCELLED",
      `${item.name} × ${item.quantity} cancelled${reason ? ` — ${reason}` : ""}`,
      "POS",
      req.user?._id,
    );

    // recalculateSessionBill saves the session and already drops cancelled
    // items from the total.
    await recalculateSessionBill(session);

    // Mirror onto the kitchen order(s) so the ticket, the KDS and the Orders
    // list agree with the bill. Without this the POS keeps cooking a dish the
    // customer is no longer being charged for.
    //
    // The lookup is deliberately NOT `item.orderId` alone. That link is
    // optional on the model ("internal kitchen order if any"), so an item
    // added by any path that did not stamp it -- or written before the link
    // existed -- skipped this whole block, and the Orders screen went on
    // showing a line the bill had already dropped. `tableSessionId` is
    // written by every order-creation path for a table, so it always finds
    // them.
    //
    // All of the session's orders are updated, not just one: both creation
    // sites write the session's RUNNING bill onto each order they create, so
    // a stale bill on round one is just as wrong as a stale bill on round two.
    const sessionOrders = await Order.find({
      restaurantId: session.restaurantId,
      isDeleted: { $ne: true },
      $or: [
        ...(item.orderId ? [{ _id: item.orderId }] : []),
        { tableSessionId: session._id },
      ],
    }).sort({ orderDate: 1 });

    const orderItem = findCancelTarget(item, sessionOrders);
    if (orderItem) {
      orderItem.status = "cancelled";
      orderItem.cancelledAt = item.cancelledAt;
      orderItem.cancelReason = reason;
    }

    const touchedOrders = [];
    for (const order of sessionOrders) {
      order.bills = session.bills;

      // Every dish pulled means there is no order left to cook.
      const anyLive = order.items.some((oi) => oi.status !== "cancelled");
      if (!anyLive && !isFinished(order.orderStatus)) {
        order.orderStatus = CANCELLED;
        order.timeline = order.timeline || [];
        order.timeline.push({
          status: CANCELLED,
          timestamp: new Date(),
          user: req.user?.name || "POS",
        });
        // A cancelled order must not be picked up by the auto sweeps.
        order.readyDueAt = null;
        order.completeDueAt = null;
      }

      await order.save();
      touchedOrders.push(order);
    }

    for (const order of touchedOrders) {
      try {
        emitOrderStatusChanged({
          restaurantId: order.restaurantId,
          outletId: order.outletId,
          order,
        });
      } catch (err) {
        console.warn("emitOrderStatusChanged failed:", err.message);
      }
    }

    // Pulling the last dish cancels the order, and a cancelled order must
    // free the table like any other cancel route.
    for (const order of touchedOrders) {
      if (canonicalStatus(order.orderStatus) !== CANCELLED) continue;
      try {
        await releaseSessionForCancelledOrder(order, req.user?.name || "POS");
      } catch (err) {
        console.warn("releaseSessionForCancelledOrder failed:", err.message);
      }
    }

    // The session's own listeners: Manage Tables on the restaurant room, and
    // the diner's phone on the table room. Without this the operator who
    // pulled the dish saw it go and nobody else did.
    try {
      emitTableSessionUpdated({
        restaurantId: session.restaurantId,
        outletId: session.outletId,
        tableId: session.tableId,
        session,
        reason: "item_cancelled",
      });
    } catch (err) {
      console.warn("emitTableSessionUpdated failed:", err.message);
    }

    res.status(200).json({
      success: true,
      message: `${item.name} cancelled.`,
      data: session,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Take the service charge off a table's bill, or put it back.
 *
 * A service charge is the guest's to refuse, so it has to be removable before
 * the money is taken. The choice is kept on the session: adding a dish later
 * re-strikes the bill and must not quietly bring the charge back.
 */
const setServiceCharge = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) throw createHttpError(404, "Invalid session id!");

    const session = await TableSession.findOne({ _id: id, ...getScopeQuery(req), isDeleted: { $ne: true } });
    if (!session) throw createHttpError(404, "Table session not found!");
    if (SETTLED_SESSION_STATUSES.includes(session.status)) {
      throw createHttpError(409, "This table has already been settled: its bill can no longer be changed.");
    }

    const waived = req.body?.waived !== false;
    session.bills.serviceChargeWaived = waived;
    addTimeline(
      session,
      waived ? "SERVICE_CHARGE_REMOVED" : "SERVICE_CHARGE_RESTORED",
      waived ? "Service charge removed from the bill" : "Service charge put back on the bill",
      "POS",
      req.user?._id,
    );
    await recalculateSessionBill(session);

    // Every order of the session carries the running bill (see cancelSessionItem).
    const sessionOrders = await Order.find({
      restaurantId: session.restaurantId,
      tableSessionId: session._id,
      isDeleted: { $ne: true },
    });
    for (const order of sessionOrders) {
      order.bills = session.bills;
      await order.save();
    }

    try {
      emitTableSessionUpdated({
        restaurantId: session.restaurantId,
        outletId: session.outletId,
        tableId: session.tableId,
        session,
        reason: "service_charge",
      });
    } catch (err) {
      console.warn("emitTableSessionUpdated failed:", err.message);
    }

    res.status(200).json({
      success: true,
      message: waived ? "Service charge removed." : "Service charge added back.",
      data: session,
    });
  } catch (error) {
    next(error);
  }
};

const findActiveSessionByTable = async ({ tableId, restaurantId }) =>
  TableSession.findOne({
    tableId,
    restaurantId,
    status: { $in: ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"] },
    isDeleted: { $ne: true },
  });

module.exports = {
  addItemsToSession,
  addItemsToExistingSession,
  moveSession,
  mergeSessions,
  getSessions,
  getSessionById,
  requestBill,
  markPaymentPending,
  getSessionBill,
  recordSessionPayment,
  closeSessionWithoutPayment,
  cancelSessionItem,
  setServiceCharge,
  findCancelTarget,
  releaseSessionForCancelledOrder,
  settleSessionFromGateway,
  findActiveSessionByTable,
  recalculateSessionBill,
  validateCapacity,
  enrichItems,
  isPaidOnSelection,
  COUNTER_SETTLED_METHODS,
  runWithSessionRetry,
  generateSessionCode,
  generateSessionAccessToken,
  formatDuration,
  ACTIVE_SESSION_STATUSES,
  SETTLED_SESSION_STATUSES,
  assertNotSettled,
  assertCanTransition,
  assertActiveForItems,
};
