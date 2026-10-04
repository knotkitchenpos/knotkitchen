/**
 * One basket at a time on Knot Eats.
 *
 * Each store's lines stay where the store website keeps them
 * (hooks/useCart.js, `kk_cart_v1:<storeId>`), so the store page, its cart and
 * checkout are the website's own. This only remembers WHICH store holds the
 * basket, for the cart pill and the "start a new cart?" question.
 *
 * No JSX, no import.meta.env; every storage access is guarded (private mode,
 * blocked storage) and simply forgets.
 */

const ACTIVE_KEY = "ke_active_cart_v1";
const cartKey = (storeId) => `kk_cart_v1:${storeId}`;
const storage = () => globalThis.localStorage;

const readJson = (key, fallback) => {
  try {
    return JSON.parse(storage().getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
};

/** The store holding a non-empty basket: { storeId, name, count }, or null. */
export function getActiveCart() {
  const active = readJson(ACTIVE_KEY, null);
  if (!active?.storeId) return null;
  const lines = readJson(cartKey(active.storeId), []);
  const count = Array.isArray(lines) ? lines.reduce((n, l) => n + (Number(l?.quantity) || 0), 0) : 0;
  return count > 0 ? { storeId: active.storeId, name: active.name || "", count } : null;
}

export function setActiveCart({ storeId, name }) {
  try {
    storage().setItem(ACTIVE_KEY, JSON.stringify({ storeId, name: name || "" }));
  } catch {
    /* no storage: no pill, no question */
  }
}

/** Empty a store's basket, and forget it as the active one. */
export function clearCartFor(storeId) {
  try {
    storage().removeItem(cartKey(storeId));
    if (readJson(ACTIVE_KEY, null)?.storeId === storeId) storage().removeItem(ACTIVE_KEY);
  } catch {
    /* nothing stored, nothing to clear */
  }
}

/**
 * The store page's cart, with an `addItem` that asks before a dish from this
 * store replaces another store's basket. `confirmReplace(active)` resolves
 * true to start over here; false keeps the other basket and drops the dish.
 */
export function guardCart(cart, { storeId, name }, confirmReplace) {
  const addItem = (line) => {
    const active = getActiveCart();
    if (active && active.storeId !== storeId) {
      Promise.resolve(confirmReplace(active)).then((ok) => {
        if (!ok) return;
        clearCartFor(active.storeId);
        setActiveCart({ storeId, name });
        cart.addItem(line);
      });
      return;
    }
    setActiveCart({ storeId, name });
    cart.addItem(line);
  };
  return { ...cart, addItem };
}
