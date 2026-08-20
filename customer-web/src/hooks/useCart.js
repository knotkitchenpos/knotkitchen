import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Cart hook.
 *
 * The cart lives entirely in the browser. Every price shown is an ESTIMATE —
 * the backend re-prices the order server-side from the same product IDs, so a
 * customer manipulating localStorage cannot change what they get charged
 * (§10 of the spec). Persisted per-store so switching between restaurants
 * doesn't cross-contaminate line items.
 */
const storageKey = (slug) => `kk_cart_v1:${slug || "default"}`;

const readStore = (slug) => {
  try {
    const raw = window.localStorage.getItem(storageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeStore = (slug, items) => {
  try {
    window.localStorage.setItem(storageKey(slug), JSON.stringify(items));
  } catch {
    /* localStorage disabled (private mode) — cart is memory-only that session. */
  }
};

/**
 * Build a stable signature for a line item so add-to-cart of the same product
 * + same variant + same modifiers increments quantity instead of duplicating.
 */
const lineSignature = (line) =>
  [
    line.menuId,
    line.itemId,
    line.variant?.variantId || "",
    (line.addons || []).map((a) => a.addonId).sort().join(","),
    (line.modifierSelections || []).map((m) => `${m.groupId}:${m.optionId}`).sort().join(","),
    line.note || "",
  ].join("|");

export function useCart(slug) {
  const [items, setItems] = useState(() => readStore(slug));

  useEffect(() => {
    setItems(readStore(slug));
  }, [slug]);

  useEffect(() => {
    writeStore(slug, items);
  }, [slug, items]);

  const addItem = useCallback((line) => {
    setItems((prev) => {
      const sig = lineSignature(line);
      const idx = prev.findIndex((l) => lineSignature(l) === sig);
      if (idx === -1) return [...prev, { ...line, quantity: line.quantity || 1 }];
      const next = [...prev];
      next[idx] = { ...next[idx], quantity: (next[idx].quantity || 1) + (line.quantity || 1) };
      return next;
    });
  }, []);

  const updateQuantity = useCallback((sig, quantity) => {
    setItems((prev) => {
      if (quantity <= 0) return prev.filter((l) => lineSignature(l) !== sig);
      return prev.map((l) => (lineSignature(l) === sig ? { ...l, quantity } : l));
    });
  }, []);

  const removeItem = useCallback((sig) => {
    setItems((prev) => prev.filter((l) => lineSignature(l) !== sig));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const subtotal = useMemo(
    () => items.reduce((sum, i) => sum + (Number(i.unitPrice) || Number(i.price) || 0) * i.quantity, 0),
    [items]
  );

  const count = useMemo(
    () => items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0),
    [items]
  );

  /**
   * Serialize the cart for /api/storefront/:slug/orders. We send ONLY the
   * identifiers + quantities; the backend fetches the current price from the
   * database and computes the total.
   */
  const toOrderItems = useCallback(
    () =>
      items.map((l) => ({
        menuId: l.menuId,
        itemId: l.itemId,
        quantity: l.quantity,
        variantId: l.variant?.variantId || null,
        addons: (l.addons || []).map((a) => a.addonId),
        modifierSelections: (l.modifierSelections || []).map((m) => ({
          groupId: m.groupId,
          optionId: m.optionId,
        })),
        note: l.note || "",
      })),
    [items]
  );

  return {
    items,
    addItem,
    updateQuantity,
    removeItem,
    clear,
    subtotal,
    count,
    toOrderItems,
    lineSignature,
  };
}
