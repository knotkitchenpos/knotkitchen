import { printHtmlDocument } from "./printDocument";
import { itemExtras, resolveItemAmounts } from "./orderItems";

/**
 * Open a printable receipt document.
 *
 * The receipt HEADER must show the RESTAURANT / STORE name — never a
 * hardcoded "KnotKitchen" and never the logged-in staff/owner name (see
 * BUG 3 & BUG 6 in the QA report). Callers should pass `restaurantName`
 * (and, optionally, `restaurantAddress` / `restaurantPhone`) sourced from
 * the authenticated /api/restaurant/me or /api/restaurant/properties
 * response so a Store-A user can never accidentally print Store-B's
 * branding.
 *
 * If the caller omits `restaurantName` we fall back to a neutral
 * "Restaurant Receipt" label rather than a made-up brand name — better
 * to show a generic string than to lie about which store issued the
 * bill.
 */
export const printReceipt = ({
  cartData,
  customerData,
  total,
  tax,
  totalPriceWithTax,
  restaurantName,
  restaurantAddress,
  restaurantPhone,
}) => {
  const safeCartData = Array.isArray(cartData) ? cartData : [];
  const safeCustomerData = customerData || {};
  const safeTotal = Number(total || 0);
  const safeTax = Number(tax || 0);
  const safeTotalWithTax = Number(totalPriceWithTax || 0);

  // Escape untrusted string values before injecting into HTML so a
  // maliciously-named store or menu item can't inject markup / scripts
  // into the print window.
  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const storeName = esc(restaurantName) || "Restaurant Receipt";
  const storeAddress = esc(restaurantAddress);
  const storePhone = esc(restaurantPhone);

  const date = new Date().toLocaleString("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  // The money column is the LINE amount, so the rows add up to the subtotal
  // printed below them. Reading `item.price` showed the unit price on new
  // orders and the line total on ones saved before the two were told apart.
  const itemsHTML = safeCartData
    .map((item) => {
      const { quantity, lineTotal } = resolveItemAmounts(item);
      // Extras are priced into the line, so a receipt that omits them shows a
      // number the diner cannot account for. One row each, indented under the
      // dish, with its own price -- the same shape as the till's cart.
      const extraRows = itemExtras(item)
        .map((e) => {
          const label = e.quantity > 1 ? `${e.quantity}x ${e.name}` : e.name;
          const cost = e.price * e.quantity * quantity;
          return `<tr><td style="padding:0 0 4px 12px;font-size:11px;color:#333;">${esc(label)}</td><td></td><td style="padding:0 0 4px 0;font-size:11px;color:#333;text-align:right;">${cost ? `Rs.${cost.toFixed(2)}` : ""}</td></tr>`;
        })
        .join("");
      return `<tr><td style="padding:6px 0 2px 0;font-size:12px;">${esc(item.name)}</td><td style="padding:6px 0 2px 0;font-size:12px;text-align:center;">x${quantity}</td><td style="padding:6px 0 2px 0;font-size:12px;text-align:right;">Rs.${lineTotal.toFixed(2)}</td></tr>${extraRows}`;
    })
    .join("");

  const receiptHTML = `<!DOCTYPE html><html><head><title>${storeName} Receipt</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;width:300px;margin:0 auto;padding:20px;color:#000;background:#fff}.header{text-align:center;margin-bottom:15px}.header h1{font-size:18px;letter-spacing:1px;}.header p{font-size:10px;color:#333;margin-top:4px}.divider{border-top:1px dashed #000;margin:10px 0}.info-row{display:flex;justify-content:space-between;font-size:11px;margin:3px 0}.items-table{width:100%;border-collapse:collapse;margin-top:5px}.items-table th{font-size:11px;text-align:left;border-bottom:1px solid #000;padding-bottom:5px}.items-table td{border-bottom:1px dotted #ccc}.totals{margin-top:10px}.total-row{display:flex;justify-content:space-between;font-size:12px;margin:4px 0}.grand-total{display:flex;justify-content:space-between;font-size:15px;font-weight:bold;border-top:2px solid #000;padding-top:8px;margin-top:6px}.footer{text-align:center;margin-top:20px;font-size:10px;color:#333}@media print{body{width:300px}}</style></head><body><div class="header"><h1>${storeName}</h1>${storeAddress ? `<p>${storeAddress}</p>` : ""}${storePhone ? `<p>${storePhone}</p>` : ""}<p>${date}</p></div><div class="divider"></div><div class="info-row"><span>Customer:</span><span><strong>${esc(safeCustomerData.customerName) || "Walk-in"}</strong></span></div><div class="info-row"><span>Phone:</span><span>${esc(safeCustomerData.customerPhone) || "N/A"}</span></div>${safeCustomerData.guests ? `<div class="info-row"><span>Guests:</span><span>${Number(safeCustomerData.guests) || 0}</span></div>` : ""}<div class="info-row"><span>Order ID:</span><span>#${esc(safeCustomerData.orderId) || "N/A"}</span></div>${safeCustomerData.table?.tableNo ? `<div class="info-row"><span>Table:</span><span>${esc(safeCustomerData.table.tableNo)}</span></div>` : ""}<div class="divider"></div><table class="items-table"><thead><tr><th>Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Price</th></tr></thead><tbody>${itemsHTML}</tbody></table><div class="divider"></div><div class="totals"><div class="total-row"><span>Subtotal</span><span>Rs.${safeTotal.toFixed(2)}</span></div><div class="total-row"><span>Tax</span><span>Rs.${safeTax.toFixed(2)}</span></div><div class="grand-total"><span>Total</span><span>Rs.${safeTotalWithTax.toFixed(2)}</span></div></div><div class="divider"></div><div class="footer"><p>Thank you for dining with us!</p><p>Please visit again :)</p></div></body></html>`;

  return printHtmlDocument(receiptHTML);
};
