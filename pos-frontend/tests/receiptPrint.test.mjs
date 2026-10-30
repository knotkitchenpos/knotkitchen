import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { layoutKot, layoutReceipt, layoutReport, billLines, wrap, PAPER } from "../src/utils/receiptLayout.js";
import { itemDisplayName } from "../src/utils/orderItems.js";
import { rasterJob, TEAR_FEED_DOTS, toMonochrome } from "../src/utils/escpos.js";

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
  // Init, one 1-byte-wide row of ink, then straight to the cut: the 249 white
  // rows under it are never sent.
  assert.deepEqual([...job], [0x1b, 0x40, 0x1d, 0x76, 0x30, 0, 1, 0, 1, 0, 0x80, 0x1d, 0x56, 0x42, 0]);
});

/** Plays a job back into rows of bits, the way the printer lays them on paper. */
const playBack = (job, rowBytes) => {
  const rows = [];
  for (let i = 2; i < job.length; ) {
    if (job[i] === 0x1b && job[i + 1] === 0x4a) {
      for (let n = 0; n < job[i + 2]; n += 1) rows.push(new Uint8Array(rowBytes));
      i += 3;
    } else if (job[i] === 0x1d && job[i + 1] === 0x76) {
      const w = job[i + 4] + job[i + 5] * 256;
      const h = job[i + 6] + job[i + 7] * 256;
      for (let r = 0; r < h; r += 1) {
        const row = new Uint8Array(rowBytes);
        row.set(job.subarray(i + 8 + r * w, i + 8 + (r + 1) * w));
        rows.push(row);
      }
      i += 8 + w * h;
    } else if (job[i] === 0x1d && job[i + 1] === 0x56) {
      break;
    } else {
      throw new Error(`unexpected byte ${job[i]} at ${i}`);
    }
  }
  return rows;
};

test("REGRESSION: only the ink is sent, and the paper comes out the same", () => {
  // A receipt-like page: 576 dots wide, lines of text with gaps between them,
  // most of them ending well before the right edge, and a long gap (> 255 dots).
  const width = 576;
  const rowBytes = width / 8;
  const height = 900;
  const bits = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const line = Math.floor(y / 27);
    if (y % 27 >= 21 || (y >= 300 && y < 600)) continue; // gaps between lines, and one long gap
    const ink = line % 3 === 0 ? rowBytes : 20 + (line % 7) * 5; // right-aligned prices on some lines
    for (let b = 0; b < ink; b += 3) bits[y * rowBytes + b] = 0b10110001;
  }
  const job = rasterJob(bits, width, height);
  assert.ok(job.length < bits.length * 0.6, `sent ${job.length} of ${bits.length} bytes`);
  const rows = playBack(job, rowBytes);
  let lastInk = height - 1;
  while (bits.subarray(lastInk * rowBytes, (lastInk + 1) * rowBytes).every((v) => v === 0)) lastInk -= 1;
  assert.equal(rows.length, lastInk + 1, "same height down to the last line of ink");
  for (let y = 0; y < rows.length; y += 1) {
    assert.deepEqual([...rows[y]], [...bits.subarray(y * rowBytes, (y + 1) * rowBytes)], `row ${y}`);
  }
  // REGRESSION (photo: lines ran together on an Epson-style printer): no ESC J.
  // It feeds in the printer's own unit (1/180" or 1/360"), so gaps came out short.
  assert.ok(!job.some((v, i) => v === 0x1b && job[i + 1] === 0x4a), "gaps go out as blank raster rows");
});

test("Device Configuration has no Printer type or Paper end choice: a receipt printer that cuts", () => {
  const screen = SRC("src/components/settings/DeviceConfiguration.jsx");
  assert.doesNotMatch(screen, /Printer type|Paper end|Tear-off|Auto-cutter/);
  // Reconnecting puts a receipt printer back on ESC/POS; only a mini printer's name switches it.
  assert.match(screen, /\.\.\.\(cat \? \{ protocol: "cat", paper: "58" \} : \{ protocol: "escpos" \}\),/);
  assert.match(
    SRC("src/utils/printReceipt.js"),
    // Every paper size feeds past the tear bar: 3-inch printers without a cutter exist too (owner, 2026-10-30).
    /encode\(bits, canvas\.width, canvas\.height, \{ tearFeed: TEAR_FEED_DOTS \}\)/,
  );
});

test("REGRESSION: a 2-inch receipt feeds out past the tear bar; a 3-inch one only cuts", () => {
  const width = 16;
  const bits = new Uint8Array(2 * 10);
  bits[0] = 0x80; // ink on the first row, nine blank rows under it
  const cut = [0x1d, 0x56, 0x42, 0];
  const threeInch = rasterJob(bits, width, 10);
  assert.deepEqual([...threeInch.slice(-4)], cut);
  // The cut follows the last band of ink directly.
  assert.deepEqual([...threeInch.slice(-5, -4)], [0x80]);
  assert.ok(!threeInch.some((v, i) => v === 0x1b && threeInch[i + 1] === 0x4a), "no feed before a cutter's cut");
  // The receipt in the photo ended at "Paid by / Cash", the rest still inside.
  const twoInch = rasterJob(bits, width, 10, { tearFeed: TEAR_FEED_DOTS });
  // Exactly TEAR_FEED_DOTS blank raster rows (dots on any printer), then the cut.
  assert.deepEqual([...twoInch.slice(-4)], cut);
  assert.equal(playBack(twoInch, 2).length - playBack(threeInch, 2).length, TEAR_FEED_DOTS);
  assert.ok(!twoInch.some((v, i) => v === 0x1b && twoInch[i + 1] === 0x4a), "no ESC J: its unit varies by printer");
  assert.ok(TEAR_FEED_DOTS >= 80 && TEAR_FEED_DOTS <= 160, "10-20 mm: past the tear bar, not a long blank strip");
});

