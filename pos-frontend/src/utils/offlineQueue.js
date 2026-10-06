/**
 * Orders taken while the internet is down.
 *
 * Kept in localStorage, per store, until POST /api/offline/orders/sync
 * accepts them. Each has a localId the server turns into an idempotency
 * key, so retrying a sync never creates an order twice.
 */
import { readStoreScoped, writeStoreScoped } from "./storeSession.js";
import { COMPLETED, PREPARING } from "../constants/orderStatus.js";

const KEY = "kk.offlineOrders.v1";

export const isNetworkError = (err) => Boolean(err) && !err.response && (err.code === "ERR_NETWORK" || err.message === "Network Error" || (typeof navigator !== "undefined" && navigator.onLine === false));

export const readQueue = () => {
  const q = readStoreScoped(KEY, []);
  return Array.isArray(q) ? q : [];
};

const writeQueue = (q) => {
  writeStoreScoped(KEY, q);
  try {
    window.dispatchEvent(new CustomEvent("kk:offline-queue", { detail: { count: q.length } }));
  } catch {
    /* not in a browser */
  }
};

/** A fresh order id. OrderPanel also sends it with the live attempt, so a lost reply cannot turn into a second order. */
export const newLocalId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const SEQ = "kk.offlineSeq.v1";

/** Queue an order; returns the entry (with localId and a local order number). */
export const enqueueOrder = (order, localId = newLocalId()) => {
  const q = readQueue();
  // Numbers only go up, per store and device. Counting the queue handed out
  // OFF-002 again once OFF-001 synced, so two receipts carried one number.
  // The max over the queue covers a till updated in the middle of an outage.
  // ponytail: two tills offline at once can both print OFF-001; add a device suffix if that matters.
  const n = Math.max(Number(readStoreScoped(SEQ, 0)) || 0, ...q.map((e) => Number(String(e.localNumber).replace(/\D/g, "")) || 0)) + 1;
  writeStoreScoped(SEQ, n);
  const entry = {
    localId,
    placedAt: new Date().toISOString(),
    localNumber: `OFF-${String(n).padStart(3, "0")}`,
    order,
  };
  writeQueue([...q, entry]);
  return entry;
};

export const removeFromQueue = (localIds) => {
  const drop = new Set(localIds);
  writeQueue(readQueue().filter((e) => !drop.has(e.localId)));
};

/**
 * The server refused these. They stay on the device with the reason: they are
 * sales already rung up, and a passing error or a settings fix (an order type
 * switched back on) lets them through on a later sync. Only staff discard one.
 * Returns the entries refused for the first time, so the till warns once.
 */
export const markRejected = (failedOrders) => {
  const why = new Map(failedOrders.map((f) => [f.localId, String(f.error || "failed")]));
  const failedAt = new Date().toISOString();
  const fresh = [];
  writeQueue(
    readQueue().map((e) => {
      if (!why.has(e.localId)) return e;
      const next = { ...e, error: why.get(e.localId), failedAt };
      if (!e.error) fresh.push(next);
      return next;
    }),
  );
  return fresh;
};

/** What the POS shows for a queued order: the payload dressed as an order. */
export const localOrderView = (entry) => ({
  ...entry.order,
  _id: entry.localId,
  orderNumber: entry.localNumber,
  orderStatus: entry.order.paymentMethod ? COMPLETED : PREPARING,
  createdAt: entry.placedAt,
  offline: true,
});
