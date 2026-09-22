import { billableItems, itemDisplayName, itemExtras, resolveItemAmounts } from "./orderItems.js";
import { orderDisplayId, tableLabel } from "./orderLabels.js";
import { inr } from "./index.js";

/**
 * The printed receipt, laid out in printer dots for one paper width.
 *
 * Thermal printers print a bitmap 384 dots wide on 58 mm paper and 576 on
 * 80 mm (203 dpi). The receipt is laid out at exactly that width and drawn to
 * a canvas, so the same picture goes to a USB or Bluetooth printer as raster
 * data and, through the system print dialog, to anything else. Printer fonts
 * were not an option: they have no rupee sign and no Hindi.
 *
 * Pure: `measure(text, font)` is passed in, so this runs (and is tested)
 * without a browser. The result is a list of draw operations, every one of
 * which stays inside [0, width].
 */

export const PAPER = {
  58: { width: 384, body: 20, small: 17, title: 28, gap: 14, pad: 4 },
  80: { width: 576, body: 24, small: 20, title: 34, gap: 20, pad: 6 },
};

export const paperOf = (size) => PAPER[String(size) === "58" ? 58 : 80];

const FAMILY = "Arial, Helvetica, sans-serif";
export const font = (size, bold = false) => `${bold ? "bold " : ""}${size}px ${FAMILY}`;

// The rate and price columns carry no symbol; only the totals block does.
const num = (n) => inr(n).slice(1);
export const rupees = inr;

/** Split text into lines no wider than `maxWidth`; a word too long for a line is broken. */
export const wrap = (text, fnt, maxWidth, measure) => {
  const lines = [];
  for (const paragraph of String(text ?? "").split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, fnt) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      let rest = word;
      while (measure(rest, fnt) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && measure(rest.slice(0, cut), fnt) > maxWidth) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    if (line) lines.push(line);
  }
  return lines;
};

const ORDER_TYPES = { delivery: "Delivery", "dine-in": "Table", collection: "Collection", takeaway: "Collection" };

/**
 * The lines of money under the items. Subtotal always; the rest only when
 * they are not zero, and Total only when something changed the subtotal.
 */
export const billLines = (bills = {}, itemsSubtotal = 0, { gstSplit = false } = {}) => {
  const subtotal = Number(bills.subtotal || bills.total || itemsSubtotal || 0);
  const lines = [{ label: "Subtotal", amount: subtotal, strong: true }];
  const add = (label, value, sign = "") => {
    if (Number(value) > 0) lines.push({ label, amount: Number(value), sign });
  };
  add("Discount", bills.discount, "- ");
  add("Packing charge", bills.packagingFee);
  add("Delivery charge", bills.deliveryFee);
  // A GST-registered store shows the intra-state split the buyer needs to
  // claim credit; anyone else just "GST".
  const tax = Number(bills.tax) || 0;
  const pct = Number(bills.taxPercent) || 0;
  if (tax > 0 && gstSplit) {
    const half = Math.round((tax / 2) * 100) / 100;
    const at = pct ? ` @ ${(pct / 2).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%` : "";
    lines.push({ label: `CGST${at}`, amount: half });
    lines.push({ label: `SGST${at}`, amount: Math.round((tax - half) * 100) / 100 });
  } else {
    add(pct ? `GST @ ${pct.toLocaleString("en-IN", { maximumFractionDigits: 2 })}%` : "GST", tax);
  }
  // After the tax: the service charge is on the taxed bill and is not taxed.
  add("Service charge", bills.serviceCharge);
  const total = Number(bills.totalWithTax || bills.total || subtotal);
  if (Math.abs(total - subtotal) > 0.004) lines.push({ label: "Total", amount: total, strong: true, big: true });
  if (Number(bills.tip) > 0) {
    lines.push({ label: "Tip", amount: Number(bills.tip) });
    lines.push({ label: "Paid", amount: Math.round((total + Number(bills.tip)) * 100) / 100, strong: true });
  }
  return lines;
};