test("every receipt print goes through the one renderer", () => {
  assert.match(SRC("src/components/invoice/Invoice.jsx"), /printOrderReceipt\(safeOrder\)/);
  assert.match(SRC("src/pages/Orders.jsx"), /printOrderReceipt\(selected\)/);
  assert.match(SRC("src/hooks/useAutoReceiptPrint.js"), /onlineOrder:created/);
  assert.match(SRC("src/App.jsx"), /useAutoReceiptPrint\(\);/);
  // LAN is a transport of its own: the tab takes the printer's IP address
  // (lanPrinter.test.mjs), and receipts go through the same renderer.
  const device = SRC("src/components/settings/DeviceConfiguration.jsx");
  assert.doesNotMatch(device, /key: "lan", label: "LAN \/ Network", disabled: true/);
  assert.match(device, /tab === "lan"/);
  assert.match(device, /probeLanPrinter\(host\)/);
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
  // Owner, 2026-10-13: the kitchen ticket says what it is, unlike the bill.
  assert.equal(texts[0], "KITCHEN ORDER");
  assert.ok(!texts.includes("ADDED ITEMS"), "an order's first ticket is not a round");
  assert.equal(textOps(layout)[1].text, "Asha's", "the store name under it");
  assert.ok(Number(/(\d+)px/.exec(textOps(layout)[1].font)[1]) < Number(/(\d+)px/.exec(textOps(layout)[0].font)[1]), "and small");
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
  // Two lines on 58 mm, not one wrapped heading.
  assert.deepEqual(rt.slice(0, 2), ["KITCHEN ORDER", "ADDED ITEMS"]);
  assert.ok(!rt.some((t) => t.startsWith("Paneer")));
  assert.equal(round.width, PAPER[58].width);
});

