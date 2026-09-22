import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { layoutKot, layoutReceipt, billLines, wrap, PAPER } from "../src/utils/receiptLayout.js";
import { rasterJob, toMonochrome } from "../src/utils/escpos.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

// Roughly Arial: 0.56em per character, a little wider when bold.
const measure = (text, font) => {
  const size = Number(/(\d+)px/.exec(font)[1]);
  return String(text).length * size * (font.startsWith("bold") ? 0.6 : 0.56);
};

const ORDER = {
  orderNumber: "POS-20260914-000123",
  orderType: "collection",
  createdAt: "2026-09-14T12:30:00Z",
  customerDetails: { name: "Asha", phone: "9876543210" },
  items: [
    { name: "Paneer Butter Masala Special Family Pack With Butter Naan", quantity: 12, price: 1280, total: 15360 },
    { name: "Pizza", quantity: 1, price: 399, total: 399, modifiers: [{ name: "Extra Cheese and Double Jalapenos on the side", price: 40 }] },
  ],
  bills: { subtotal: 15759, total: 15759, tax: 0, totalWithTax: 15759 },
};

const textOps = (layout) => layout.ops.filter((o) => o.type === "text");
const span = (op) => {
  const w = measure(op.text, op.font);
  if (op.align === "right") return [op.x - w, op.x];
  if (op.align === "center") return [op.x - w / 2, op.x + w / 2];
  return [op.x, op.x + w];
};

for (const paper of [58, 80]) {
  test(`${paper} mm: nothing is drawn outside the paper`, () => {
    const layout = layoutReceipt({ order: ORDER, store: { name: "The Very Long Restaurant Name Kitchen & Bar" }, paper, measure });
    assert.equal(layout.width, PAPER[paper].width);
    for (const op of textOps(layout)) {
      const [l, r] = span(op);
      assert.ok(l >= -0.5 && r <= layout.width + 0.5, `"${op.text}" runs off the paper (${l}..${r})`);
    }
    assert.ok(layout.width % 8 === 0, "raster width must be whole bytes");
  });

  test(`${paper} mm: item, rate, qty and price never overlap`, () => {
    const layout = layoutReceipt({ order: ORDER, store: { name: "S" }, paper, measure });
    const ops = textOps(layout);
    const rows = new Map();
    for (const op of ops) rows.set(op.y, [...(rows.get(op.y) || []), op]);
    for (const [y, row] of rows) {
      const spans = row.map(span).sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < spans.length; i += 1) {
        assert.ok(spans[i][0] >= spans[i - 1][1] - 0.5, `text collides on the line at y=${y}: ${row.map((o) => o.text).join(" | ")}`);
      }
    }
  });
}

test("the columns are Item | Rate | Qty | Price, with the extras under the item", () => {
  const ops = textOps(layoutReceipt({ order: ORDER, store: { name: "S" }, paper: 80, measure }));
  const header = ops.filter((o) => ["Item", "Rate", "Quantity", "Qty", "Price"].includes(o.text)).map((o) => o.text);
  assert.deepEqual(header.slice(0, 4), ["Item", "Rate", "Qty", "Price"], "the column reads Qty on every paper size");
  assert.ok(ops.some((o) => o.text.startsWith("+ Extra")), "extras are printed under the dish");
  assert.ok(ops.some((o) => o.text === "1,280.00"), "rate is the price of one");
  assert.ok(ops.some((o) => o.text === "15,360.00"), "price is rate x quantity");
  assert.ok(ops.some((o) => o.text === "Subtotal:") && ops.some((o) => o.text === "₹15,759.00"));
});

test("a long item name wraps instead of running into the numbers", () => {
  const ops = textOps(layoutReceipt({ order: ORDER, store: { name: "S" }, paper: 58, measure }));
  const nameLines = ops.filter((o) => o.align === "left" && /Paneer|Butter|Naan|Family|Pack|Special|With|Masala/.test(o.text));
  assert.ok(nameLines.length >= 2, "the name took more than one line");
});

test("Total is printed only when something changed the subtotal", () => {
  assert.deepEqual(billLines({ subtotal: 100, totalWithTax: 100 }).map((l) => l.label), ["Subtotal"]);
  assert.deepEqual(
    billLines({ subtotal: 100, discount: 10, tax: 4.5, totalWithTax: 94.5 }).map((l) => l.label),
    ["Subtotal", "Discount", "GST", "Total"],
  );
});

