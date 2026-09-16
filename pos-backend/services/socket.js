const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const config = require("../config/config");
const User = require("../models/userModel");

let io = null;

const parseCookies = (header = "") =>
  header.split(";").reduce((cookies, part) => {
    const separator = part.indexOf("=");
    if (separator === -1) return cookies;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});

/**
 * Socket.IO does not pass through Express' cookie middleware. Authenticate
 * from the same HTTP-only access token used by the REST API before a socket
 * can join any tenant room.
 */
const authenticateSocket = async (socket, next) => {
  try {
    // Session cookies are namespaced per takeaway (services/sessionCookies),
    // so pick the one for the store this socket declares. Socket.IO has no
    // custom headers on the handshake, so the store arrives in the query.
    const jar = parseCookies(socket.handshake.headers?.cookie || "");
    const declared = String(socket.handshake.query?.storeId || "").trim();
    const storeKey = /^\d{6}$/.test(declared) ? declared : "";

    let token = storeKey ? jar[`accessToken_${storeKey}`] : "";
    if (!token) token = jar.accessToken; // session predating the namespacing
    if (!token && !storeKey) {
      // No store declared: only safe when exactly one takeaway is signed in.
      const scoped = Object.keys(jar).filter((n) => /^accessToken_\d{6}$/.test(n));
      if (scoped.length === 1) token = jar[scoped[0]];
    }
    if (!token) return next(new Error("Authentication required"));

    const claims = jwt.verify(token, config.accessTokenSecret);
    const user = await User.findById(claims._id);
    if (!user || user.isDeleted || !user.isActive) {
      return next(new Error("Authentication required"));
    }

    // The database is authoritative; never trust tenant claims or query data.
    socket.user = user;
    socket.tenant = {
      restaurantId: user.restaurantId ? String(user.restaurantId) : "",
      outletId: user.outletId ? String(user.outletId) : "",
      storeId: user.storeId ? String(user.storeId) : "",
    };
    if (!socket.tenant.restaurantId && !socket.tenant.storeId) {
      return next(new Error("Tenant is not configured"));
    }
    // A socket that names a store may only ever be that store.
    if (storeKey && socket.tenant.storeId !== storeKey) {
      return next(new Error("Authentication required"));
    }
    return next();
  } catch (error) {
    return next(new Error("Authentication required"));
  }
};

const initSocket = (server, { corsOrigin = ["http://localhost:5173"] } = {}) => {
  // corsOrigin may be an array (legacy), a string, or a function(origin, cb)
  // implementing the same allow-list logic as the HTTP CORS layer. Socket.IO
  // passes it straight through to its underlying `cors` middleware.
  io = new Server(server, {
    cors: { origin: corsOrigin, credentials: true },
  });

  io.use(authenticateSocket);

  io.on("connection", (socket) => {
    // These identifiers come from the authenticated user loaded above.
    // Handshake query/body values are intentionally ignored.
    const { restaurantId, outletId, storeId } = socket.tenant;
    if (restaurantId) socket.join(`restaurant:${restaurantId}`);
    if (outletId) socket.join(`outlet:${outletId}`);
    if (storeId) socket.join(`store:${storeId}`);

    /**
     * The POS/KDS clients emit `joinRestaurant` after connecting (see
     * useKDSRealtime / useOnlineOrders). Previously there was no server-side
     * handler, so clients that relied on it never received events. Rooms are
     * per-tenant, which is what keeps one restaurant from receiving another's
     * order payloads (§31).
     */
    socket.on("joinRestaurant", () => {
      // Re-join only the rooms already authorized from the session. A client
      // cannot use this event to widen its tenant scope.
      if (restaurantId) socket.join(`restaurant:${restaurantId}`);
      if (outletId) socket.join(`outlet:${outletId}`);
      if (storeId) socket.join(`store:${storeId}`);
    });

    socket.on("leaveRestaurant", () => {
      if (restaurantId) socket.leave(`restaurant:${restaurantId}`);
    });

    socket.on("disconnect", () => {});
  });

  return io;
};

/**
 * Broadcast realtime events to POS + KDS clients.
 * - table:<tableId>        — item added / status change for a specific table
 * - restaurant:<id>        — session open/close, bill requested, payment completed
 * - outlet:<id>            — same as above but outlet-scoped
 * - store:<storeId>        — storefront/online order events
 * - kds:<restaurantId>     — new kitchen order / item status
 */
const emitEvent = (event, payload, rooms = []) => {
  if (!io) return;
  if (rooms && rooms.length) io.to(rooms).emit(event, payload);
  else io.emit(event, payload);
};

const emitToRestaurant = (restaurantId, event, payload) => {
  emitEvent(event, payload, [`restaurant:${restaurantId}`]);
};

const emitToOutlet = (outletId, event, payload) => {
  emitEvent(event, payload, [`outlet:${outletId}`]);
};

const emitToTable = (tableId, event, payload) => {
  emitEvent(event, payload, [`table:${tableId}`]);
};

/**
 * What the POS "New order" card renders. One builder for the live event and
 * for the catch-up list (GET /api/online-orders/awaiting), so a card that
 * arrives late looks exactly like one that arrived live.
 */
