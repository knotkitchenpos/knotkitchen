import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CARD, fitLines, qrFromSvg } from "../src/utils/tableQrCard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

test("the card is A6 at 300 dpi, drawn top to bottom: logo, name, QR, table", () => {
  assert.deepEqual(CARD, { width: 1240, height: 1754 });
  const card = SRC("src/utils/tableQrCard.js");
  const order = ["// 1. Logo.", "// 2. Restaurant name", "// 3. QR,", "// 4. Table name."].map((m) => card.indexOf(m));
  assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), `drawn in order: ${order}`);
});

test("REGRESSION: the QR is drawn from its outline at whole pixels per module, never a stretched bitmap", () => {
  const card = SRC("src/utils/tableQrCard.js");
  assert.match(card, /const k = Math\.max\(1, Math\.floor\(room \/ qr\.size\)\);/);
  assert.match(card, /g\.fill\(new Path2D\(qr\.d\)\);/);
  assert.doesNotMatch(card, /drawImage\(qr/);
  const modal = SRC("src/components/tables/PrintTableQRModal.jsx");
  assert.match(modal, /<QRCodeSVG ref=\{qrRef\} value=\{qrUrl\} level="H" marginSize=\{4\}/);
  assert.match(modal, /qr: qrUrl \? qrFromSvg\(qrRef\.current\) : null,/);
  // One image for preview, download and print.
  assert.match(modal, /<img src=\{card\}/);
  assert.match(modal, /canvas\.toBlob\(/);
  assert.match(modal, /<body><img src="\$\{card\}"/);
});

test("qrFromSvg reads the module grid and the dark-module path", () => {
  const svg = {
    getAttribute: (n) => (n === "viewBox" ? "0 0 61 61" : null),
    querySelectorAll: () => [{ getAttribute: () => "M0,0 h61v61H0z" }, { getAttribute: () => "M4 4h7v1H4z" }],
  };
  assert.deepEqual(qrFromSvg(svg), { size: 61, d: "M4 4h7v1H4z" });
  assert.equal(qrFromSvg(null), null);
});

test("a long restaurant name splits into two balanced lines, or reports that it does not fit", () => {
  const measure = (t) => t.length * 10;
  assert.deepEqual(fitLines("Demo Store 1", 200, measure), ["Demo Store 1"]);
  assert.deepEqual(fitLines("The Coffee Flavours Kitchen & Bar", 200, measure), ["The Coffee Flavours", "Kitchen & Bar"]);
  assert.equal(fitLines("Supercalifragilistic Expialidocious Restaurant", 100, measure), null);
});
