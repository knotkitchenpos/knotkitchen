import { getStoreProperties } from "../https";
import { printHtmlDocument } from "./printDocument";
import { formatAddress } from "./address";
import { layoutKot, layoutReceipt, paperOf } from "./receiptLayout.js";
import { ditherInPlace, rasterJob, toMonochrome } from "./escpos.js";
import { catJob } from "./catprinter.js";
import { loadPrinterConfig, sendToPrinter } from "./printerDevice.js";

/**
 * Print a receipt for a saved order -- the one way the POS prints a bill.
 *
 * The Invoice modal, the Orders screen and Auto Receipt Print all come here,
 * so a receipt looks the same whichever button printed it. The store's name,
 * address, logo and receipt customisation are read fresh from Store
 * Properties each time, never passed in by the caller, so no screen can print
 * stale or another store's branding.
 */

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/$/, "");
const absolute = (url) => (url && url.startsWith("/") ? `${BACKEND_URL}${url}` : url);

/** Store Properties (GET /api/restaurant/properties) as the receipt needs them. */
export const receiptContextFrom = (props = {}, posSettings = props.posSettings) => ({
  store: {
    name: props.storeName,
    address: formatAddress({
      line1: props.fullAddress,
      line2: props.secondAddress,
      city: props.city,
      postalCode: props.postalCode,
    }),
    phone: props.ownerPhone || props.contactPersonPhone || "",
    gstNumber: props.gstNumber || "",
    logo: props.restaurantLogo || "",
  },
  settings: { ...(posSettings || {}), websiteLink: posSettings?.websiteLink || props.websiteUrl || "" },
});

export const loadReceiptContext = async () =>
  receiptContextFrom((await getStoreProperties())?.data?.data || {});

