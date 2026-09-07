/**
 * Automatic Preparing → Ready scheduler (Module 4 §4).
 *
 * "Collection, Delivery and Table orders must automatically transition
 *  Preparing → Ready after the configured automatic-ready duration.
 *  The server must be authoritative. Do not rely only on browser timers."
 *
 * Design:
 *  - The order stores `readyDueAt` when it enters Preparing (or is
 *    accepted / created in Preparing). The value is computed on the
 *    server from WebsiteSettings.ordering.autoReadyMinutes so any
 *    change to the setting immediately affects new orders.
 *  - A single Node interval polls every AUTO_READY_TICK_MS for orders
 *    whose readyDueAt has passed and are still in Preparing. Each such
 *    order is transitioned to Ready (readyBy = "AUTO"), its timeline
 *    receives an entry, a socket event is emitted, and — if a phone is
 *    on file — the customer receives the "Order is Ready" SMS via the
 *    shared readyNotificationService (idempotent, so a manual mark just
 *    before the timer fires won't send twice).
 *
 * Safety:
 *  - Runs at most ONE tick at a time (the isRunning guard) so a slow DB
 *    tick can't overlap with the next one.
 *  - Bounded batch size — never processes more than MAX_BATCH orders per
 *    tick, so a big backlog doesn't monopolise the event loop.
 *  - Individual order failures are logged, not thrown — one bad row
 *    cannot break the whole loop.
 *  - Disabled in test environment (NODE_ENV=test) so unit tests don't
 *    stall on a leaked interval handle.
 */

const Order = require("../models/orderModel");
const WebsiteSettings = require("../models/websiteSettingsModel");
const { notifyOrderReady } = require("./readyNotificationService");
const { fireAutoEBill } = require("./eBillService");
const { fireOrderCharge } = require("./orderCharge");
const {
  READY, SERVED, DELIVERED, COMPLETED,
  PREPARING_STATUSES, SETTLED_STATUSES, CANCELLED_STATUSES, REFUNDED_STATUSES,
  isPreparing,
} = require("../constants/orderStatus");

const AUTO_READY_TICK_MS = 30 * 1000;   // 30 seconds
const MAX_BATCH = 100;

// Defaults straight from the Module 4 §4 spec.
const DEFAULT_MINUTES = {
  collection: 20,
  delivery: 45,
  table: 20,
};

let intervalHandle = null;
let isRunning = false;
let emitter = null;

/**
 * Resolve the configured auto-ready minutes for a given (restaurant,
 * orderType). Falls back to spec defaults if no WebsiteSettings doc
 * exists for the tenant yet. Returns 0 to mean "disabled".
 */
const getAutoReadyMinutes = async ({ restaurantId, storeId, orderType }) => {
  const bucket = mapOrderTypeToBucket(orderType);
  if (!bucket) return 0;

  try {
    const query = { isDeleted: { $ne: true } };
    if (restaurantId) query.restaurantId = restaurantId;
    else if (storeId) query.storeId = storeId;
    else return DEFAULT_MINUTES[bucket];

    const settings = await WebsiteSettings.findOne(query).select("ordering.autoReadyMinutes");
    const configured = settings?.ordering?.autoReadyMinutes?.[bucket];
    if (configured === 0) return 0; // explicitly disabled
    if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
      return Math.min(24 * 60, configured);
    }
    return DEFAULT_MINUTES[bucket];
  } catch (err) {
    // If settings lookup fails we still want an auto-ready to happen —
    // fall back to the safe spec defaults rather than never firing.
    return DEFAULT_MINUTES[bucket];
  }
};

/**
 * Map any of the order-type strings that reach us onto the three
 * configurable buckets. Anything else returns null (no auto-ready).
 */
const mapOrderTypeToBucket = (orderType) => {
  const t = String(orderType || "").toLowerCase();
  if (t === "collection" || t === "takeaway" || t === "pickup") return "collection";
  if (t === "delivery") return "delivery";
  if (t === "dine-in" || t === "table") return "table";
  return null;
};

