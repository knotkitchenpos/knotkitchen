import { createElement, Fragment } from "react";
import { closeSnackbar, enqueueSnackbar } from "./notify";
import { getStoreProperties } from "../https";
import { billableItems } from "./orderItems.js";
import { printHtmlDocument } from "./printDocument";
import { formatAddress } from "./address";
import { layoutKot, layoutReceipt, layoutReport, paperOf } from "./receiptLayout.js";
import { ditherInPlace, rasterJob, TEAR_FEED_DOTS, TEAR_FEED_DOTS_80, toMonochrome } from "./escpos.js";
import { catJob } from "./catprinter.js";
import { bluetoothLinked, kitchenPrinters, loadPrinterConfig, reconnectBluetoothPrinter, sendToPrinter } from "./printerDevice.js";
import { menuIndex, needsMenu, routeKot } from "./kotRouting.js";
import { loadSystemMenu, readSavedMenu } from "./systemMenu.js";
import { ensureReceiptFont } from "./receiptFont.js";
import { getActiveStoreId, readStoreScoped, writeStoreScoped } from "./storeSession.js";
import { BACKEND_URL } from "../config";

/**
 * Print a receipt for a saved order -- the one way the POS prints a bill.
 *
 * The Invoice modal, the Orders screen and Auto Receipt Print all come here,
 * so a receipt looks the same whichever button printed it. The store's name,
 * address, logo and receipt customisation are read fresh from Store
 * Properties each time, never passed in by the caller, so no screen can print
 * stale or another store's branding.
 */

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

// A KOT and its receipt print together: one fetch serves both, and any
// print within a few seconds of it, so neither waits on the network again.
const CONTEXT_REUSE_MS = 10000;
let recentContext = null;

/**
 * Store Properties for the receipt. The last good copy is kept on the
 * device so an order taken offline still prints with the right header.
 */
export const loadReceiptContext = () => {
  const store = getActiveStoreId();
  if (recentContext && recentContext.store === store && Date.now() - recentContext.at < CONTEXT_REUSE_MS) {
    return recentContext.promise;
  }
  const promise = fetchReceiptContext();
  recentContext = { store, at: Date.now(), promise };
  promise.catch(() => {
    if (recentContext?.promise === promise) recentContext = null;
  });
  return promise;
};

const fetchReceiptContext = async () => {
  try {
    const props = (await getStoreProperties())?.data?.data || {};
    writeStoreScoped("kk.receiptProps.v1", props);
    return receiptContextFrom(props);
  } catch (err) {
    const cached = readStoreScoped("kk.receiptProps.v1", null);
    if (cached && !err?.response) return receiptContextFrom(cached);
    throw err;
  }
};

// The logo and QR image, downloaded once per address, not on every print.
const bitmaps = new Map();

/** An image as a bitmap the canvas can read back. A missing or blocked image is left off the receipt. */
export const loadBitmap = (url) => {
  if (!url) return Promise.resolve(null);
  if (!bitmaps.has(url)) {
    const loading = fetchBitmap(url);
    bitmaps.set(url, loading);
    // A failed download is tried again on the next print.
    loading.then((bitmap) => {
      if (!bitmap) bitmaps.delete(url);
    });
  }
  return bitmaps.get(url);
};

const fetchBitmap = async (url) => {
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
    ensureReceiptFont(),
  ]);
  return paintLayout((measure) => layoutReceipt({ order, store, settings, images: { logo, qr }, paper, measure }), { logo, qr });
};

/** The kitchen ticket for `order`, or for just `items` of it (a round added to a table). */
export const renderKotCanvas = ({ order, items, store, paper, round = false, station = "" }) =>
  paintLayout((measure) => layoutKot({ order, items, store, paper, round, station, measure }), {});

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
 * Print a kitchen order ticket, split across this device's kitchen printers
 * by what each one prints (Device Configuration > Kitchen Printers,
 * utils/kotRouting.js). Dishes no kitchen printer takes print on the receipt
 * printer; with no kitchen printer at all, the whole ticket does.
 *
 * Every printer is tried even when one fails. A failure throws once, naming
 * the printers that did not print, with `err.retry` reprinting only those.
 *
 * @param {object} order
 * @param {object} [options]
 * @param {Array}  [options.items]  only these lines (a round added to a table); default: every line
 * @param {boolean} [options.round] label the ticket as added items
 * @param {boolean} [options.auto]  never open a dialog nobody asked for
 * @param {object}  [options.config] the device's printer config (default: the saved one)
 * @param {object}  [options.printer] print everything on this one printer (Test Print)
 * @param {Array}   [options.only]  ticket ids to print (a retry of the ones that failed)
 * @param {Array}   [options.menus] the menu to route by (default: the menu saved on this device)
 */