/**
 * Lay out a receipt.
 *
 * @param {object} args
 * @param {object} args.order     a saved order
 * @param {object} args.store     { name, address, phone, gstNumber }
 * @param {object} args.settings  posSettings: customMessage, showWebsiteLink, websiteLink, showQrCode, showLogo
 * @param {object} args.images    { logo: {width,height}|null, qr: {width,height}|null } -- already loaded
 * @param {58|80}  args.paper
 * @param {(text: string, font: string) => number} args.measure
 * @returns {{ width: number, height: number, ops: object[] }}
 */
export const layoutReceipt = ({ order = {}, store = {}, settings = {}, images = {}, paper = 80, measure }) => {
  const P = paperOf(paper);
  const W = P.width;
  const inner = W - P.pad * 2;
  const ops = [];
  let y = P.pad * 2;

  const text = (value, { size = P.body, bold = false, align = "left", x = P.pad, width = inner } = {}) => {
    const fnt = font(size, bold);
    const lines = wrap(value, fnt, width, measure);
    for (const line of lines) {
      const tx = align === "center" ? x + width / 2 : align === "right" ? x + width : x;
      ops.push({ type: "text", text: line, x: tx, y, font: fnt, align });
      y += Math.round(size * 1.3);
    }
    return lines.length;
  };
  const rule = (dashed = true, space = 8) => {
    y += space;
    ops.push({ type: "line", x1: P.pad, x2: W - P.pad, y, dashed, thickness: dashed ? 2 : 3 });
    y += space + 3;
  };
  const image = (key, box, maxW, maxH) => {
    if (!box || !box.width || !box.height) return;
    const scale = Math.min(maxW / box.width, maxH / box.height, 1);
    const w = Math.max(1, Math.round(box.width * scale));
    const h = Math.max(1, Math.round(box.height * scale));
    ops.push({ type: "image", key, x: Math.round((W - w) / 2), y, width: w, height: h });
    y += h + 10;
  };
  /** Label on the left, value on the right; the value wraps under itself if long. */
  const pair = (label, value, { size = P.small, bold = false } = {}) => {
    if (value === undefined || value === null || String(value).trim() === "") return;
    const fnt = font(size, bold);
    const labelW = Math.ceil(measure(`${label} `, fnt));
    const valueLines = wrap(String(value), fnt, inner - labelW, measure);
    ops.push({ type: "text", text: label, x: P.pad, y, font: fnt, align: "left" });
    for (const line of valueLines) {
      ops.push({ type: "text", text: line, x: W - P.pad, y, font: fnt, align: "right" });
      y += Math.round(size * 1.3);
    }
  };

  // ---- Header ----
  if (settings.showLogo !== false) image("logo", images.logo, inner * 0.6, P.width === 384 ? 96 : 128);
  text(store.name || "Restaurant", { size: P.title, bold: true, align: "center" });
  y += 2;
  if (store.address) text(store.address, { size: P.small, align: "center" });
  if (store.phone) text(`Ph: ${store.phone}`, { size: P.small, align: "center" });
  if (store.gstNumber) text(`GSTIN: ${store.gstNumber}`, { size: P.small, align: "center" });
  rule(true);

  // ---- Order details ----
  const placed = new Date(order.orderDate || order.createdAt || Date.now());
  pair("Order", `#${orderDisplayId(order)}`, { bold: true });
  pair(
    "Date",
    placed.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }),
  );
  const type = ORDER_TYPES[String(order.orderType || "").toLowerCase()];
  const table = tableLabel(order.table);
  pair("Type", [type, table].filter(Boolean).join(" · "));
  pair("Customer", order.customerDetails?.name);
  pair("Phone", order.customerDetails?.phone);
  // B2B bill: who it is made out to, and their GSTIN.
  const buyerCompany = String(order.customerDetails?.company || "").trim();
  const buyerGstin = String(order.customerDetails?.gstin || "").trim();
  if (buyerCompany || buyerGstin) {
    pair("Bill to", buyerCompany || "Registered buyer", { bold: true });
    pair("Buyer GSTIN", buyerGstin);
  }
  rule(true);

  // ---- Items: Item | Rate | Qty | Price ----
  // Cancelled lines were not sold and are not on the bill.
  const rows = billableItems(order.items).map((item) => {
    const { quantity, unitPrice, lineTotal } = resolveItemAmounts(item);
    return {
      name: itemDisplayName(item) || "Item",
      extras: itemExtras(item).map((e) => (e.quantity > 1 ? `+ ${e.quantity}x ${e.name}` : `+ ${e.name}`)),
      rate: num(unitPrice),
      qty: String(quantity),
      price: num(lineTotal),
      lineTotal,
    };
  });

  // Number columns are exactly as wide as their widest entry. The item column
  // takes what is left; if that gets too narrow for a readable name, the whole
  // table steps down a font size rather than letting columns collide.
  let size = P.body;
  let cols;
  for (;;) {
    const bold = font(size, true);
    const reg = font(size);
    const widest = (header, values) =>
      Math.ceil(Math.max(measure(header, bold), ...values.map((v) => measure(v, reg))));
    const rateW = widest("Rate", rows.map((r) => r.rate));
    const priceW = widest("Price", rows.map((r) => r.price));
    const fits = (qtyLabel) => {
      const qtyW = widest(qtyLabel, rows.map((r) => r.qty));
      const itemW = inner - rateW - qtyW - priceW - P.gap * 3;
      return { qtyLabel, qtyW, itemW };
    };
    const q = fits("Qty");
    cols = { size, rateW, priceW, ...q };
    if (q.itemW >= inner * 0.34 || size <= P.small - 3) break;
    size -= 1;
  }
  const xItem = P.pad;
  const xPrice = W - P.pad; // right edges
  const xQty = xPrice - cols.priceW - P.gap;
  const xRate = xQty - cols.qtyW - P.gap;
  const lineH = Math.round(cols.size * 1.3);
  const extraSize = Math.max(cols.size - 3, 14);

  const headFont = font(cols.size, true);
  ops.push({ type: "text", text: "Item", x: xItem, y, font: headFont, align: "left" });
  ops.push({ type: "text", text: "Rate", x: xRate, y, font: headFont, align: "right" });
  ops.push({ type: "text", text: cols.qtyLabel, x: xQty, y, font: headFont, align: "right" });
  ops.push({ type: "text", text: "Price", x: xPrice, y, font: headFont, align: "right" });
  y += lineH;
  rule(false, 4);

  const bodyFont = font(cols.size);
  rows.forEach((row, i) => {
    if (i) y += 6;
    const nameLines = wrap(row.name, font(cols.size, true), cols.itemW, measure);
    ops.push({ type: "text", text: row.rate, x: xRate, y, font: bodyFont, align: "right" });
    ops.push({ type: "text", text: row.qty, x: xQty, y, font: bodyFont, align: "right" });
    ops.push({ type: "text", text: row.price, x: xPrice, y, font: bodyFont, align: "right" });
    for (const line of nameLines) {
      ops.push({ type: "text", text: line, x: xItem, y, font: font(cols.size, true), align: "left" });
      y += lineH;
    }
    for (const extra of row.extras) {
      for (const line of wrap(extra, font(extraSize), cols.itemW - 10, measure)) {
        ops.push({ type: "text", text: line, x: xItem + 10, y, font: font(extraSize), align: "left" });
        y += Math.round(extraSize * 1.3);
      }
    }
  });
  rule(false, 6);

  // ---- Totals ----
  const itemsSubtotal = rows.reduce((sum, r) => sum + r.lineTotal, 0);
  const registered = Boolean(store.gstNumber);
  for (const line of billLines(order.bills || {}, itemsSubtotal, { gstSplit: registered })) {
    const s = line.big ? P.body + 4 : P.body;
    const fnt = font(s, Boolean(line.strong));
    ops.push({ type: "text", text: `${line.label}:`, x: P.pad, y, font: fnt, align: "left" });
    ops.push({ type: "text", text: `${line.sign || ""}${rupees(line.amount)}`, x: W - P.pad, y, font: fnt, align: "right" });
    y += Math.round(s * 1.35);
  }
  const method = String(order.paymentMethod || order.payments?.[0]?.method || "").trim();
  if (method) pair("Paid by", method.charAt(0).toUpperCase() + method.slice(1));
  // GST bill: the service code the buyer's return needs.
  if (registered && Number(order.bills?.tax) > 0) text("SAC 996331 · Restaurant service", { size: P.small, align: "center" });

  // ---- Footer ----
  const advert = String(settings.customMessage || "").trim();
  const link = String(settings.websiteLink || "").trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
  const qr = settings.showQrCode ? images.qr : null;
  if (advert || qr || (settings.showWebsiteLink && link)) rule(true);
  if (advert) {
    text(advert, { size: P.body, bold: true, align: "center" });
    y += 4;
  }
  if (qr) {
    y += 4;
    image("qr", qr, Math.round(inner * 0.55), P.width === 384 ? 200 : 260);
  }
  if (link && (qr || settings.showWebsiteLink)) text(link, { size: P.small, align: "center" });

  y += P.pad * 3;
  return { width: W, height: Math.ceil(y), ops };
};

