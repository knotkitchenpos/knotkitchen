import { printHtmlDocument } from "./printDocument";

/**
 * Open the current POS cart as a compact printable receipt.
 * The UI owns notifications; this helper only handles the print document.
 */
export const printReceipt = ({ cartData, customerData, total, tax, totalPriceWithTax }) => {
  const safeCartData = Array.isArray(cartData) ? cartData : [];
  const safeCustomerData = customerData || {};
  const safeTotal = Number(total || 0);
  const safeTax = Number(tax || 0);
  const safeTotalWithTax = Number(totalPriceWithTax || 0);

  const date = new Date().toLocaleString("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const itemsHTML = safeCartData
    .map(
      (item) =>
        `<tr><td style="padding:6px 0;font-size:12px;">${item.name}</td><td style="padding:6px 0;font-size:12px;text-align:center;">x${item.quantity}</td><td style="padding:6px 0;font-size:12px;text-align:right;">Rs.${Number(item.price || 0).toFixed(2)}</td></tr>`
    )
    .join("");
  const receiptHTML = `<!DOCTYPE html><html><head><title>KnotKitchen Receipt</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;width:300px;margin:0 auto;padding:20px;color:#000;background:#fff}.header{text-align:center;margin-bottom:15px}.header h1{font-size:20px}.header p{font-size:10px;color:#555;margin-top:4px}.divider{border-top:1px dashed #000;margin:10px 0}.info-row{display:flex;justify-content:space-between;font-size:11px;margin:3px 0}.items-table{width:100%;border-collapse:collapse;margin-top:5px}.items-table th{font-size:11px;text-align:left;border-bottom:1px solid #000;padding-bottom:5px}.items-table td{border-bottom:1px dotted #ccc}.totals{margin-top:10px}.total-row{display:flex;justify-content:space-between;font-size:12px;margin:4px 0}.grand-total{display:flex;justify-content:space-between;font-size:15px;font-weight:bold;border-top:2px solid #000;padding-top:8px;margin-top:6px}.footer{text-align:center;margin-top:20px;font-size:10px;color:#555}@media print{body{width:300px}}</style></head><body><div class="header"><h1>KnotKitchen</h1><p>Restaurant POS System</p><p>${date}</p></div><div class="divider"></div><div class="info-row"><span>Customer:</span><span><strong>${safeCustomerData.customerName || "Walk-in"}</strong></span></div><div class="info-row"><span>Phone:</span><span>${safeCustomerData.customerPhone || "N/A"}</span></div><div class="info-row"><span>Guests:</span><span>${safeCustomerData.guests || 0}</span></div><div class="info-row"><span>Order ID:</span><span>#${safeCustomerData.orderId || "N/A"}</span></div><div class="info-row"><span>Table:</span><span>${safeCustomerData.table?.tableNo || "N/A"}</span></div><div class="divider"></div><table class="items-table"><thead><tr><th>Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Price</th></tr></thead><tbody>${itemsHTML}</tbody></table><div class="divider"></div><div class="totals"><div class="total-row"><span>Subtotal</span><span>Rs.${safeTotal.toFixed(2)}</span></div><div class="total-row"><span>Tax (5.25%)</span><span>Rs.${safeTax.toFixed(2)}</span></div><div class="grand-total"><span>Total</span><span>Rs.${safeTotalWithTax.toFixed(2)}</span></div></div><div class="divider"></div><div class="footer"><p>Thank you for dining with us!</p><p>Please visit again :)</p></div></body></html>`;

  return printHtmlDocument(receiptHTML);
};