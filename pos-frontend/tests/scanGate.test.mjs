import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDigitOk, createScanGate } from "../src/utils/scanGate.js";

/** Owner, 2026-11-03: "sometimes it reads the wrong barcode and sometimes it scans too fast". */

test("a misread barcode fails its check digit and is not a scan", () => {
  assert.equal(checkDigitOk("8901262150064"), true, "Amul Taaza, EAN-13");
  assert.equal(checkDigitOk("5449000000996"), true, "Coca-Cola, EAN-13");
  assert.equal(checkDigitOk("8901262150065"), false, "one digit off");
  assert.equal(checkDigitOk("8901262150046"), false, "two digits swapped");
  assert.equal(checkDigitOk("012345678905"), true, "UPC-A");
  assert.equal(checkDigitOk("96385074"), true, "EAN-8");
  assert.equal(checkDigitOk("01234565"), true, "UPC-E");
  assert.equal(checkDigitOk("890126"), false, "part of a barcode");
  assert.equal(checkDigitOk("SHELF-A12"), true, "a store's own label: checked inside the symbol");
});

test("one stray frame is not a scan; the same code in consecutive frames is", () => {
  const g = createScanGate();
  assert.equal(g.feed("8901262150064", 0), null, "first frame: not yet");
  assert.equal(g.feed("8901262150064", 120), "8901262150064", "second frame confirms it");
  const h = createScanGate();
  assert.equal(h.feed("5449000000996", 0), null);
  assert.equal(h.feed("8901262150064", 120), null, "a different code does not confirm the first");
  assert.equal(h.feed("8901262150065", 240), null, "a misread never counts");
});

test("a packet held in front of the camera counts once, and again only after it is taken away", () => {
  const g = createScanGate();
  const A = "8901262150064";
  let counted = 0;
  // Held for 3 seconds, read every 120 ms, a few frames missed.
  for (let t = 0; t <= 3000; t += 120) if (g.feed(t % 600 === 0 ? null : A, t)) counted += 1;
  assert.equal(counted, 1, "held still: one scan");
  // Taken away for over a second, then the next packet of the same product is shown.
  for (let t = 3120; t <= 4300; t += 120) g.feed(null, t);
  assert.equal(g.feed(A, 4420), null);
  assert.equal(g.feed(A, 4540), A, "the next packet counts");
});

test("two different packets one after the other both count, not faster than the cooldown", () => {
  const g = createScanGate();
  g.feed("8901262150064", 0);
  assert.equal(g.feed("8901262150064", 120), "8901262150064");
  g.feed("5449000000996", 240);
  assert.equal(g.feed("5449000000996", 360), null, "too soon after the last scan");
  assert.equal(g.feed("5449000000996", 840), "5449000000996");
});
