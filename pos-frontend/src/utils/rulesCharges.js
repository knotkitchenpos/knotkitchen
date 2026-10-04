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
