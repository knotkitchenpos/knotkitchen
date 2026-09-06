/**
 * GET /r/:token -- the customer-facing bill.
 *
 * No login: the signed token in the URL is the whole authorisation (see
 * services/receiptLink.js). Rendered here as plain HTML rather than routed
 * into one of the SPAs, because it is a single static page with no session
 * and every one of those apps is otherwise entirely behind a sign-in.
 *
 * Everything interpolated below is escaped. Item names, the customer name and
 * the store name are all operator- or diner-supplied, and this is the one page
 * in the system a stranger can open with a link.
 */

const Order = require("../models/orderModel");
const Bill = require("../models/billModel");
const TableSession = require("../models/tableSessionModel");
const Restaurant = require("../models/restaurantModel");
const { buildReceipt } = require("../services/receiptService");
const { readToken } = require("../services/receiptLink");

const esc = (value) =>
  String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const money = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const page = (title, body) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; padding:20px 14px 40px; background:#F1F5F9; color:#0F172A;
         font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .card { max-width:440px; margin:0 auto; background:#fff; border-radius:16px;
          box-shadow:0 1px 3px rgba(15,23,42,.12); overflow:hidden; }
  .head { padding:22px 20px 18px; text-align:center; border-bottom:1px dashed #CBD5E1; }
  .head h1 { margin:0; font-size:19px; font-weight:800; letter-spacing:.2px; }
  .head p { margin:4px 0 0; font-size:12.5px; color:#64748B; }
  .pill { display:inline-block; margin-top:10px; padding:4px 12px; border-radius:999px;
          font-size:11.5px; font-weight:800; letter-spacing:.4px; }
  .paid { background:#DCFCE7; color:#15803D; }
  .due  { background:#FEF3C7; color:#B45309; }
  .meta { padding:14px 20px; border-bottom:1px dashed #CBD5E1; }
  .row { display:flex; justify-content:space-between; gap:12px; font-size:13px; margin:5px 0; }
  .row span:first-child { color:#64748B; }
  .row span:last-child { font-weight:600; text-align:right; }
  .items { padding:14px 20px; border-bottom:1px dashed #CBD5E1; }
  .item { display:flex; justify-content:space-between; gap:12px; margin:9px 0; font-size:13.5px; }
  .item .n { flex:1; min-width:0; }
  .item .q { color:#64748B; font-size:12px; }
  .item .p { font-weight:700; white-space:nowrap; }
  .mods { margin:2px 0 0; padding-left:12px; font-size:11.5px; color:#64748B; }
  .totals { padding:14px 20px; }
  .grand { display:flex; justify-content:space-between; font-size:17px; font-weight:800;
           border-top:2px solid #0F172A; padding-top:10px; margin-top:8px; }
  .foot { text-align:center; padding:16px 20px 20px; font-size:11.5px; color:#94A3B8; }
  .empty { max-width:440px; margin:60px auto; text-align:center; color:#64748B; }
  .empty h1 { font-size:18px; color:#0F172A; }
</style>
</head><body>${body}</body></html>`;

const notFound = () =>
  page(
    "Receipt unavailable",
    `<div class="empty"><h1>Receipt unavailable</h1>
     <p>This link is not valid, or the bill it points to has been removed.<br>
     Please ask the restaurant to send it again.</p></div>`,
  );

const render = (receipt) => {
  const r = receipt;
  const paid = r.paymentStatus === "PAID";

  const when = new Date(r.dateTime).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });

  const items = r.items
    .map((i) => {
      const mods = (i.modifiers || [])
        .map((m) => esc(m.optionName || m.name || ""))
        .filter(Boolean)
        .join(", ");
      return `<div class="item">
        <div class="n">${esc(i.name)}
          <div class="q">${Number(i.quantity)} × ${money(i.price)}</div>
          ${mods ? `<div class="mods">+ ${mods}</div>` : ""}
        </div>
        <div class="p">${money(i.total)}</div>
      </div>`;
    })
    .join("");

  const line = (label, value) =>
    `<div class="row"><span>${esc(label)}</span><span>${value}</span></div>`;

  return page(
    `${r.restaurant.name} — Bill ${r.orderNumber}`,
    `<div class="card">
      <div class="head">
        <h1>${esc(r.restaurant.name)}</h1>
        ${r.restaurant.address && r.restaurant.address !== "N/A" ? `<p>${esc(r.restaurant.address)}</p>` : ""}
        <div class="pill ${paid ? "paid" : "due"}">${paid ? "PAID" : "PAYMENT DUE"}</div>
      </div>
      <div class="meta">
        ${line("Order No.", esc(r.orderNumber))}
        ${line("Date", esc(when))}
        ${r.tableOrder ? line("Table", esc(r.tableOrder.tableNumber)) : ""}
        ${r.customerInformation && r.customerInformation.name ? line("Customer", esc(r.customerInformation.name)) : ""}
        ${paid ? line("Payment", esc(r.paymentMethod)) : ""}
      </div>
      <div class="items">${items || `<p class="q">No items on this bill.</p>`}</div>
      <div class="totals">
        ${line("Subtotal", money(r.subtotal))}
        ${Number(r.charges) ? line("Charges", money(r.charges)) : ""}
        ${Number(r.taxes) ? line("Tax", money(r.taxes)) : ""}
        <div class="grand"><span>Total</span><span>${money(r.total)}</span></div>
      </div>
      <div class="foot">${Number(r.quantities)} item(s) · Powered by KnotKitchen</div>
    </div>`,
  );
};

const viewPublicReceipt = async (req, res) => {
  // Never `next(err)` from here: the global handler answers in JSON, and a
  // customer who taps this link should get a page either way.
  try {
    const parsed = readToken(req.params.token);
    if (!parsed) return res.status(404).type("html").send(notFound());

    let order = null;
    let tableSession = null;
    let bill = null;
    let restaurantId = null;

    if (parsed.isOrder) {
      order = await Order.findOne({ _id: parsed.id, isDeleted: { $ne: true } });
      if (!order) return res.status(404).type("html").send(notFound());
      bill = await Bill.findOne({ orderId: order._id, isDeleted: { $ne: true } });
      restaurantId = order.restaurantId;
    } else {
      tableSession = await TableSession.findOne({ _id: parsed.id, isDeleted: { $ne: true } })
        .populate("tableId");
      if (!tableSession) return res.status(404).type("html").send(notFound());
      if (tableSession.billId) bill = await Bill.findById(tableSession.billId);
      restaurantId = tableSession.restaurantId;
    }

    const restaurant = restaurantId ? await Restaurant.findById(restaurantId) : null;
    const receipt = buildReceipt({ order, tableSession, bill, restaurant });

    // A bill is not a public document to be indexed or cached at the edge.
    res.set("Cache-Control", "no-store, private");
    res.set("X-Robots-Tag", "noindex, nofollow");
    return res.status(200).type("html").send(render(receipt));
  } catch (err) {
    console.error("[PublicReceipt] render failed:", err && err.message);
    return res.status(404).type("html").send(notFound());
  }
};

module.exports = { viewPublicReceipt, render, esc, money };
