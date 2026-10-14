/**
 * Re-price held table-QR cart lines from the latest menu payload, whose
 * item.price is the Table price the server bills right now. Without this a
 * line added before a price-rule boundary kept showing the old figure while
 * the bill charged the new one.
 *
 * A chosen variant replaces the item price (its fresh price, else the one it
 * was added at); modifiers add on at the price they were picked at. A line
 * whose item left the menu keeps its price (the server refuses it anyway).
 * Returns the same cart object when nothing changed, so a setState with it
 * cannot loop.
 */
export function repriceCart(cart, menuItems) {
  const byId = new Map((menuItems || []).map((i) => [String(i._id), i]));
  let next = null;
  for (const [key, line] of Object.entries(cart || {})) {
    const fresh = byId.get(String(line.item?._id));
    if (!fresh) continue;
    let base = Number(fresh.price) || 0;
    if (line.variant) {
      const v = (fresh.variants || []).find((x) => String(x._id) === String(line.variant.variantId));
      base = Number((v || line.variant).price) || 0;
    }
    const unitPrice = (line.modifiers || []).reduce(
      (s, m) => s + (Number(m.price) || 0) * (Number(m.quantity) || 1),
      base,
    );
    if (unitPrice === line.unitPrice) continue;
    next = next || { ...cart };
    next[key] = { ...line, unitPrice };
  }
  return next || cart;
}