test("footer: advertisement, QR code with the link under it, logo only when on", () => {
  const images = { logo: { width: 400, height: 200 }, qr: { width: 300, height: 300 } };
  const on = layoutReceipt({
    order: ORDER, store: { name: "S" }, paper: 80, measure, images,
    settings: { customMessage: "10% off next visit", showQrCode: true, websiteLink: "https://demo.knotkitchen.com/", showLogo: true },
  });
  const imgs = on.ops.filter((o) => o.type === "image");
  assert.equal(imgs[0].key, "logo");
  assert.ok(imgs[0].y < textOps(on)[0].y, "the logo is at the very top");
  const qr = imgs.find((o) => o.key === "qr");
  const link = textOps(on).find((o) => o.text === "demo.knotkitchen.com");
  assert.ok(qr && link && link.y > qr.y + qr.height - 1, "the link is under the QR code");
  assert.ok(textOps(on).some((o) => o.text === "10% off next visit"));

  const off = layoutReceipt({
    order: ORDER, store: { name: "S" }, paper: 80, measure, images,
    settings: { showLogo: false, showQrCode: false, showWebsiteLink: false, websiteLink: "https://demo.knotkitchen.com" },
  });
  assert.equal(off.ops.filter((o) => o.type === "image").length, 0);
  assert.ok(!textOps(off).some((o) => o.text.includes("knotkitchen")));
});

test("wrap breaks a word longer than the line", () => {
  const lines = wrap("Supercalifragilisticexpialidocious", "20px A", 100, measure);
  assert.ok(lines.length > 1 && lines.every((l) => measure(l, "20px A") <= 100));
});

test("ESC/POS job: init, GS v 0 bands of the right size, feed and cut", () => {
  const width = 16;
  const height = 250;
  const rgba = new Uint8Array(width * height * 4).fill(255);
  rgba.set([0, 0, 0, 255], 0); // top-left pixel black
  const bits = toMonochrome(rgba, width, height);
  assert.equal(bits[0], 0x80);
  const job = rasterJob(bits, width, height);
  assert.deepEqual([...job.slice(0, 2)], [0x1b, 0x40]);
  assert.deepEqual([...job.slice(2, 10)], [0x1d, 0x76, 0x30, 0, 2, 0, 120, 0]);
  const bands = Math.ceil(height / 120);
  assert.equal(job.length, 2 + bands * 8 + 2 * height + 3 + 4);
  assert.deepEqual([...job.slice(-4)], [0x1d, 0x56, 0x42, 0]);
});

test("every receipt print goes through the one renderer", () => {
  assert.match(SRC("src/components/invoice/Invoice.jsx"), /printOrderReceipt\(safeOrder\)/);
  assert.match(SRC("src/pages/Orders.jsx"), /printOrderReceipt\(selected\)/);
  assert.match(SRC("src/hooks/useAutoReceiptPrint.js"), /onlineOrder:created/);
  assert.match(SRC("src/App.jsx"), /useAutoReceiptPrint\(\);/);
  assert.match(SRC("src/components/settings/DeviceConfiguration.jsx"), /key: "lan", label: "LAN \/ Network", disabled: true/);
});

test("GST bill: CGST/SGST split for a registered store, buyer and SAC printed", () => {
  const bills = { subtotal: 1000, tax: 50, taxPercent: 5, serviceCharge: 100, totalWithTax: 1150, tip: 20 };
  const plain = billLines(bills, 1000).map((l) => l.label);
  assert.deepEqual(plain, ["Subtotal", "GST @ 5%", "Service charge", "Total", "Tip", "Paid"]);
  const split = billLines(bills, 1000, { gstSplit: true });
  assert.deepEqual(split.map((l) => l.label), ["Subtotal", "CGST @ 2.5%", "SGST @ 2.5%", "Service charge", "Total", "Tip", "Paid"]);
  assert.equal(split[1].amount + split[2].amount, 50);
  assert.equal(split[split.length - 1].amount, 1170);

  const order = { ...ORDER, bills, customerDetails: { name: "Asha", company: "Acme Pvt Ltd", gstin: "19ABCDE1234F1Z5" } };
  const layout = layoutReceipt({ order, store: { name: "Asha's", gstNumber: "19XXXXX1234X1Z9" }, settings: {}, paper: 80, measure });
  const texts = textOps(layout).map((o) => o.text);
  assert.ok(texts.includes("Acme Pvt Ltd"));
  assert.ok(texts.includes("19ABCDE1234F1Z5"));
  assert.ok(texts.some((t) => t.startsWith("CGST")));
  assert.ok(texts.includes("SAC 996331 · Restaurant service"));
  // An unregistered store prints none of that.
  const plainLayout = layoutReceipt({ order, store: { name: "Asha's" }, settings: {}, paper: 80, measure });
  const pt = textOps(plainLayout).map((o) => o.text);
  assert.ok(!pt.some((t) => t.startsWith("CGST")) && !pt.some((t) => t.startsWith("SAC")));
});