/**
 * The kitchen order ticket (KOT): what the kitchen needs and nothing else.
 *
 * No prices, no store address. Quantity first and big, the dish name bold,
 * the extras and the note under it, because a cook reads it at arm's length
 * on a clip. `items` defaults to the whole order; a round added to a table
 * passes just the new lines, and the ticket says so.
 */
/**
 * A report on the receipt roll: a title block, then sections of
 * label ... value rows. `sections` = [{ title, rows: [[label, value], ...] }].
 */
export const layoutReport = ({ title = "Report", store = {}, period = "", generated = "", sections = [], paper = 80, measure }) => {
  const P = paperOf(paper);
  const W = P.width;
  const inner = W - P.pad * 2;
  const ops = [];
  let y = P.pad * 2;
  const text = (value, { size = P.body, bold = false, align = "left" } = {}) => {
    const fnt = font(size, bold);
    for (const line of wrap(String(value), fnt, inner, measure)) {
      const tx = align === "center" ? P.pad + inner / 2 : P.pad;
      ops.push({ type: "text", text: line, x: tx, y, font: fnt, align });
      y += Math.round(size * 1.3);
    }
  };
  const rule = (dashed = true, space = 8) => {
    y += space;
    ops.push({ type: "line", x1: P.pad, x2: W - P.pad, y, dashed, thickness: dashed ? 2 : 3 });
    y += space + 3;
  };
  // The value keeps its width; the label wraps into what is left.
  const pair = (label, value) => {
    const fnt = font(P.body, false);
    const valueW = Math.ceil(measure(String(value), fnt));
    const labelLines = wrap(String(label), fnt, Math.max(inner - valueW - P.gap, inner / 3), measure);
    ops.push({ type: "text", text: String(value), x: W - P.pad, y, font: fnt, align: "right" });
    for (const line of labelLines) {
      ops.push({ type: "text", text: line, x: P.pad, y, font: fnt, align: "left" });
      y += Math.round(P.body * 1.3);
    }
  };

  text(title, { size: P.title + 2, bold: true, align: "center" });
  if (store.name) text(store.name, { size: P.body, bold: true, align: "center" });
  if (store.address) text(store.address, { size: P.small, align: "center" });
  if (period) text(period, { size: P.small, align: "center" });
  if (generated) text(generated, { size: P.small, align: "center" });
  for (const section of sections) {
    if (!section.rows?.length) continue;
    rule(false, 6);
    text(section.title, { bold: true });
    y += 4;
    for (const [label, value] of section.rows) pair(label, value);
  }
  rule(true);
  y += P.pad * 3;
  return { width: W, height: Math.ceil(y), ops };
};