/**
 * Resolve the configured auto-complete minutes for a given (restaurant,
 * orderType). Returns 0 to mean "disabled" (optional, does not interfere).
 */
const getAutoCompleteMinutes = async ({ restaurantId, storeId, orderType }) => {
  const bucket = mapOrderTypeToBucket(orderType);
  if (!bucket) return 0;

  try {
    const query = { isDeleted: { $ne: true } };
    if (restaurantId) query.restaurantId = restaurantId;
    else if (storeId) query.storeId = storeId;
    else return 0;

    const settings = await WebsiteSettings.findOne(query).select("ordering.autoCompleteMinutes");
    const configured = settings?.ordering?.autoCompleteMinutes?.[bucket];
    if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
      return Math.min(24 * 60, configured);
    }
    return 0; // default 0 (disabled / optional)
  } catch (err) {
    return 0;
  }
};

/**
 * Convenience helper for controllers: compute what completeDueAt SHOULD be
 * for an order. Returns null if auto-complete is disabled (0 mins).
 */
const computeReadyDueAt = async ({ restaurantId, storeId, orderType, from = new Date() }) => {
  const minutes = await getAutoReadyMinutes({ restaurantId, storeId, orderType });
  if (!minutes || minutes <= 0) return null;
  return new Date(from.getTime() + minutes * 60 * 1000);
};

const computeCompleteDueAt = async ({ restaurantId, storeId, orderType, from = new Date() }) => {
  const minutes = await getAutoCompleteMinutes({ restaurantId, storeId, orderType });
  if (!minutes || minutes <= 0) return null;

  // Both clocks start when the order is created, so a shorter auto-complete
  // than auto-ready would finish the order before the kitchen was ever told
  // it was ready — the order would jump Preparing → Completed and the Ready
  // step (and its customer notification) would never happen. Hold the
  // complete deadline to the ready one so the sequence always survives a
  // careless pair of settings.
  const readyMinutes = await getAutoReadyMinutes({ restaurantId, storeId, orderType });
  const effective = readyMinutes > 0 ? Math.max(minutes, readyMinutes) : minutes;
  return new Date(from.getTime() + effective * 60 * 1000);
};

// Kept as a named local for readability; the vocabulary itself now lives in
// constants/orderStatus.js so this guard and the query above cannot drift.
const isPreparingStatus = (status) => isPreparing(status);

/** Single tick of the auto-ready loop. Exported for tests / manual runs. */
const runAutoReadyTick = async () => {
  if (isRunning) return { skipped: true, reason: "already_running" };
  isRunning = true;

  try {
    const now = new Date();

    // We deliberately query ONLY orders that already have a readyDueAt
    // in the past — no client-provided dates, and no unbounded scans.
    const due = await Order.find({
      readyDueAt: { $lte: now, $ne: null },
      readyAt: null,
      isDeleted: { $ne: true },
      // Must list every historical spelling: the QR and table-session flows
      // wrote lowercase "pending", so a Title-Case-only $in silently returned
      // none of those orders and they were never auto-promoted to Ready.
      orderStatus: { $in: PREPARING_STATUSES },
    })
      .sort({ readyDueAt: 1 })
      .limit(MAX_BATCH);

    let promoted = 0;
    for (const order of due) {
      if (!isPreparingStatus(order.orderStatus)) continue;
      try {
        const previousStatus = order.orderStatus;
        order.orderStatus = READY;
        order.readyAt = now;
        order.readyBy = "AUTO";
        order.timeline = order.timeline || [];
        order.timeline.push({
          status: READY,
          timestamp: now,
          user: `AUTO (from ${previousStatus})`,
        });
        await order.save();
        promoted += 1;

        // Best-effort realtime + SMS. Never let either fail the tick.
        try {
          if (emitter && order.restaurantId) {
            emitter({
              restaurantId: order.restaurantId,
              outletId: order.outletId,
              storeId: order.storeId,
              order,
            });
          }
        } catch (emitErr) {
          console.warn("[autoReady] socket emit failed:", emitErr.message);
        }

        try {
          await notifyOrderReady(order);
        } catch (smsErr) {
          console.warn("[autoReady] SMS notify failed:", smsErr.message);
        }
      } catch (rowErr) {
        console.warn("[autoReady] failed to promote order", order._id, rowErr.message);
      }
    }

    // Run Auto-Complete check on same tick
    await runAutoCompleteTick(now);

    return { promoted, scanned: due.length };
  } catch (err) {
    console.error("[autoReady] tick failed:", err.message);
    return { promoted: 0, error: err.message };
  } finally {
    isRunning = false;
  }
};

