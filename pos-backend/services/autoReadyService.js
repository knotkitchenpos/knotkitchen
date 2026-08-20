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
 * Convenience helper for controllers: compute what readyDueAt SHOULD be
 * for a brand-new order that starts in Preparing. Returns null if
 * auto-ready is disabled for this order type.
 */
const computeReadyDueAt = async ({ restaurantId, storeId, orderType, from = new Date() }) => {
  const minutes = await getAutoReadyMinutes({ restaurantId, storeId, orderType });
  if (!minutes || minutes <= 0) return null;
  return new Date(from.getTime() + minutes * 60 * 1000);
};

const isPreparingStatus = (status) => {
  const s = String(status || "").toLowerCase();
  // "Preparing" is the canonical Module 4 name; "Pending" and
  // "In Progress" are historical aliases still present on old orders.
  return s === "preparing" || s === "pending" || s === "in progress";
};

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
      orderStatus: { $in: ["Preparing", "Pending", "In Progress"] },
    })
      .sort({ readyDueAt: 1 })
      .limit(MAX_BATCH);

    let promoted = 0;
    for (const order of due) {
      if (!isPreparingStatus(order.orderStatus)) continue;
      try {
        const previousStatus = order.orderStatus;
        order.orderStatus = "Ready";
        order.readyAt = now;
        order.readyBy = "AUTO";
        order.timeline = order.timeline || [];
        order.timeline.push({
          status: "Ready",
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

module.exports = {
  startAutoReadyScheduler,
  stopAutoReadyScheduler,
  runAutoReadyTick,
  computeReadyDueAt,
  getAutoReadyMinutes,
  DEFAULT_MINUTES,
};