test("Auto KOT prints on new orders and on table rounds", () => {
  const hook = SRC("src/hooks/useAutoReceiptPrint.js");
  assert.match(hook, /socket\.on\("kitchen:round", onRound\)/);
  assert.match(hook, /if \(config\.kotPrint && !settled\) \{\s+await printKot\(order/);
  const socket = fs.readFileSync(path.join(__dirname, "..", "..", "pos-backend", "services", "socket.js"), "utf8");
  assert.match(socket, /emitEvent\("kitchen:round", payload, rooms\)/);
});

test("D4: a customer's order prints when staff accept it; a till order when it is rung up", () => {
  // Owner, 2026-10-13: table QR, website and Knot Eats orders printed on
  // arrival, so a declined order still reached the kitchen.
  const hook = SRC("src/hooks/useAutoReceiptPrint.js");
  assert.match(hook, /const onCreated = \(payload\) => \(payload\?\.placedVia === "QR" \|\| payload\?\.source === "WEBSITE" \? undefined : printNewOrder\(payload\)\);/);
  assert.match(hook, /socket\.on\("onlineOrder:accepted", printNewOrder\)/);
  assert.match(hook, /socket\.off\("onlineOrder:accepted", printNewOrder\)/);
  const socket = fs.readFileSync(path.join(__dirname, "..", "..", "pos-backend", "services", "socket.js"), "utf8");
  assert.match(socket, /emitEvent\("onlineOrder:accepted", payload, rooms\)/);
  // A sale taken offline: never a receipt on its sync, and a KOT only when its till printed none (O1).
  const printNew = hook.slice(hook.indexOf("const printNewOrder"), hook.indexOf("const onCreated"));
  assert.ok(printNew.indexOf("if (order.isOffline && (order.kotPrinted || !config.kotPrint)) return;") > printNew.indexOf("getOrderById("), "checked on the fetched order");
  // A device with only a kitchen printer still prints KOTs, new orders and rounds alike.
  assert.match(printNew, /const wantKot = !settled && config\.kotPrint && kitchenPrinter\(config\)\.type;/);
  const onRound = hook.slice(hook.indexOf("const onRound"), hook.indexOf("socket.on("));
  assert.match(onRound, /!kitchenPrinter\(config\)\.type/);
  assert.doesNotMatch(onRound, /!config\.type/);
});

test("KOTs go to the kitchen printer when one is set up, else the receipt printer", async () => {
  const { kitchenPrinter } = await import("../src/utils/printerDevice.js");
  const old = { type: "usb", name: "XP-80", paper: "80", protocol: "escpos", kotPrint: true };
  assert.equal(kitchenPrinter(old), old, "a saved config from before the kitchen slot");
  const unset = { ...old, kitchen: { type: "" } };
  assert.equal(kitchenPrinter(unset), unset, "an empty kitchen slot");
  const split = { ...old, kitchen: { type: "bluetooth", name: "BT-58", paper: "58", bluetooth: { address: "AA:BB" } } };
  const k = kitchenPrinter(split);
  assert.deepEqual([k.type, k.name, k.paper, k.protocol, k.bluetooth.address], ["bluetooth", "BT-58", "58", "escpos", "AA:BB"]);
  assert.equal(kitchenPrinter({ ...old, kitchen: { type: "usb", name: "K" } }).paper, "80", "the defaults fill the slot");
  // Only the KOT is routed: bills and reports stay on the receipt printer,
  // and there is no KOT copy on the receipt printer once a kitchen one is set.
  const print = SRC("src/utils/printReceipt.js");
  assert.equal(print.match(/kitchenPrinter\(/g).length, 1);
  const kot = print.slice(print.indexOf("export const printKot"), print.indexOf("export const printReport"));
  assert.match(kot, /const printer = kitchenPrinter\(config \|\| loadPrinterConfig\(\)\);/);
  // A receipt and a kitchen printer on Web Bluetooth stay connected together.
  const device = SRC("src/utils/printerDevice.js");
  assert.match(device, /const bts = new Map\(\);/);
  assert.match(device, /bts\.set\(key, link\);/);
  assert.doesNotMatch(device, /let bt = null/);
  // Device Configuration: one slot each, the kitchen one can be cleared.
  const screen = SRC("src/components/settings/DeviceConfiguration.jsx");
  assert.equal(screen.match(/<PrinterSlot\n/g).length, 2);
  assert.match(screen, /title="Kitchen Printer \(KOT\)"/);
  assert.match(screen, /emptyLabel="Uses receipt printer"/);
  assert.match(screen, /onClear=\{\(\) => patchDevice\(\{ kitchen: undefined \}\)\}/);
  assert.match(screen, /const testKot = async \(\) => \{\s+try \{\s+const \{ via \} = await printKot\(SAMPLE_ORDER, \{ config: device, context \}\);/);
  assert.match(screen, /if \(device\.kotPrint && !device\.type && !device\.kitchen\?\.type\) \{/);
});

test("a pre-order's KOT says when it is wanted, on the store's clock", () => {
  const saved = process.env.TZ;
  process.env.TZ = "Europe/London";
  try {
    // 14:00 UTC is 7:30 pm in India.
    const order = { ...ORDER, scheduledFor: "2026-10-14T14:00:00Z" };
    const ops = textOps(layoutKot({ order, paper: 58, measure }));
    const label = ops.find((o) => o.text === "For");
    assert.ok(label, "a For line");
    const value = ops.find((o) => o.y === label.y && o.align === "right");
    assert.match(value.text, /14 Oct.*07:30\s?pm/i);
    assert.match(value.font, /^600 /); // bold prints at weight 600
    assert.ok(!textOps(layoutKot({ order: ORDER, paper: 58, measure })).some((o) => o.text === "For"), "not on an order for now");
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});

test("Windows app: a system printer prints silently through window.knotDesktop", () => {
  const src = SRC("src/utils/printReceipt.js");
  assert.match(src, /printer\.type === "system" && desktopPrinting\(\)/);
  assert.match(src, /window\.knotDesktop\.printHtml\(html, \{ printer: printer\.systemPrinter/);
  // The dialog path stays for plain browsers.
  assert.match(src, /printCanvasWithDialog\(canvas, paper\);\n  return \{ printed: true, via: "dialog" \}/);
  // The desktop shell exposes those calls, plus printLan for a LAN printer (lanPrinter.test.mjs).
  const preload = SRC("../pos-desktop/preload.js");
  assert.match(preload, /listPrinters:/);
  assert.match(preload, /printHtml:/);
  assert.match(preload, /printLan:/);
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
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
      key: (i) => [...m.keys()][i] ?? null,
      get length() {
        return m.size;
      },
    };
  };
  for (const n of ["localStorage", "sessionStorage"]) Object.defineProperty(globalThis, n, { value: mem(), configurable: true, writable: true });
  const { loadPrinterConfig, savePrinterConfig } = await import("../src/utils/printerDevice.js");
  const { setActiveStoreId } = await import("../src/utils/storeSession.js");

  localStorage.setItem("kk.receiptPrinter.v1", JSON.stringify({ type: "usb", name: "XP-80", autoPrint: true, kotPrint: true })); // before the fix
  setActiveStoreId("111111");
  assert.equal(loadPrinterConfig().name, "XP-80", "an existing till keeps its printer");
  // REGRESSION (e456bca): the second takeaway on the device started blank --
  // no printer, no Auto KOT -- and printed nothing without a word.
  setActiveStoreId("222222");
  assert.equal(loadPrinterConfig().name, "XP-80", "every takeaway starts from the device's printer");
  assert.equal(loadPrinterConfig().kotPrint, true, "and keeps Auto KOT on");
  assert.ok(localStorage.getItem("kk.receiptPrinter.v1") !== null, "the shared record is never deleted (an old tab still reads it)");

  savePrinterConfig({ ...loadPrinterConfig(), type: "bluetooth", name: "BT-58", paper: "58" });
  setActiveStoreId("111111");
  savePrinterConfig({ ...loadPrinterConfig(), kotPrint: false });
  setActiveStoreId("222222");
  assert.equal(loadPrinterConfig().kotPrint, true, "Takeaway 1's change must not reach Takeaway 2");
  assert.equal(loadPrinterConfig().name, "BT-58");
  setActiveStoreId("111111");
  const t1 = loadPrinterConfig();
  assert.deepEqual([t1.name, t1.paper, t1.kotPrint], ["XP-80", "80", false]);

  // A device where the old build already deleted the shared record: a takeaway
  // left blank by it picks up the printer another takeaway has.
  localStorage.removeItem("kk.receiptPrinter.v1");
  setActiveStoreId("333333");
  assert.ok(["XP-80", "BT-58"].includes(loadPrinterConfig().name));
  // ...never a takeaway's blank record, which would then stick.
  localStorage.clear?.();
  for (const k of ["kk.receiptPrinter.v1:111111", "kk.receiptPrinter.v1:222222", "kk.receiptPrinter.v1:333333"]) localStorage.removeItem(k);
  localStorage.setItem("kk.receiptPrinter.v1:444444", JSON.stringify({ type: "", kotPrint: true }));
  localStorage.setItem("kk.receiptPrinter.v1:555555", JSON.stringify({ type: "usb", name: "XP-80" }));
  setActiveStoreId("666666");
  assert.equal(loadPrinterConfig().name, "XP-80");
});

test("REGRESSION: website orders show the dish's variant on the KOT and receipt", () => {
  // Website lines keep the variant only in `variant`; the name is the bare dish.
  const web = { name: "Margherita Pizza", quantity: 1, variant: { name: "Large" }, modifiers: [{ name: "Large", price: 0 }, { name: "Extra Cheese", price: 40 }] };
  assert.equal(itemDisplayName(web), "Margherita Pizza (Large)");
  // Till and table lines already carry it: never twice.
  assert.equal(itemDisplayName({ name: "Margherita Pizza (Large)", variant: { name: "Large" } }), "Margherita Pizza (Large)");
  assert.equal(itemDisplayName({ name: "Tea" }), "Tea");
  const kot = textOps(layoutKot({ order: { items: [web] }, store: { name: "S" }, paper: 80, measure })).map((o) => o.text).join(" | ");
  assert.match(kot, /Margherita Pizza \(Large\)/);
  assert.match(kot, /\+ Extra Cheese/);
});

test("reports print on the receipt roll, and never as a page inside the Android app", () => {
  const layout = layoutReport({
    title: "Sales Report",
    store: { name: "Demo Store 1", address: "12 MG Road" },
    period: "Today",
    sections: [
      { title: "Summary", rows: [["Total sales", "12 · ₹2,400.00"]] },
      { title: "Top dishes", rows: [["A very long dish name that has to wrap onto another line", "3 · ₹540.00"]] },
      { title: "Empty", rows: [] },
    ],
    paper: 58,
    measure,
  });
  assert.equal(layout.width, PAPER[58].width);
  const texts = textOps(layout).map((o) => o.text);
  for (const t of ["Sales Report", "Demo Store 1", "Summary", "Total sales", "12 · ₹2,400.00", "Top dishes"]) assert.ok(texts.includes(t), t);
  assert.ok(!texts.includes("Empty"), "a section with no rows is left out");
  for (const op of textOps(layout)) assert.ok(op.x <= PAPER[58].width, "nothing runs off the roll");

  const reports = SRC("src/pages/Reports.jsx");
  // printWithFeedback: a browser that forgot the Bluetooth printer gets a Reconnect tap here too.
  assert.match(reports, /if \(printer\.type \|\| nativePrinting\) \{[^}]*await printWithFeedback\("report", \(\) => printReport\(buildReceiptReport\(input\), \{ config: printer \}\)\);/);
  // In the app window.open returned the POS page itself and the report replaced the till.
  assert.match(SRC("src/utils/printDocument.js"), /if \(Capacitor\.isNativePlatform\(\)\) \{\s*throw new Error\(/);
});

test("a printed report is the summary cards only: no heading, no breakdowns", () => {
  const reports = SRC("src/pages/Reports.jsx");
  assert.match(reports, /const buildReceiptReport = \(\{ summary \}\) => \(\{ title: "", sections: \[\{ title: "", rows: summaryRows\(summary\) \}\] \}\);/);
  // The A4 page too: one table of the same rows.
  const page = reports.slice(reports.indexOf("const buildPrintHtml"), reports.indexOf("/** One of the four breakdown tables on screen. */"));
  assert.match(page, /<table>\$\{summaryRows\(summary\)\.map\(row\)\.join\(""\)\}<\/table>/);
  assert.doesNotMatch(page, /BREAKDOWN_TABLES|Period|Generated|<h1>/);

  const slip = layoutReport({ title: "", sections: [{ title: "", rows: [["Total Orders", "3 · ₹1904.00"], ["Cash Orders", "3 · ₹1904.00"]] }], paper: 80, measure });
  const ops = slip.ops;
  assert.equal(ops[0].type, "text", "starts at the first card, with no heading or rule above it");
  assert.deepEqual(textOps(slip).map((o) => o.text), ["3 · ₹1904.00", "Total Orders", "3 · ₹1904.00", "Cash Orders"]);
});

test("the order receipt closes itself after 6 seconds, or on a tap outside it", () => {
  const src = SRC("src/components/invoice/Invoice.jsx");
  assert.match(src, /autoClose\.current = setTimeout\(close, 6000\);/);
  assert.match(src, /<div onClick=\{close\} className="fixed inset-0/, "tap outside closes");
  assert.match(src, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/, "a tap on the card does not");
  assert.match(src, /onPointerDown=\{\(\) => clearTimeout\(autoClose\.current\)\}/, "using the card keeps it open");
});

test("REGRESSION: receipts print in the font the POS ships, not the device's", () => {
  // Android has no Arial/Helvetica: "sans-serif" came out in the tablet's
  // system font (a handwriting theme on some tablets).
  const layout = SRC("src/utils/receiptLayout.js");
  assert.match(layout, /export const RECEIPT_FONT_NAME = "KK Receipt";/);
  assert.match(layout, /const FAMILY = `"\$\{RECEIPT_FONT_NAME\}", Arial, Helvetica, sans-serif`;/);
  const font = SRC("src/utils/receiptFont.js");
  assert.match(font, /import latin from "\.\.\/assets\/fonts\/geist-latin\.woff2";/);
  assert.match(font, /import latinExt from "\.\.\/assets\/fonts\/geist-latin-ext\.woff2";/, "latin-ext carries the rupee sign");
  assert.match(font, /U\+20AD-20C0/, "the rupee sign's range");
  for (const f of ["geist-latin.woff2", "geist-latin-ext.woff2"]) {
    assert.ok(fs.statSync(path.join(__dirname, "..", "src/assets/fonts", f)).size > 10000, `${f} is shipped`);
  }
  // Loaded before anything is measured or drawn, on every print path.
  const print = SRC("src/utils/printReceipt.js");
  assert.match(print, /ensureReceiptFont\(\),\n  \]\);/, "receipts");
  assert.match(print, /await ensureReceiptFont\(\);\n  const canvas = renderKotCanvas/, "KOTs");
  assert.match(print, /await ensureReceiptFont\(\);\n  const canvas = paintLayout\(\(measure\) => layoutReport/, "reports");
});

test("REGRESSION: an add-on uses the full width below the dish, not just the Item column", () => {
  const order = {
    ...ORDER,
    items: [
      {
        name: "Chicken Mushroom Sandwich",
        quantity: 1,
        price: 198,
        total: 198,
        modifiers: [{ name: "Club Sandwich - Two Layer Filling (3 Slices Of Bread)", price: 0 }],
      },
    ],
    bills: { subtotal: 198, total: 198, tax: 0, totalWithTax: 198 },
  };
  const layout = layoutReceipt({ order, store: { name: "S" }, paper: 80, measure });
  const ops = textOps(layout);
  const extra = ops.find((o) => o.text.startsWith("+ Club Sandwich"));
  // It reaches past where the Rate column starts: the Item column alone
  // could never hold it.
  const rateLeft = span(ops.find((o) => o.text === "Rate"))[0];
  assert.ok(span(extra)[1] > rateLeft, `"${extra.text}" stops inside the Item column`);
  // Still never on the dish's first line, where the numbers are.
  assert.ok(extra.y > ops.find((o) => o.text === "198.00").y);
});

test("REGRESSION: a delivery receipt prints where it goes, and stays on the paper", () => {
  for (const paper of [58, 80]) {
    const order = {
      ...ORDER,
      orderType: "delivery",
      deliveryAddress: { line1: "12 MG Road, Near the Very Long Landmark Opposite the Park", city: "Kolkata", postalCode: "700001", instructions: "Ring twice" },
    };
    const layout = layoutReceipt({ order, store: { name: "S" }, paper, measure });
    const texts = textOps(layout).map((o) => o.text).join(" | ");
    assert.match(texts, /MG Road/);
    assert.match(texts, /700001/);
    assert.match(texts, /Note: Ring twice/);
    for (const op of textOps(layout)) {
      const [l, r] = span(op);
      assert.ok(l >= -0.5 && r <= layout.width + 0.5, `"${op.text}" runs off the paper`);
    }
  }
  // An older order kept the address flat on customerDetails.
  const flat = { ...ORDER, orderType: "delivery", customerDetails: { name: "A", phone: "9876543210", address: "5 Park St", pinCode: "700016" } };
  const flatText = textOps(layoutReceipt({ order: flat, store: { name: "S" }, paper: 80, measure })).map((o) => o.text).join(" ");
  assert.match(flatText, /5 Park St.*700016/);
  // Not on a counter order.
  const counter = { ...ORDER, deliveryAddress: { line1: "12 MG Road" } };
  assert.ok(!textOps(layoutReceipt({ order: counter, store: { name: "S" }, paper: 80, measure })).some((o) => /MG Road/.test(o.text)));
});

test("REGRESSION: the KOT prints the note a saved order keeps", () => {
  const website = { ...ORDER, deliveryAddress: { line1: "x", instructions: "Less spicy" } };
  assert.ok(textOps(layoutKot({ order: website, paper: 80, measure })).some((o) => o.text.includes("Less spicy")));
  const till = { ...ORDER, customerDetails: { name: "A", deliveryNote: "No onion" } };
  assert.ok(textOps(layoutKot({ order: till, paper: 80, measure })).some((o) => o.text.includes("No onion")));
});

test("REGRESSION: included GST is labelled, so it does not read as an extra charge", () => {
  const bills = { subtotal: 100, tax: 4.76, taxPercent: 5, taxInclusive: true, totalWithTax: 100 };
  assert.deepEqual(billLines(bills).map((l) => l.label), ["Subtotal", "GST @ 5% (incl.)"]);
  assert.deepEqual(billLines(bills, 0, { gstSplit: true }).map((l) => l.label), ["Subtotal", "CGST @ 2.5% (incl.)", "SGST @ 2.5% (incl.)"]);
  assert.deepEqual(billLines({ ...bills, taxInclusive: false, totalWithTax: 104.76 }).map((l) => l.label), ["Subtotal", "GST @ 5%", "Total"]);
  assert.match(SRC("src/components/invoice/Invoice.jsx"), /safeBills\.taxInclusive \? " \(incl\.\)" : ""/);
});

test("REGRESSION: receipt and KOT times are the store's clock, not the device's", () => {
  const saved = process.env.TZ;
  process.env.TZ = "Europe/London";
  try {
    // 12:30 UTC is 6:00 pm in India and 1:30 pm in London.
    const bill = textOps(layoutReceipt({ order: ORDER, store: { name: "S" }, paper: 80, measure })).map((o) => o.text).join(" ");
    assert.match(bill, /06:00\s?pm/i);
    const kot = textOps(layoutKot({ order: ORDER, paper: 80, measure })).map((o) => o.text).join(" ");
    assert.match(kot, /06:00\s?pm/i);
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});

test("REGRESSION: Print and KOT say they are sending, and whether it went", () => {
  const print = SRC("src/utils/printReceipt.js");
  assert.match(print, /export const printWithFeedback = async \(what, run\) =>/);
  // The notice goes up before the print is awaited, not after it fails.
  assert.match(print, /persist: true \}\);\s+try \{\s+const result = await run\(\);/);
  assert.match(SRC("src/components/invoice/Invoice.jsx"), /printWithFeedback\("receipt", \(\) => printOrderReceipt\(safeOrder\)\)/);
  const orders = SRC("src/pages/Orders.jsx");
  assert.match(orders, /printWithFeedback\("receipt", \(\) => printOrderReceipt\(selected\)\)/);
  assert.match(orders, /printWithFeedback\("KOT", \(\) => printKot\(selected\)\)/);
});

test("REGRESSION: no E-Bill for an offline order or a phone that is not a mobile", () => {
  const src = SRC("src/components/invoice/Invoice.jsx");
  const guard = src.slice(src.indexOf("const canSendEBill"), src.indexOf("const [emailedTo"));
  assert.ok(guard.includes("/^[6-9]\\d{9}$/"), guard);
  assert.match(guard, /!safeOrder\.offline/);
});

test("REGRESSION O1: a synced offline sale prints its KOT on the kitchen device unless its own till printed one; never a receipt", async () => {
  const hook = SRC("src/hooks/useAutoReceiptPrint.js");
  const src = hook.slice(hook.indexOf("const printNewOrder"), hook.indexOf("// D4: a customer's order"));
  const run = async (order, config, payload = { orderId: "o1" }, opts) => {
    const out = [];
    const printNewOrder = new Function(
      "loadPrinterConfig", "kitchenPrinter", "claim", "getOrderById", "enqueueSnackbar", "printKot", "printOrderReceipt", "warnNotPrinted",
      `${src}
return printNewOrder;`,
    )(
      () => config,
      (c) => c.kitchen?.type ? c.kitchen : c,
      () => true,
      async () => ({ data: { data: order } }),
      () => {},
      async () => out.push("kot"),
      async () => out.push("receipt"),
      () => {},
    );
    await printNewOrder(payload, opts);
    return out;
  };
  const kitchen = { type: "usb", kotPrint: true, autoPrint: true };
  assert.deepEqual(await run({ isOffline: true }, kitchen), ["kot"], "the counter till had Auto KOT off: the kitchen still gets its ticket");
  assert.deepEqual(await run({ isOffline: true, kotPrinted: true }, kitchen), [], "its till printed it at sale time");
  assert.deepEqual(await run({ isOffline: true }, { ...kitchen, kotPrint: false }), [], "a receipt-only device prints nothing for it");
  assert.deepEqual(await run({ isOffline: false }, kitchen), ["kot", "receipt"], "a live sale is unchanged");
  // Owner, 2026-10-16: a table's KOT on Accept, its bill only when the till settles it.
  assert.deepEqual(await run({ tableSessionId: "s1" }, kitchen), ["kot"], "table accepted / rung up: KOT, no receipt");
  assert.deepEqual(await run({ tableSessionId: "s1" }, kitchen, { orderId: "o1", sessionId: "s1" }, { settled: true }), ["receipt"], "till settle: the bill, no second KOT");
  assert.deepEqual(await run({ tableSessionId: "s1" }, { ...kitchen, autoPrint: false }, { orderId: "o1", sessionId: "s1" }, { settled: true }), [], "Auto Receipt Print off: nothing at settle");
  assert.deepEqual(await run({ tableSessionId: "s1" }, { ...kitchen, kotPrint: false }), [], "Auto KOT off: nothing on Accept");
  assert.deepEqual(await run({}, { ...kitchen, kotPrint: false }), ["receipt"], "website / Knot Eats on Accept: receipt as before");
});

test("REGRESSION: a table's bill prints once, on a till settle only; a phone payment gets the e-bill alone", async () => {
  // Owner, 2026-10-16, rules 3-5.
  const hook = SRC("src/hooks/useAutoReceiptPrint.js");
  assert.match(hook, /socket\.on\("tableSessionUpdated", onTablePaid\)/);
  assert.match(hook, /socket\.off\("tableSessionUpdated", onTablePaid\)/);
  // Its own claim key: the Accept-time claim on the same order must not block the bill.
  assert.match(hook, /claim\(settled \? `paid:\$\{payload\.orderId\}` : payload\.orderId\)/);
  const src = hook.slice(hook.indexOf("const onTablePaid"), hook.indexOf("// Lines added to a table mid-meal"));
  const calls = [];
  const onTablePaid = new Function("printNewOrder", `${src}
return onTablePaid;`)((...a) => calls.push(a));
  const paid = { reason: "paid", orderId: "o1", sessionId: "s1" };
  onTablePaid({ ...paid, settledVia: "POS" });
  assert.deepEqual(calls, [[{ ...paid, settledVia: "POS" }, { settled: true }]], "cash / UPI / card / split at the till");
  for (const p of [
    { ...paid, settledVia: "QR" },
    { ...paid, settledVia: "PAYMENT_LINK" },
    { ...paid, settledVia: "ONLINE" },
    { ...paid, reason: "payment_failed", settledVia: "POS" },
    { reason: "items_added", sessionId: "s1" },
    { reason: "paid", sessionId: "s1" },
  ]) onTablePaid(p);
  assert.equal(calls.length, 1, "QR / online / link payment, a failed attempt or a new round print no receipt");

  // The claim: the same settle heard twice on one device prints one bill.
  const claimSrc = hook.slice(hook.indexOf("const PRINTED_KEY"), hook.indexOf("const useAutoReceiptPrint"));
  const store = {};
  const localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  const claim = new Function("localStorage", `${claimSrc}
return claim;`)(localStorage);
  assert.equal(claim("o1"), true, "Accept");
  assert.equal(claim("paid:o1"), true, "settle, after Accept claimed the order");
  assert.equal(claim("paid:o1"), false, "never twice");

  // The setting carries no note now (owner, 2026-10-29); none may promise an e-bill either.
  const screen = SRC("src/components/settings/DeviceConfiguration.jsx");
  assert.doesNotMatch(screen, /gets the e-bill instead/);
});

test("REGRESSION: a failed automatic print stays on screen with Retry (printer asleep)", async () => {
  // Owner, 2026-10-16 (POS58 "keeps disconnecting"): an Auto KOT or receipt to a
  // printer that had switched itself off was a 3-second toast, and the ticket was lost.
  const hook = SRC("src/hooks/useAutoReceiptPrint.js");
  assert.doesNotMatch(hook, /enqueueSnackbar\(`(KOT|Receipt) not printed/);
  assert.equal(hook.match(/warnNotPrinted\(/g).length, 3, "new order KOT, receipt and table round");
  // Retry prints with the printer saved at that moment, not the one that failed.
  assert.match(hook, /warnNotPrinted\("KOT", err, \(\) => printKot\(order, \{ auto: true \}\)\)/);
  assert.match(hook, /warnNotPrinted\("Receipt", err, \(\) => printOrderReceipt\(order, \{ auto: true \}\)\)/);
  assert.match(hook, /warnNotPrinted\("KOT", err, \(\) => printKot\(ticket, opts\)\)/);
  assert.match(SRC("src/components/pos/OrderPanel.jsx"), /warnNotPrinted\("KOT", e, \(\) => printKot\(localOrderView\(entry\), \{ auto: true \}\)\.then\(\(\) => markKotPrinted\(localId\)\)\)/);
  // A pressed Print whose browser forgot the Bluetooth printer gets the same Reconnect tap.
  const print = SRC("src/utils/printReceipt.js");
  assert.match(print, /if \(err\?\.code === "BT_RECONNECT"\) return warnNotPrinted\(What, err, \(\) => printWithFeedback\(what, run\)\);/);

  // warnNotPrinted itself, with notistack and React faked.
  const make = (reconnect = async () => {}, linked = () => false) => {
    const shown = [];
    const closed = [];
    const reconnected = [];
    const warnNotPrinted = loadWarnNotPrinted(shown, closed, (printer) => {
      reconnected.push(printer);
      return reconnect(printer);
    }, linked);
    const button = (n, label) => shown[n].action(`k${n}`).children.find((c) => c.children[0] === label);
    return { warnNotPrinted, shown, closed, reconnected, button };
  };
  const settle = () => new Promise((r) => setImmediate(r));

  // Stays until dealt with, says why, and Retry prints again once.
  const a = make();
  let tries = 0;
  a.warnNotPrinted("KOT", new Error("Could not reach the Bluetooth printer."), async () => { tries += 1; });
  assert.equal(a.shown[0].msg, "KOT not printed: Could not reach the Bluetooth printer.");
  assert.equal(a.shown[0].variant, "warning");
  assert.equal(a.shown[0].persist, true);
  assert.ok(a.button(0, "Dismiss"), "a Dismiss too");
  a.button(0, "Retry").props.onClick();
  await settle();
  assert.deepEqual(a.closed, ["k0"]);
  assert.equal(tries, 1);
  assert.equal(a.shown.length, 1, "printed: nothing more on screen");
  assert.equal(a.reconnected.length, 0, "no chooser for an ordinary failure");

  // Still asleep: Retry fails, and a new warning with Retry takes its place.
  const b = make();
  b.warnNotPrinted("Receipt", new Error("asleep"), () => Promise.reject(new Error("still asleep")));
  b.button(0, "Retry").props.onClick();
  await settle();
  assert.equal(b.shown.length, 2);
  assert.equal(b.shown[1].msg, "Receipt not printed: still asleep");
  assert.ok(b.button(1, "Retry"));

  // Dismiss only closes it.
  const c = make();
  let never = 0;
  c.warnNotPrinted("KOT", new Error("x"), async () => { never += 1; });
  c.button(0, "Dismiss").props.onClick();
  await settle();
  assert.deepEqual([c.closed, never], [["k0"], 0]);

  // A browser that forgot the printer: the tap opens its chooser at once (it needs the tap), then prints.
  const printer = { type: "bluetooth", bluetooth: { id: "x", name: "POS58" } };
  const forgot = Object.assign(new Error("tap Reconnect"), { code: "BT_RECONNECT", printer });
  const d = make();
  let printed = 0;
  d.warnNotPrinted("KOT", forgot, async () => { printed += 1; });
  assert.equal(d.button(0, "Retry"), undefined);
  d.button(0, "Reconnect").props.onClick();
  assert.deepEqual(d.reconnected, [printer], "requestDevice inside the click, not after an await");
  await settle();
  assert.equal(printed, 1);

  // Closing the chooser keeps the Reconnect offer.
  const e = make(() => Promise.reject(Object.assign(new Error("User cancelled the requestDevice() chooser."), { name: "NotFoundError" })));
  e.warnNotPrinted("KOT", forgot, async () => assert.fail("not printed without a printer"));
  e.button(0, "Reconnect").props.onClick();
  await settle();
  assert.equal(e.shown[1].msg, "KOT not printed: tap Reconnect");
  assert.ok(e.button(1, "Reconnect"));

  // Another ticket's Reconnect linked the printer meanwhile: no second chooser, it just prints.
  const g = make(undefined, () => true);
  let linkedPrints = 0;
  g.warnNotPrinted("Receipt", forgot, async () => { linkedPrints += 1; });
  g.button(0, "Reconnect").props.onClick();
  await settle();
  assert.deepEqual([g.reconnected.length, linkedPrints], [0, 1]);
});

/** warnNotPrinted with its shared list, from source, with notistack and React faked; keys are k0, k1, ... */
function loadWarnNotPrinted(shown, closed, reconnect, linked) {
  const print = SRC("src/utils/printReceipt.js");
  const src = print.slice(print.indexOf("const unprinted = []"), print.indexOf("/** A sample order for Test Print. */")).replace(/export /g, "");
  return new Function(
    "enqueueSnackbar", "closeSnackbar", "createElement", "Fragment", "reconnectBluetoothPrinter", "bluetoothLinked",
    `${src}\nreturn warnNotPrinted;`,
  )(
    (msg, opts) => {
      shown.push({ msg, ...opts });
      return `k${shown.length - 1}`;
    },
    (key) => closed.push(key),
    (type, props, ...children) => ({ type, props: props || {}, children }),
    "Fragment",
    reconnect,
    linked,
  );
}

test("REGRESSION: a rush of failed prints is ONE warning, never dropped, and Retry all prints each once", async () => {
  // notistack shows 3 toasts and, when all 3 persist, closes the oldest for the
  // 4th, Retry and all: Order 1's KOT was lost when Order 2's receipt failed.
  const shown = [];
  const closed = [];
  const warnNotPrinted = loadWarnNotPrinted(shown, closed, () => assert.fail("no chooser"), () => true);
  const open = () => shown.map((_, i) => `k${i}`).filter((k) => !closed.includes(k));
  const button = (n, label) => shown[n].action(`k${n}`).children.find((c) => c.children[0] === label);
  const settle = () => new Promise((r) => setImmediate(r));

  const ran = [];
  const job = (name, ok = true) => async () => {
    ran.push(name);
    if (!ok) throw new Error(`${name} still asleep`);
  };
  const asleep = new Error("asleep");
  warnNotPrinted("KOT", asleep, job("kot1"));
  warnNotPrinted("Receipt", asleep, job("receipt1", false));
  warnNotPrinted("KOT", asleep, job("kot2"));
  warnNotPrinted("Receipt", asleep, job("receipt2"));
  assert.deepEqual(open(), ["k3"], "one warning on screen, whatever the count");
  assert.ok(shown.every((s) => s.persist && s.variant === "warning"));
  assert.equal(shown[3].msg, "4 tickets not printed (KOT, Receipt, KOT, Receipt): asleep");

  // A replaced warning is still fading out: tapping it does nothing.
  button(0, "Retry").props.onClick();
  button(0, "Dismiss").props.onClick();
  await settle();
  assert.deepEqual([ran, open()], [[], ["k3"]]);

  // Retry all, tapped twice before the toast leaves: each ticket once, in order; the failure stays.
  const retry = button(3, "Retry all");
  retry.props.onClick();
  retry.props.onClick();
  await settle();
  assert.deepEqual(ran, ["kot1", "receipt1", "kot2", "receipt2"]);
  assert.deepEqual(open(), ["k4"]);
  assert.equal(shown[4].msg, "Receipt not printed: receipt1 still asleep");
  assert.ok(button(4, "Retry"));
});

test("REGRESSION: bold prints at weight 600, so wide strokes print solid on a battery thermal printer", async () => {
  // Full bold titles and dish names came out grey and speckled (owner, 2026-10-29).
  const { font, BOLD_WEIGHT } = await import("../src/utils/receiptLayout.js");
  assert.equal(BOLD_WEIGHT, 600);
  assert.match(font(28, true), /^600 28px "KK Receipt"/);
  assert.match(font(20), /^20px "KK Receipt"/, "body text stays at the regular weight");
});
