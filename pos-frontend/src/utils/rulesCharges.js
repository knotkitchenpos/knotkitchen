/**
 * Coupons, free items, distance slabs and the minimum order belong to
 * Settings > Rules & Charges, and only that screen sends them. Any other
 * full-settings save (Manage Website) leaves them out, so an editor that
 * loaded them a while ago cannot write its stale copy back over newer rules.
 */
export const withoutRulesKeys = (settings) => {
  const out = { ...settings, ordering: { ...settings?.ordering } };
  delete out.couponsConfig;
  delete out.freeItemConfig;
  delete out.ordering.deliverySlabsConfig;
  delete out.ordering.minOrderConfig;
  return out;
};

const rowName = (r) =>
  r?.code || r?.itemName || (r?.maxKm !== undefined ? `${r.minKm}–${r.maxKm} km` : "");

/**
 * The server's fieldErrors ({ "couponsConfig.2.code": "Use 3 to 20 ..." }) as
 * lines naming the row they are about, read from the body that was sent:
 * "SAVE-10: Use 3 to 20 letters or digits."
 */
export const fieldErrorLines = (fieldErrors, sent) =>
  Object.entries(fieldErrors || {}).map(([key, msg]) => {
    const rowPath = key.match(/^(.*\.\d+)(?:\.|$)/)?.[1];
    const name = rowPath ? rowName(rowPath.split(".").reduce((o, p) => o?.[p], sent)) : "";
    return name ? `${name}: ${msg}` : msg;
  });

/** How far the store delivers when it prices delivery by distance (the server's default is 7 km). */
export const deliveryMaxKm = (ordering) => Number(ordering?.deliverySlabsConfig?.maxDistanceKm || 7);

/** True when Rules & Charges prices delivery by distance, so staff must enter the km. */
export const hasDeliverySlabs = (ordering) => (ordering?.deliverySlabsConfig?.slabs || []).length > 0;

/**
 * The till's delivery charge, by the rule addOrder applies on the server
 * (distanceService.computeDeliveryFeeFromSlabs): with distance slabs, the km
 * staff entered picks the slab; without them, the flat fee. Free once the
 * subtotal reaches freeDeliveryAbove. null while the km is still needed (or is
 * past the store's limit), so the cart can say so instead of showing "Free".
 */
export const deliveryFeeFor = ({ ordering = {}, distanceKm, subtotal = 0 }) => {
  const flat = Math.max(0, Number(ordering.deliveryFee) || 0);
  let fee = flat;
  if (hasDeliverySlabs(ordering)) {
    const km = distanceKm === "" || distanceKm == null ? NaN : Number(distanceKm);
    if (!(km >= 0) || km > deliveryMaxKm(ordering)) return null;
    const slabs = ordering.deliverySlabsConfig.slabs;
    const hit = slabs.find((s) => km >= Number(s.minKm) && km <= Number(s.maxKm));
    const top = [...slabs].sort((a, b) => Number(b.maxKm) - Number(a.maxKm))[0];
    if (hit) fee = Number(hit.fee) || 0;
    else if (km > Number(top.maxKm)) fee = Number(top.fee) || flat;
  }
  const freeAbove = Number(ordering.freeDeliveryAbove) || 0;
  return freeAbove > 0 && subtotal >= freeAbove ? 0 : fee;
};
