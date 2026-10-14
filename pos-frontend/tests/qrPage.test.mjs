// The diner's table QR page (QA batch 8: A1, A4, A5, PF2, D5).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = (rel) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", rel), "utf8");
const page = SRC("src/pages/OrderOnline.jsx");
const sheet = SRC("src/components/qr/ProductOptionsSheet.jsx");

test("A1/D11: diners can zoom the QR page, and the till's no-zoom comes back on leaving it", () => {
  const set = page.match(/meta\.setAttribute\("content", "([^"]+)"\)/);
  assert.ok(set, "the page sets its own viewport");
  assert.doesNotMatch(set[1], /user-scalable=no|maximum-scale/);
  assert.match(page, /return \(\) => meta\.setAttribute\("content", before\)/, "restored on unmount");
});

test("PF2: a background tab does not poll; it refetches when shown again", () => {
  const start = page.indexOf("const poll = () => {");
  assert.ok(start > 0, "poll helper missing");
  const poll = page.slice(start, page.indexOf("};", start));
  assert.match(poll, /if \(document\.hidden\) return;/);
  assert.match(page, /setInterval\(poll, 12000\)/);
  assert.match(page, /document\.addEventListener\("visibilitychange", poll\)/);
  assert.match(page, /document\.removeEventListener\("visibilitychange", poll\)/);
});

test("A5/D12: no 2.56:1 slate-400 text left on the QR page or its options sheet", () => {
  assert.doesNotMatch(page, /text-slate-400/);
  assert.doesNotMatch(sheet, /text-slate-400/);
});

test("A4: QR steppers are at least 40 px and + Add is not a 24 px sliver", () => {
  const isStepper = /aria-label=(?:\{`(?:Remove one|Add one more)|"(?:Reduce|Increase) quantity")/;
  for (const [name, src, count] of [["page", page, 4], ["sheet", sheet, 2]]) {
    const buttons = src.split("<button").slice(1).map((b) => b.slice(0, b.indexOf("</button>")));
    const classes = buttons.filter((b) => isStepper.test(b)).map((b) => b.match(/className="([^"]*)"/)?.[1] || "");
    assert.equal(classes.length, count, `${name}: steppers found`);
    for (const c of classes) assert.match(c, /\bw-10 h-10\b/, `${name}: ${c}`);
  }
  assert.match(page, /rounded-full px-3 py-2"[^]{0,200}?\{itemHasOptions \?/, "+ Add / Choose button");
});

test("D5: the QR lists a Display OFF dish kept on sale by POS Visibility, as the table bill accepts it", () => {
  assert.match(page, /i\.isAvailable !== false \|\| i\.visibleOnPosWhenOff === true/);
});

test("REGRESSION D4: the cart does not promise the kitchen gets an order before staff accept it", () => {
  assert.doesNotMatch(page, /goes to the kitchen instantly/);
  assert.match(page, /The staff confirm your order and send it to the kitchen\./);
});