test("KOT: quantities, names, extras and notes; no prices, no address", () => {
  const order = { ...ORDER, table: { tableNumber: 4 }, orderType: "dine-in", instructions: "Serve together" };
  order.items = [{ ...ORDER.items[0], note: "less spicy" }, ORDER.items[1]];
  const layout = layoutKot({ order, store: { name: "Asha's", address: "12 MG Road", gstNumber: "GST1" }, paper: 80, measure });
  const texts = textOps(layout).map((o) => o.text);
  assert.ok(texts.includes("KOT"));
  assert.ok(texts.includes("12 x"), "quantity first");
  assert.ok(texts.some((t) => t.startsWith("Paneer Butter Masala")));
  assert.ok(texts.includes("+ Extra Cheese and Double Jalapenos on the side") || texts.some((t) => t.startsWith("+ Extra Cheese")));
  assert.ok(texts.includes("** less spicy"), "the cook's note");
  assert.ok(texts.includes("** Serve together"), "the order note");
  assert.ok(texts.includes("Table 4") || texts.some((t) => /Table/.test(t)));
  assert.ok(!texts.some((t) => /15,360|1,280|399|Subtotal|Total|Rate|Price/.test(t)), "no money on a kitchen ticket");
  assert.ok(!texts.includes("12 MG Road") && !texts.some((t) => /GSTIN/.test(t)), "no address or GSTIN");
  for (const o of layout.ops) {
    if (o.type === "text") assert.ok(o.x >= 0 && o.x <= layout.width, `text inside the paper: ${o.text}`);
  }
  // A round: only the given lines, labelled as such.
  const round = layoutKot({ order, items: [ORDER.items[1]], round: true, paper: 58, measure });
  const rt = textOps(round).map((o) => o.text);
  assert.ok(rt.includes("KOT · ADDED ITEMS"));
  assert.ok(!rt.some((t) => t.startsWith("Paneer")));
  assert.equal(round.width, PAPER[58].width);
});

