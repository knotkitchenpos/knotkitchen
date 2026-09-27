import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, "..", "public", "js", "pdf.js"), "utf8");

// Just enough of jsPDF to see what lands on which page.
class FakeDoc {
  constructor() { this.pages = [[]]; this.cur = 0; this.size = 10; }
  addFileToVFS() {} addFont() {} addImage() {} setDrawColor() {} line() {} setTextColor() {} setFont() {}
  setFontSize(s) { this.size = s; }
  getTextWidth(t) { return t.length * this.size * 0.5; }
  addPage() { this.pages.push([]); this.cur = this.pages.length - 1; }
  getNumberOfPages() { return this.pages.length; }
  setPage(i) { this.cur = i - 1; }
  text(t, x, y) { this.pages[this.cur].push({ t, x, y }); }
}

function load() {
  const ctx = { window: { jspdf: { jsPDF: FakeDoc }, AGREEMENT_VERSION: "v3.0" }, FONT_ROBOTO_REGULAR: "", FONT_ROBOTO_BOLD: "", LOGO_FULL: "" };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx;
}

test("every page carries the footer with the agreement id, version and page X of Y", () => {
  const { buildAgreementPdf } = load();
  const text = "**Agreement Version:** v3.0\\\n" + Array.from({ length: 150 }, (_, i) => `Line ${i}`).join("\n");
  const doc = buildAgreementPdf(text, "KK-AGR-20260927-1001");
  const n = doc.getNumberOfPages();
  assert.ok(n >= 2, "long enough to need several pages");
  doc.pages.forEach((items, i) => {
    const footer = items.filter(x => x.t.startsWith("KnotKitchen Restaurant Service Agreement"));
    assert.equal(footer.length, 1, `page ${i + 1}`);
    assert.equal(footer[0].t, `KnotKitchen Restaurant Service Agreement · KK-AGR-20260927-1001 · v3.0 · Page ${i + 1} of ${n}`);
    // Below the body text on that page.
    assert.ok(items.every(x => x === footer[0] || x.y < footer[0].y));
  });
});

test("backslash line breaks, signature lines and table rows render as text", () => {
  const { buildAgreementPdf } = load();
  const text = [
    "**Name:** Asha\\",
    "**Date:** 27 September 2026\\   ",
    "Signature: " + "_".repeat(200),
    "| Item | Price |",
    "|---|---|",
    "| POS Plan | ₹399 |",
  ].join("\n");
  const doc = buildAgreementPdf(text, "X");
  const all = doc.pages.flat().map(x => x.t);
  assert.ok(!all.some(t => t.includes("\\")), "no stray backslash");
  assert.ok(all.includes("Signature:"));
  const underscores = all.filter(t => /^_+$/.test(t));
  assert.equal(underscores.join("").length, 200, "the whole signature line is drawn");
  assert.ok(doc.pages.flat().every(x => x.x + x.t.length * 5 <= 595 - 50 + 0.001 || x.t.startsWith("KnotKitchen")), "nothing runs off the right edge");
  assert.ok(all.includes("POS") && all.includes("₹399"));
  assert.ok(!all.some(t => t.includes("|") || t.includes("---")), "table markup is not printed");
});
