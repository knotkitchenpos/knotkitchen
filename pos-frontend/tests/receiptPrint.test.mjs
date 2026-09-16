import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { layoutReceipt, billLines, wrap, PAPER } from "../src/utils/receiptLayout.js";
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

test("the columns are Item | Rate | Quantity | Price, with the extras under the item", () => {
  const ops = textOps(layoutReceipt({ order: ORDER, store: { name: "S" }, paper: 80, measure }));
  const header = ops.filter((o) => ["Item", "Rate", "Quantity", "Qty", "Price"].includes(o.text)).map((o) => o.text);
  assert.deepEqual(header.slice(0, 4).map((t) => (t === "Qty" ? "Quantity" : t)), ["Item", "Rate", "Quantity", "Price"]);
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