test("Auto KOT prints on new orders and on table rounds", () => {
  const hook = SRC("src/hooks/useAutoReceiptPrint.js");
  assert.match(hook, /socket\.on\("kitchen:round", onRound\)/);
  assert.match(hook, /if \(config\.kotPrint\) \{\s+await printKot\(order/);
  const socket = fs.readFileSync(path.join(__dirname, "..", "..", "pos-backend", "services", "socket.js"), "utf8");
  assert.match(socket, /emitEvent\("kitchen:round", payload, rooms\)/);
});

test("Windows app: a system printer prints silently through window.knotDesktop", () => {
  const src = SRC("src/utils/printReceipt.js");
  assert.match(src, /printer\.type === "system" && desktopPrinting\(\)/);
  assert.match(src, /window\.knotDesktop\.printHtml\(html, \{ printer: printer\.systemPrinter/);
  // The dialog path stays for plain browsers.
  assert.match(src, /printCanvasWithDialog\(canvas, paper\);\n  return \{ printed: true, via: "dialog" \}/);
  // The desktop shell exposes exactly those two calls.
  const preload = SRC("../pos-desktop/preload.js");
  assert.match(preload, /listPrinters:/);
  assert.match(preload, /printHtml:/);
});

test("REGRESSION: a connected printer is kept at once, not only on Save", () => {
  // Orders > Print reads the SAVED printer. A printer connected in Settings
  // but not yet saved left that empty, so Print opened the browser's dialog.
  const settings = fs.readFileSync(path.join(__dirname, "..", "src/components/settings/DeviceConfiguration.jsx"), "utf8");
  assert.match(settings, /const patchDevice = \(patch\) => setDevice\(\(d\) => savePrinterConfig\(\{ \.\.\.d, \.\.\.patch \}\)\);/);

  // And the Bluetooth write goes to a printer service, never a standard one.
  const device = fs.readFileSync(path.join(__dirname, "..", "src/utils/printerDevice.js"), "utf8");
  assert.match(device, /if \(STANDARD_SERVICE\.test\(service\.uuid\)\) continue;/);
  assert.match(device, /PRINTER_SERVICES\.includes\(service\.uuid\) \? 2 : 0/);
});

test("cat printer job: framed packets, CRC-8, LSB-first rows, 384 wide", async () => {
  const { catJob, packet, crc8, looksLikeCatPrinter, CAT_WIDTH } = await import("../src/utils/catprinter.js");
  // CRC-8 poly 0x07: "123456789" -> 0xF4 (the standard check value).
  assert.equal(crc8(new TextEncoder().encode("123456789")), 0xf4);
  const p = packet(0xa1, [0x30, 0x00]);
  assert.deepEqual([...p], [0x51, 0x78, 0xa1, 0x00, 0x02, 0x00, 0x30, 0x00, crc8([0x30, 0x00]), 0xff]);

  // Two rows of 384 px; row 0 has only the leftmost pixel black (MSB-first: 0x80).
  const width = CAT_WIDTH;
  const rowBytes = width / 8;
  const bits = new Uint8Array(rowBytes * 2);
  bits[0] = 0x80;
  const job = catJob(bits, width, 2);
  // Find the first row packet (cmd 0xa2) and check the bit order flipped to LSB-first (0x01).
  let at = 0;
  const rows = [];
  while (at < job.length) {
    const len = job[at + 4];
    if (job[at + 2] === 0xa2) rows.push(job.subarray(at + 6, at + 6 + len));
    at += 8 + len;
  }
  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, 48);
  assert.equal(rows[0][0], 0x01);
  assert.equal(job[job.length - 1], 0xff, "the stream is whole packets");

  assert.ok(looksLikeCatPrinter("P1-7604"));
  assert.ok(looksLikeCatPrinter("GB03"));
  assert.ok(!looksLikeCatPrinter("MTP-II"));
  assert.ok(!looksLikeCatPrinter("Xprinter XP-58"));

  // The receipt path picks the encoder and forces 57 mm paper for it.
  const print = fs.readFileSync(path.join(__dirname, "..", "src/utils/printReceipt.js"), "utf8");
  assert.match(print, /const encode = printer\.protocol === "cat" \? catJob : rasterJob;/);
  assert.match(print, /printer\.protocol === "cat" \|\| printer\.paper === "58" \? "58" : "80"/);
});

test("a cancelled line is not printed on the bill, nor on the kitchen ticket", () => {
  const order = {
    ...ORDER,
    items: [
      ...ORDER.items,
      { name: "Struck Off Dish", quantity: 1, price: 178, total: 178, status: "cancelled", cancelReason: "Not accepted" },
    ],
  };
  const bill = textOps(layoutReceipt({ order, store: { name: "S" }, paper: 80, measure })).map((o) => o.text);
  assert.ok(!bill.some((t) => /Struck Off Dish/.test(t)), "not on the receipt");
  assert.ok(!bill.includes("178.00"), "and its price is not listed");
  const kot = textOps(layoutKot({ order, store: { name: "S" }, paper: 80, measure })).map((o) => o.text);
  assert.ok(!kot.some((t) => /Struck Off Dish/.test(t)), "not on the KOT");
});

test("REGRESSION: an offline order with a plain dish does not crash the invoice", async () => {
  // The till stores `modifierSelections: {}` on a dish with nothing chosen.
  // Offline the invoice renders that cart line as it is, and itemExtras
  // spread the object: "(e.modifierSelections || []) is not iterable".
  const { itemExtras } = await import("../src/utils/orderItems.js");
  assert.deepEqual(itemExtras({ name: "Mango Lassi", modifierSelections: {}, addons: [] }), []);
  assert.deepEqual(itemExtras({ name: "Tea", modifierSelections: null, addons: undefined }), []);
  const picked = itemExtras({ name: "Sandwich", modifierSelections: [{ optionName: "Extra Cheese", price: 30 }] });
  assert.equal(picked.length, 1);
  assert.equal(picked[0].name, "Extra Cheese");
});

test("REGRESSION: each takeaway keeps its own device configuration", async () => {
  // One till signed into Takeaway 1 and Takeaway 2: a change in one takeaway's
  // Device Configuration was applied to the other, because the printer config
  // was one record for the whole browser.
  const mem = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  };
  for (const n of ["localStorage", "sessionStorage"]) Object.defineProperty(globalThis, n, { value: mem(), configurable: true, writable: true });
  const { loadPrinterConfig, savePrinterConfig } = await import("../src/utils/printerDevice.js");
  const { setActiveStoreId } = await import("../src/utils/storeSession.js");

  localStorage.setItem("kk.receiptPrinter.v1", JSON.stringify({ type: "usb", name: "XP-80", autoPrint: true })); // before the fix
  setActiveStoreId("111111");
  assert.equal(loadPrinterConfig().name, "XP-80", "an existing till keeps its printer");
  setActiveStoreId("222222");
  assert.equal(loadPrinterConfig().type, "", "another takeaway does not inherit it");
  assert.equal(loadPrinterConfig().autoPrint, false);

  savePrinterConfig({ ...loadPrinterConfig(), type: "bluetooth", name: "BT-58", paper: "58" });
  setActiveStoreId("111111");
  savePrinterConfig({ ...loadPrinterConfig(), kotPrint: true });
  setActiveStoreId("222222");
  assert.equal(loadPrinterConfig().kotPrint, false, "Takeaway 1's change must not reach Takeaway 2");
  assert.equal(loadPrinterConfig().name, "BT-58");
  setActiveStoreId("111111");
  const t1 = loadPrinterConfig();
  assert.deepEqual([t1.name, t1.paper, t1.kotPrint], ["XP-80", "80", true]);
});
