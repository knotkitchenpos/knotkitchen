/**
 * Orders placed on this device, newest first, for Saved > Recent orders.
 *
 * There are no accounts: the signed `v_` token from checkout is the only way
 * back to an order, so it is kept here (§6.1). At most 10; a private window
 * or blocked storage simply remembers nothing.
 */

const KEY = "ke_orders_v1";
const MAX = 10;

/** [{ token, orderNumber, storeName, storeId, placedAt }] */
export function recentOrders() {
  try {
    const list = JSON.parse(globalThis.localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list.filter((o) => o?.token).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/**
 * A new order goes first. One already listed keeps its place and gains any
 * field it lacked: checkout often confirms before the store's name has loaded,
 * and the order page fills it in.
 */
export function addRecentOrder({ token, orderNumber, storeName, storeId, placedAt }) {
  if (!token) return;
  const fields = Object.fromEntries(Object.entries({ orderNumber, storeName, storeId, placedAt }).filter(([, v]) => v));
  try {
    const list = recentOrders();
    const known = list.some((o) => o.token === token);
    const next = known
      ? list.map((o) => (o.token === token ? { ...o, ...fields } : o))
      : [{ token, orderNumber: "", storeName: "", storeId: "", placedAt: new Date().toISOString(), ...fields }, ...list].slice(0, MAX);
    globalThis.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* not remembered on this device */
  }
}