export const layoutKot = ({ order = {}, items, store = {}, paper = 80, round = false, measure }) => {
  const P = paperOf(paper);
  const W = P.width;
  const inner = W - P.pad * 2;
  const ops = [];
  let y = P.pad * 2;
  const big = P.body + 4;

  const text = (value, { size = P.body, bold = false, align = "left", x = P.pad, width = inner } = {}) => {
    const fnt = font(size, bold);
    for (const line of wrap(value, fnt, width, measure)) {
      const tx = align === "center" ? x + width / 2 : align === "right" ? x + width : x;
      ops.push({ type: "text", text: line, x: tx, y, font: fnt, align });
      y += Math.round(size * 1.3);
    }
  };
  const rule = (dashed = true, space = 8) => {
    y += space;
    ops.push({ type: "line", x1: P.pad, x2: W - P.pad, y, dashed, thickness: dashed ? 2 : 3 });
    y += space + 3;
  };
  const pair = (label, value, { size = P.body, bold = false } = {}) => {
    if (value === undefined || value === null || String(value).trim() === "") return;
    const fnt = font(size, bold);
    const labelW = Math.ceil(measure(`${label} `, fnt));
    ops.push({ type: "text", text: label, x: P.pad, y, font: fnt, align: "left" });
    for (const line of wrap(String(value), fnt, inner - labelW, measure)) {
      ops.push({ type: "text", text: line, x: W - P.pad, y, font: fnt, align: "right" });
      y += Math.round(size * 1.3);
    }
  };

  text(round ? "KOT · ADDED ITEMS" : "KOT", { size: P.title + 4, bold: true, align: "center" });
  if (store.name) text(store.name, { size: P.small, align: "center" });
  rule(false, 6);

  const placed = new Date(order.orderDate || order.createdAt || Date.now());
  pair("Order", `#${orderDisplayId(order)}`, { bold: true });
  const type = ORDER_TYPES[String(order.orderType || "").toLowerCase()];
  const table = tableLabel(order.table);
  pair(table ? "Table" : "Type", table || type, { bold: true, size: big });
  pair("Time", placed.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }));
  if (!table) pair("Customer", order.customerDetails?.name);
  rule(true);

  // A struck-off dish must not reach the kitchen printer either.
  const lines = billableItems(Array.isArray(items) ? items : order.items);
  const qtyFont = font(big, true);
  const qtyW = Math.ceil(Math.max(...lines.map((it) => measure(`${resolveItemAmounts(it).quantity} x`, qtyFont)), 0)) + P.gap;
  const xName = P.pad + qtyW;
  let count = 0;
  lines.forEach((item, i) => {
    const { quantity } = resolveItemAmounts(item);
    count += quantity;
    if (i) y += 8;
    ops.push({ type: "text", text: `${quantity} x`, x: P.pad, y, font: qtyFont, align: "left" });
    text(itemDisplayName(item) || "Item", { size: big, bold: true, x: xName, width: inner - qtyW });
    for (const e of itemExtras(item)) {
      text(e.quantity > 1 ? `+ ${e.quantity}x ${e.name}` : `+ ${e.name}`, { size: P.body, x: xName + 10, width: inner - qtyW - 10 });
    }
    const note = String(item.note || "").trim();
    if (note) text(`** ${note}`, { size: P.body, bold: true, x: xName + 10, width: inner - qtyW - 10 });
  });
  rule(true);
  const orderNote = String(order.instructions || order.deliveryNote || "").trim();
  if (orderNote) {
    text(`** ${orderNote}`, { size: P.body, bold: true });
    y += 4;
  }
  pair("Items", String(count), { size: P.small });

  y += P.pad * 3;
  return { width: W, height: Math.ceil(y), ops };
};