/** An image as a bitmap the canvas can read back. A missing or blocked image is left off the receipt. */
const loadBitmap = async (url) => {
  if (!url) return null;
  try {
    const res = await fetch(absolute(url), { mode: "cors" });
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
};

/** Draw the receipt for one paper width onto a canvas. */
export const renderReceiptCanvas = async ({ order, store, settings, paper }) => {
  const [logo, qr] = await Promise.all([
    settings.showLogo !== false ? loadBitmap(store.logo) : null,
    settings.showQrCode ? loadBitmap(settings.qrCodeImage) : null,
  ]);
  return paintLayout((measure) => layoutReceipt({ order, store, settings, images: { logo, qr }, paper, measure }), { logo, qr });
};

/** The kitchen ticket for `order`, or for just `items` of it (a round added to a table). */
export const renderKotCanvas = ({ order, items, store, paper, round = false }) =>
  paintLayout((measure) => layoutKot({ order, items, store, paper, round, measure }), {});

/** Lay out with the canvas's own text metrics, then draw every op. */
const paintLayout = (layoutWith, { logo, qr }) => {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const measure = (text, font) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
  const layout = layoutWith(measure);

  canvas.width = layout.width;
  canvas.height = layout.height;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.textBaseline = "top";

  for (const op of layout.ops) {
    if (op.type === "text") {
      ctx.font = op.font;
      ctx.textAlign = op.align;
      ctx.fillText(op.text, op.x, op.y);
    } else if (op.type === "line") {
      ctx.lineWidth = op.thickness;
      ctx.setLineDash(op.dashed ? [8, 6] : []);
      ctx.beginPath();
      ctx.moveTo(op.x1, op.y);
      ctx.lineTo(op.x2, op.y);
      ctx.stroke();
    } else if (op.type === "image") {
      const bitmap = op.key === "logo" ? logo : qr;
      const scratch = document.createElement("canvas");
      scratch.width = op.width;
      scratch.height = op.height;
      const sctx = scratch.getContext("2d", { willReadFrequently: true });
      sctx.drawImage(bitmap, 0, 0, op.width, op.height);
      const pixels = sctx.getImageData(0, 0, op.width, op.height);
      ditherInPlace(pixels.data, op.width, op.height);
      ctx.putImageData(pixels, op.x, op.y);
    }
  }
  return canvas;
};

/** The receipt canvas as a printable HTML page, sized to the paper. */
export const receiptHtml = (canvas, paper) => {
  const printable = paperOf(paper).width === 384 ? 48 : 72; // mm of printable width
  const paperMm = paper === "58" ? 58 : 80;
  const heightMm = Math.ceil((canvas.height / canvas.width) * printable);
  const html = `<!DOCTYPE html><html><head><title>Receipt</title><style>
    @page { size: ${paperMm}mm auto; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    img { display: block; width: ${printable}mm; margin: 0 auto; image-rendering: pixelated; }
  </style></head><body><img src="${canvas.toDataURL("image/png")}" alt="Receipt"></body></html>`;
  return { html, paperMm, heightMm };
};

/** Print a canvas through the browser's print dialog. */
const printCanvasWithDialog = (canvas, paper) => printHtmlDocument(receiptHtml(canvas, paper).html);

/**
 * Inside the Windows app (pos-desktop) the computer's printer driver prints
 * with no dialog: window.knotDesktop.printHtml goes straight to the spooler.
 */
export const desktopPrinting = () =>
  typeof window !== "undefined" && typeof window.knotDesktop?.printHtml === "function";

/**
 * Print `order`.
 *
 * @param {object}  order
 * @param {object}  [options]
 * @param {boolean} [options.auto]  true for Auto Receipt Print: never falls back
 *                                  to a print dialog nobody asked for.
 * @param {object}  [options.config] a printer config to use instead of the saved one (Test Print)
 * @param {object}  [options.context] a preloaded loadReceiptContext() result
 * @returns {Promise<{ printed: boolean, via: string }>}  throws with a readable message
 */
export const printOrderReceipt = async (order, { auto = false, config, context } = {}) => {
  const printer = config || loadPrinterConfig();
  const { store, settings } = context || (await loadReceiptContext());
  const paper = paperFor(printer);
  const canvas = await renderReceiptCanvas({ order, store, settings, paper });
  return sendCanvas(canvas, { printer, paper, auto });
};

/**
 * Print a kitchen order ticket on this device's printer.
 *
 * @param {object} order
 * @param {object} [options]
 * @param {Array}  [options.items]  only these lines (a round added to a table); default: every line
 * @param {boolean} [options.round] label the ticket as added items
 * @param {boolean} [options.auto]  never open a dialog nobody asked for
 */
export const printKot = async (order, { items, round = false, auto = false, config, context } = {}) => {
  const printer = config || loadPrinterConfig();
  const { store } = context || (await loadReceiptContext());
  const paper = paperFor(printer);
  const canvas = renderKotCanvas({ order, items, store, paper, round });
  return sendCanvas(canvas, { printer, paper, auto });
};

/** A mini printer is always 57 mm and speaks its own language, not ESC/POS. */
const paperFor = (printer) => (printer.protocol === "cat" || printer.paper === "58" ? "58" : "80");

/** Hand a rendered ticket to whatever this device prints with. */
const sendCanvas = async (canvas, { printer, paper, auto }) => {
  if (printer.type === "usb" || printer.type === "bluetooth") {
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    const bits = toMonochrome(pixels.data, canvas.width, canvas.height);
    const encode = printer.protocol === "cat" ? catJob : rasterJob;
    await sendToPrinter(printer, encode(bits, canvas.width, canvas.height));
    return { printed: true, via: printer.type };
  }
  if (auto && printer.type !== "system") return { printed: false, via: "none" };
  if (printer.type === "system" && desktopPrinting()) {
    const { html, paperMm, heightMm } = receiptHtml(canvas, paper);
    await window.knotDesktop.printHtml(html, { printer: printer.systemPrinter || "", paperMm, heightMm });
    return { printed: true, via: "desktop" };
  }
  printCanvasWithDialog(canvas, paper);
  return { printed: true, via: "dialog" };
};

/** A sample order for Test Print. */
export const SAMPLE_ORDER = {
  orderNumber: "TEST-0001",
  orderType: "collection",
  createdAt: new Date().toISOString(),
  customerDetails: { name: "Test Customer", phone: "9876543210" },
  items: [
    { name: "Paneer Butter Masala", quantity: 2, price: 280, total: 560 },
    {
      name: "Veg Loaded Pizza with Extra Toppings",
      quantity: 1,
      price: 399,
      total: 399,
      modifiers: [{ name: "Extra Cheese", price: 40 }, { name: "Jalapenos", price: 30 }],
    },
    { name: "Masala Chai", quantity: 3, price: 30, total: 90 },
  ],
  bills: { subtotal: 1049, total: 1049, tax: 0, totalWithTax: 1049 },
  paymentMethod: "Cash",
};