export const printKot = async (order, opts = {}) => {
  const { round = false, auto = false, context, printer: forced, only, menus } = opts;
  // Cancelled dishes are not cooked. With none left there is no ticket: an
  // automatic print skips quietly, a pressed button says why.
  const lines = billableItems(Array.isArray(opts.items) ? opts.items : order?.items);
  if (lines.length === 0) {
    if (auto) return null;
    throw new Error("Nothing to print: every item on this order is cancelled.");
  }
  const config = opts.config || loadPrinterConfig();
  const kitchens = kitchenPrinters(config);
  let lookup = () => null;
  if (!forced && needsMenu(kitchens)) {
    // Routing by category needs the menu. A kitchen device that only prints
    // (nobody opened its product screen) may have none saved, or one from
    // before a dish was added: fetch it then, so no dish lands on the wrong
    // printer. Offline, the saved copy is what there is.
    let menu = menus || readSavedMenu()?.body?.data || [];
    lookup = menuIndex(menu);
    if (!menus && lines.some((l) => !lookup(l))) {
      menu = (await loadSystemMenu().catch(() => null))?.data?.data || menu;
      lookup = menuIndex(menu);
    }
  }
  let tickets = forced
    ? [{ id: forced.id || "test", label: forced.label || "", printer: forced, items: lines }]
    : routeKot({ lines, kitchens, receipt: config, lookup });
  if (Array.isArray(only)) tickets = tickets.filter((t) => only.includes(t.id));
  if (!tickets.length) return null;
  const { store } = context || (await loadReceiptContext());
  await ensureReceiptFont();
  // The printer's name heads its ticket once the kitchen has more than one.
  const named = !forced && (kitchens.length > 1 || tickets.length > 1);

  const results = [];
  const failed = [];
  for (const t of tickets) {
    try {
      const paper = paperFor(t.printer);
      const canvas = renderKotCanvas({ order, items: t.items, store, paper, round, station: named ? t.label : "" });
      results.push(await sendCanvas(canvas, { printer: t.printer, paper, auto }));
    } catch (err) {
      failed.push({ ticket: t, err });
    }
  }
  if (failed.length) {
    const first = failed[0].err;
    const err = new Error(
      tickets.length === 1
        ? first?.message || "Could not print the KOT."
        : failed.map((f) => `${f.ticket.label || "Receipt printer"}: ${f.err?.message || "not printed"}`).join(" · "),
    );
    if (first?.code) {
      err.code = first.code;
      err.printer = first.printer; // BT_RECONNECT: the printer whose chooser to open
    }
    const ids = failed.map((f) => f.ticket.id);
    err.retry = () => printKot(order, { ...opts, config: undefined, only: ids });
    throw err;
  }
  return results.find((r) => r?.printed) || results[0] || null;
};

/**
 * Print a report (see layoutReport for its shape) on this device's receipt
 * printer, the same way receipts go: the app's USB/Bluetooth/LAN printer, the
 * Windows app's printer silently, or the browser's print dialog.
 */
export const printReport = async (report, { config } = {}) => {
  const printer = config || loadPrinterConfig();
  const paper = paperFor(printer);
  await ensureReceiptFont();
  const canvas = paintLayout((measure) => layoutReport({ ...report, paper, measure }), {});
  return sendCanvas(canvas, { printer, paper, auto: false });
};

/** A mini printer is always 57 mm and speaks its own language, not ESC/POS. */
const paperFor = (printer) => (printer.protocol === "cat" || printer.paper === "58" ? "58" : "80");

