import { getStoreProperties } from "../https";
import { printHtmlDocument } from "./printDocument";
import { formatAddress } from "./address";
import { layoutReceipt, paperOf } from "./receiptLayout.js";
import { ditherInPlace, rasterJob, toMonochrome } from "./escpos.js";
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

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const measure = (text, font) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
  const layout = layoutReceipt({ order, store, settings, images: { logo, qr }, paper, measure });

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

/** Print a canvas through the browser's print dialog, sized to the paper. */
const printCanvasWithDialog = (canvas, paper) => {
  const printable = paperOf(paper).width === 384 ? 48 : 72; // mm of printable width
  const html = `<!DOCTYPE html><html><head><title>Receipt</title><style>
    @page { size: ${paper === "58" ? 58 : 80}mm auto; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    img { display: block; width: ${printable}mm; margin: 0 auto; image-rendering: pixelated; }
  </style></head><body><img src="${canvas.toDataURL("image/png")}" alt="Receipt"></body></html>`;
  return printHtmlDocument(html);
};

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
  const paper = printer.paper === "58" ? "58" : "80";
  const canvas = await renderReceiptCanvas({ order, store, settings, paper });

  if (printer.type === "usb" || printer.type === "bluetooth") {
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    const bits = toMonochrome(pixels.data, canvas.width, canvas.height);
    await sendToPrinter(printer, rasterJob(bits, canvas.width, canvas.height));
    return { printed: true, via: printer.type };
  }
  if (auto && printer.type !== "system") return { printed: false, via: "none" };
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
