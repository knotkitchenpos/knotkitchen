/**
 * The two labels the POS kept getting wrong, in one place.
 *
 * Both of these were duplicated per screen, and the copies disagreed — which
 * is exactly how the same order came to read "POS" on the Orders page and
 * "Outside" in Reports.
 */

/**
 * What to call a table.
 *
 * Restaurants name their tables ("GF1", "Terrace 2"); the database also keeps
 * a numeric `tableNumber` for ordering and uniqueness. Screens were printing
 * the NUMBER, so staff saw "Table 1" for a table everyone on the floor calls
 * GF1. Prefer the name the restaurant chose; fall back to the number only
 * when they never set one.
 *
 * Accepts a populated table object, a bare session/order payload carrying
 * `displayId` / `tableNumber`, or nothing.
 */
export const tableLabel = (table, fallback = "") => {
  if (!table || typeof table === "string") return fallback;
  const named = String(table.displayId || table.tableName || "").trim();
  if (named) return named;
  const number = table.tableNumber ?? table.tableNo ?? table.name;
  return number != null && String(number).trim() !== "" ? `Table ${number}` : fallback;
};

/**
 * Where an order came from.
 *
 * "Outside" means a third-party delivery platform — Swiggy, Zomato — and
 * nothing else. It used to be the catch-all for every source that wasn't POS
 * or WEBSITE, so a table QR order (ours) was reported as an outside order,
 * and the Reports row disagreed with the Orders page about the very same
 * order. Only MARKETPLACE is outside; everything else is a channel we run.
 *
 * This mirrors the backend rule in orderController.buildReportBuckets. If one
 * changes, change both.
 */
export const sourceLabel = (src) => {
  switch (String(src || "").toUpperCase()) {
    case "MARKETPLACE":
      return "Outside";
    case "WEBSITE":
      return "Website";
    case "QR":
      return "Table QR";
    case "PHONE":
      return "Phone";
    default:
      // POS, blank, and any internal source added later. A new channel of
      // ours must never silently inflate the marketplace figure.
      return "POS";
  }
};

/**
 * The one identifier an order is known by, everywhere.
 *
 * Screens derived this ad hoc and the copies disagreed: the Orders header cut
 * the last SIX characters of the id while the "Order ID" field two panels down
 * cut the last EIGHT, so one order showed as #7CA1AC and 657CA1AC on the same
 * screen. The receipt then preferred the table's sessionCode, giving a third
 * answer on the e-bill.
 *
 * `orderNumber` is the real number once the counter has issued one. The id
 * suffix is only the fallback for orders written before that, and the length
 * of that slice is the whole reason this function exists -- never inline it.
 */
const ORDER_ID_FALLBACK_LEN = 6;

export const orderDisplayId = (order, fallback = "N/A") => {
  if (!order) return fallback;
  const issued = String(order.orderNumber || "").trim();
  if (issued) return issued;
  const id = String(order._id || order.orderId || order.id || "");
  return id ? id.slice(-ORDER_ID_FALLBACK_LEN).toUpperCase() : fallback;
};