/** Hand a rendered ticket to whatever this device prints with. */
const sendCanvas = async (canvas, { printer, paper, auto }) => {
  if (printer.type === "usb" || printer.type === "bluetooth" || printer.type === "lan") {
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    const bits = toMonochrome(pixels.data, canvas.width, canvas.height);
    const encode = printer.protocol === "cat" ? catJob : rasterJob;
    // Feed the receipt out past the tear bar, on every paper size. 3-inch
    // printers without a cutter ignore the cut, so the receipt was torn off at
    // its last line and the next one started with a long blank strip
    // (owner, 2026-10-30). A printer with a cutter gets a short blank margin
    // under the last line before it cuts.
    await sendToPrinter(printer, encode(bits, canvas.width, canvas.height, { tearFeed: paper === "58" ? TEAR_FEED_DOTS : TEAR_FEED_DOTS_80 }));
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

/**
 * A pressed Print or KOT button: say it is sending, then whether it went.
 * Some transports take a minute to give up (an Android Bluetooth printer that
 * is off) or never fail at all (the Windows spooler takes a job for an
 * unplugged printer), and the buttons used to stay silent until then.
 *
 * ponytail: Windows cannot be asked whether a USB printer is attached, so the
 * desktop app says "sent to the print queue", not "printed".
 */
export const printWithFeedback = async (what, run) => {
  const What = what.charAt(0).toUpperCase() + what.slice(1);
  const key = enqueueSnackbar(`Sending the ${what} to the printer…`, { variant: "info", persist: true });
  try {
    const result = await run();
    closeSnackbar(key);
    // The browser's own dialog is its feedback.
    if (result && result.via !== "dialog") {
      enqueueSnackbar(result.via === "desktop" ? `${What} sent to the Windows print queue.` : `${What} printed.`, { variant: "success" });
    }
    return result;
  } catch (err) {
    closeSnackbar(key);
    // The browser forgot the Bluetooth printer: its chooser opens only from a tap, so offer one.
    if (err?.code === "BT_RECONNECT") return warnNotPrinted(What, err, () => printWithFeedback(what, run));
    enqueueSnackbar(err?.message || `Could not print the ${what}.`, { variant: "error" });
  }
};

/**
 * An automatic print that failed (the printer asleep, off or out of range)
 * shows Retry for UNPRINTED_SHOW_MS: staff wake the printer and still get
 * the ticket. It used to stay until dismissed, covering the buttons under it. When the browser
 * forgot a Bluetooth printer, the same tap shows its chooser again.
 * `again` reprints with the printer saved now, so a printer fixed in Device
 * Configuration meanwhile is the one used.
 *
 * Every unprinted ticket shares ONE warning, with one Retry for them all:
 * notistack shows three toasts and, when all three persist, closes the oldest
 * for the next toast, Retry and all, so a rush lost tickets again.
 */
const unprinted = []; // { what, err, again }, oldest first
const UNPRINTED_SHOW_MS = 5000;
let unprintedKey = null;

const showUnprinted = () => {
  if (unprintedKey !== null) closeSnackbar(unprintedKey);
  unprintedKey = null;
  if (!unprinted.length) return;
  const { what, err } = unprinted[unprinted.length - 1];
  const reason = err?.message || "printer error";
  const label = unprinted.some((u) => u.err?.code === "BT_RECONNECT") ? "Reconnect" : unprinted.length > 1 ? "Retry all" : "Retry";
  const message =
    unprinted.length === 1 ? `${what} not printed: ${reason}` : `${unprinted.length} tickets not printed (${unprinted.map((u) => u.what).join(", ")}): ${reason}`;
  unprintedKey = enqueueSnackbar(message, {
    variant: "warning",
    // A few seconds, then out of the way (owner, 2026-10-31: it sat over
    // Settings until dismissed). Gone unanswered, it counts as Dismiss: the
    // tickets are not reprinted by a later Retry, long after the moment.
    autoHideDuration: UNPRINTED_SHOW_MS,
    onClose: (event, reason, key) => {
      if (reason === "timeout") dismissUnprinted(key);
    },
    action: (key) =>
      createElement(
        Fragment,
        null,
        createElement("button", { type: "button", className: "px-2 font-bold underline", onClick: () => retryUnprinted(key) }, label),
        createElement("button", { type: "button", className: "px-2", onClick: () => dismissUnprinted(key) }, "Dismiss"),
      ),
  });
};

const dismissUnprinted = (key) => {
  if (key !== unprintedKey) return; // a newer warning holds tickets this one never showed
  unprinted.length = 0;
  showUnprinted();
};

const retryUnprinted = (key) => {
  // A closed toast stays tappable while it fades out: a double tap printed the ticket twice.
  if (key !== unprintedKey) return;
  const jobs = unprinted.splice(0);
  showUnprinted();
  // The chooser only for a printer this page lost (another ticket's Reconnect may have linked it since).
  const relink = jobs.find((j) => j.err?.code === "BT_RECONNECT" && !bluetoothLinked(j.err.printer));
  // requestDevice runs inside this tap, as the browser requires.
  (relink ? reconnectBluetoothPrinter(relink.err.printer) : Promise.resolve())
    .then(
      async () => {
        for (const job of jobs) {
          try {
            await job.again();
          } catch (e) {
            unprinted.push({ ...job, err: e });
          }
        }
      },
      // Closing the chooser keeps the Reconnect offer.
      (e) => unprinted.push(...jobs.map((j) => (j === relink && e?.name !== "NotFoundError" ? { ...j, err: e } : j))),
    )
    .finally(showUnprinted);
};

export const warnNotPrinted = (what, err, again) => {
  unprinted.push({ what, err, again });
  showUnprinted();
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
