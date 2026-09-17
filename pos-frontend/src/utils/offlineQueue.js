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

/** Queue an order; returns the entry (with localId and a local order number). */
export const enqueueOrder = (order) => {
  const q = readQueue();
  const n = q.length + 1;
  const entry = {
    localId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
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

/** What the POS shows for a queued order: the payload dressed as an order. */
export const localOrderView = (entry) => ({
  ...entry.order,
  _id: entry.localId,
  orderNumber: entry.localNumber,
  orderStatus: entry.order.paymentMethod ? COMPLETED : PREPARING,
  createdAt: entry.placedAt,
  offline: true,
});
