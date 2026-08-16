import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Store-scoped shopping cart (§10).
 *
 * ISOLATION: the persistence key includes the store slug, and every read
 * re-validates that the stored payload belongs to the slug currently being
 * viewed. A customer browsing Restaurant A then Restaurant B therefore gets two
 * completely separate carts and can never combine items from both.
 *
 * PRICING: the totals computed here are for DISPLAY ONLY. The backend
 * recalculates every price on checkout (orderPricingService), so a tampered
 * localStorage cart cannot change what the customer is actually charged.
 */

const storageKey = (slug) => `kk_cart_${slug}`;

/** Stable signature for a configured line: same product + same options = same line. */
const lineSignature = (item) => {
  const addons = [...(item.addonIds || [])].sort().join(",");
  const mods = [...(item.modifierSelections || [])]
    .map((m) => `${m.groupId}:${m.optionId}`)
    .sort()
    .join(",");
  return [item.menuId, item.itemId, item.variantId || "", addons, mods, item.note || ""].join("|");
};

const readCart = (slug) => {
  try {
    const raw = localStorage.getItem(storageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Guard against a stale/foreign payload.
    if (!parsed || parsed.slug !== slug || !Array.isArray(parsed.items)) return [];
    return parsed.items;
  } catch (err) {
    return [];
  }
};

const writeCart = (slug, items) => {
  try {
    localStorage.setItem(storageKey(slug), JSON.stringify({ slug, items, savedAt: Date.now() }));
  } catch (err) {
    // Quota exceeded / private mode — the cart simply won't persist.
  }
};

export const useCart = (slug) => {
  const [items, setItems] = useState(() => (slug ? readCart(slug) : []));

  // Switching stores swaps the entire cart rather than merging it.
  useEffect(() => {
    setItems(slug ? readCart(slug) : []);
  }, [slug]);

  useEffect(() => {
    if (slug) writeCart(slug, items);
  }, [slug, items]);

  const addItem = useCallback((line) => {
    setItems((prev) => {
      const signature = lineSignature(line);
      const existing = prev.find((i) => i.signature === signature);
      if (existing) {
        return prev.map((i) =>
          i.signature === signature ? { ...i, quantity: Math.min(30, i.quantity + line.quantity) } : i
        );
      }
      return [...prev, { ...line, signature }];
    });
  }, []);

  const updateQuantity = useCallback((signature, quantity) => {
    setItems((prev) =>
      quantity <= 0
        ? prev.filter((i) => i.signature !== signature)
        : prev.map((i) => (i.signature === signature ? { ...i, quantity: Math.min(30, quantity) } : i))
    );
  }, []);

  const removeItem = useCallback((signature) => {
    setItems((prev) => prev.filter((i) => i.signature !== signature));
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const subtotal = useMemo(
    () => items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
    [items]
  );

  const count = useMemo(() => items.reduce((sum, i) => sum + i.quantity, 0), [items]);

  /**
   * Build the checkout payload — identifiers and quantities ONLY.
   * Deliberately omits prices so it's obvious the server is authoritative.
   */
  const toOrderItems = useCallback(
    () =>
      items.map((i) => ({
        menuId: i.menuId,
        itemId: i.itemId,
        quantity: i.quantity,
        ...(i.variantId ? { variantId: i.variantId } : {}),
        ...(i.addonIds?.length ? { addonIds: i.addonIds } : {}),
        ...(i.modifierSelections?.length ? { modifierSelections: i.modifierSelections } : {}),
        ...(i.note ? { note: i.note } : {}),
      })),
    [items]
  );

  return {
    items,
    count,
    subtotal,
    addItem,
    updateQuantity,
    removeItem,
    clearCart,
    toOrderItems,
  };
};

/** Estimated totals for display; the server recomputes these authoritatively. */
export const estimateTotals = (subtotal, ordering, orderType) => {
  if (!ordering) return { subtotal, tax: 0, deliveryFee: 0, packagingFee: 0, total: subtotal };

  const packagingFee = Number(ordering.packagingFee) || 0;

  let deliveryFee = 0;
  if (orderType === "delivery") {
    deliveryFee = Number(ordering.deliveryFee) || 0;
    const freeAbove = Number(ordering.freeDeliveryAbove) || 0;
    if (freeAbove > 0 && subtotal >= freeAbove) deliveryFee = 0;
  }

  const taxPercent = Number(ordering.taxPercent) || 0;
  const taxableBase = subtotal + packagingFee;
  const tax = taxPercent
    ? ordering.taxInclusive
      ? taxableBase - taxableBase / (1 + taxPercent / 100)
      : (taxableBase * taxPercent) / 100
    : 0;

  const total = subtotal + packagingFee + deliveryFee + (ordering.taxInclusive ? 0 : tax);

  return {
    subtotal: round2(subtotal),
    tax: round2(tax),
    deliveryFee: round2(deliveryFee),
    packagingFee: round2(packagingFee),
    total: round2(total),
  };
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export { lineSignature };