const orderCreatedPayload = (order, storeId = "") => {
  // If order.table is a populated Mongoose document (from .populate('table')),
  // extract the friendly identifier; otherwise fall back to the raw ObjectId
  // so the POS popup can at least display "Table {id-suffix}".
  const tableDoc =
    order.table && typeof order.table === "object" && order.table.tableNumber != null
      ? order.table
      : null;
  const rawTableId =
    (tableDoc && String(tableDoc._id)) ||
    (order.table ? String(order.table) : "");

  const payload = {
    type: "ORDER_CREATED",
    source: order.source || "WEBSITE",
    storeId: storeId || order.storeId || "",
    orderId: String(order._id),
    orderNumber: order.orderNumber || "",
    orderType: order.orderType,
    orderStatus: order.orderStatus,
    scheduledFor: order.scheduledFor || null,
    // ----- Table context (used by the QR "New Table Order" popup) -----
    tableId: rawTableId || null,
    tableNumber: tableDoc?.tableNumber ?? null,
    tableDisplayId: tableDoc?.displayId || tableDoc?.tableName || null,
    // Keep the original `table` value on the payload as well so consumers
    // that receive a populated Order (e.g. immediately after Order.create
    // + .populate("table")) can render the exact string they want.
    table: tableDoc
      ? {
          _id: tableDoc._id,
          tableNumber: tableDoc.tableNumber,
          displayId: tableDoc.displayId || "",
          tableName: tableDoc.tableName || "",
        }
      : rawTableId || null,
    customer: {
      name: order.customerDetails?.name || "",
      phone: order.customerDetails?.phone || "",
    },
    // Copy the full customerDetails through so table-order popups can show
    // guest counts, delivery notes, etc. without a follow-up REST call.
    customerDetails: order.customerDetails || {},
    // Full items list including modifiers array (name+price) — the QR popup
    // and Orders page both render this without another fetch.
    items: (order.items || []).map((i) => ({
      name: i.name,
      quantity: i.quantity,
      variant: i.variant?.name || "",
      addons: (i.addons || []).map((a) => a.name),
      modifiers: Array.isArray(i.modifiers) ? i.modifiers : [],
      options: (i.modifierSelections || []).map((m) => m.optionName),
      note: i.note || "",
      total: i.total,
      price: i.price,
    })),
    itemCount: (order.items || []).reduce((sum, i) => sum + (Number(i.quantity) || 0), 0),
    bills: order.bills,
    paymentStatus: order.payments?.[0]?.status || "pending",
    createdAt: order.createdAt || new Date(),
  };
  return payload;
};

/**
 * Online order created (§13, §31).
 *
 * The payload is scoped to the owning restaurant's room ONLY — private order
 * data is never broadcast platform-wide. The event carries enough detail for
 * the POS to render the "New Online Order" card without an extra fetch, while
 * the POS still reconciles via its REST endpoint on reconnect (§32).
 */
const emitOrderCreated = ({ restaurantId, outletId, storeId, order }) => {
  if (!io || !order) return;
  const payload = orderCreatedPayload(order, storeId);

  const rooms = [];
  if (restaurantId) rooms.push(`restaurant:${restaurantId}`);
  if (outletId) rooms.push(`outlet:${outletId}`);
  if (storeId) rooms.push(`store:${storeId}`);
  if (!rooms.length) return; // never fall back to a global broadcast

  // Dedicated event for the online-order UI...
  emitEvent("onlineOrder:created", payload, rooms);
  // ...plus the generic name existing KDS/POS listeners already use.
  emitEvent("newOrder", payload, rooms);
};

/** Order status changed in the POS — lets customer tracking update live. */
const emitOrderStatusChanged = ({ restaurantId, outletId, storeId, order }) => {
  if (!io || !order) return;
  const payload = {
    type: "ORDER_STATUS_CHANGED",
    orderId: String(order._id),
    orderNumber: order.orderNumber || "",
    orderStatus: order.orderStatus,
    storeId: storeId || order.storeId || "",
    updatedAt: new Date(),
  };
  const rooms = [];
  if (restaurantId) rooms.push(`restaurant:${restaurantId}`);
  if (outletId) rooms.push(`outlet:${outletId}`);
  if (storeId) rooms.push(`store:${storeId}`);
  if (!rooms.length) return;
  emitEvent("onlineOrder:status", payload, rooms);
};

/**
 * A table session changed -- items added, accepted, cancelled, bill settled.
 *
 * The POS already invalidated its `tables` and `orders` caches on
 * "tableSessionUpdated"; nothing ever emitted it, so Manage Tables sat on a
 * stale session until someone reloaded. The diner's own page is a separate
 * room (`table:<id>`) because it is not in the restaurant room and must not
 * be -- it would receive every other table's traffic.
 */
const emitTableSessionUpdated = ({ restaurantId, outletId, tableId, session, reason = "" }) => {
  if (!io || !session) return;
  const payload = {
    type: "TABLE_SESSION_UPDATED",
    sessionId: String(session._id),
    sessionCode: session.sessionCode || "",
    status: session.status,
    reason,
    updatedAt: new Date(),
  };
  const rooms = [];
  if (restaurantId) rooms.push(`restaurant:${restaurantId}`);
  if (outletId) rooms.push(`outlet:${outletId}`);
  if (tableId) rooms.push(`table:${tableId}`);
  if (!rooms.length) return;
  emitEvent("tableSessionUpdated", payload, rooms);
};

module.exports = {
  initSocket,
  authenticateSocket,
  emitEvent,
  emitToRestaurant,
  emitToOutlet,
  emitToTable,
  orderCreatedPayload,
  emitOrderCreated,
  emitOrderStatusChanged,
  emitTableSessionUpdated,
};