/**
 * Start the background loop. Safe to call multiple times — subsequent
 * calls are no-ops. Pass an `emitOrderStatusChanged`-shaped function so
 * tick promotions can notify connected POS/tracking clients.
 */
const startAutoReadyScheduler = ({ onOrderReady } = {}) => {
  if (process.env.NODE_ENV === "test") return;
  if (intervalHandle) return; // already started
  emitter = typeof onOrderReady === "function" ? onOrderReady : null;
  // Run once on boot so orders that came due while the server was down
  // are picked up immediately, not up to a full tick later.
  runAutoReadyTick().catch(() => {});
  intervalHandle = setInterval(() => {
    runAutoReadyTick().catch(() => {});
  }, AUTO_READY_TICK_MS);
  if (typeof intervalHandle.unref === "function") intervalHandle.unref();
  console.log(`[autoReady] scheduler started (tick=${AUTO_READY_TICK_MS}ms)`);
};

const stopAutoReadyScheduler = () => {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
};

/** Single tick of the auto-complete loop. */
const runAutoCompleteTick = async (now = new Date()) => {
  try {
    const due = await Order.find({
      completeDueAt: { $lte: now, $ne: null },
      completedAt: null,
      isDeleted: { $ne: true },
    })
      .sort({ completeDueAt: 1 })
      .limit(MAX_BATCH);

    let completedCount = 0;
    for (const order of due) {
      // Skip already finished or cancelled orders. SETTLED_STATUSES includes
      // "paid" — a table session whose bill was settled must not be dragged
      // back into "Served" by this sweep and have its history rewritten.
      const currentStatus = String(order.orderStatus || "");
      const finished = [...SETTLED_STATUSES, ...CANCELLED_STATUSES, ...REFUNDED_STATUSES];
      if (finished.includes(currentStatus)) {
        order.completeDueAt = null;
        await order.save();
        continue;
      }

      try {
        const previousStatus = order.orderStatus;
        const targetStatus = order.orderType === "delivery" ? DELIVERED : order.orderType === "dine-in" ? SERVED : COMPLETED;
        order.orderStatus = targetStatus;
        order.completedAt = now;
        order.completedBy = "AUTO";
        order.completeDueAt = null;
        order.timeline = order.timeline || [];
        order.timeline.push({
          status: targetStatus,
          timestamp: now,
          user: `AUTO (Auto-Completed from ${previousStatus})`,
        });
        await order.save();
        completedCount += 1;

        // Auto-completed by the timer rather than by a person, but the bill is
        // no less final. Same fire-and-forget contract; no-op unless the
        // restaurant has autoEBill on.
        fireAutoEBill({ orderId: order._id });
        fireOrderCharge(order._id);

        if (emitter && order.restaurantId) {
          try {
            emitter({
              restaurantId: order.restaurantId,
              outletId: order.outletId,
              storeId: order.storeId,
              order,
            });
          } catch (emitErr) {
            console.warn("[autoComplete] socket emit failed:", emitErr.message);
          }
        }
      } catch (rowErr) {
        console.warn("[autoComplete] failed to auto-complete order", order._id, rowErr.message);
      }
    }
    return completedCount;
  } catch (err) {
    console.error("[autoComplete] tick failed:", err.message);
    return 0;
  }
};

module.exports = {
  startAutoReadyScheduler,
  stopAutoReadyScheduler,
  runAutoReadyTick,
  runAutoCompleteTick,
  computeReadyDueAt,
  computeCompleteDueAt,
  getAutoReadyMinutes,
  getAutoCompleteMinutes,
  DEFAULT_MINUTES,
};
