import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceTotals, expenseTax, statusOf, nextInvoiceNo, isRegistered, STOCK, FOOD } from "../src/lib/tax.js";
import { gstr1Section, setOff, quarterSummary, deadlines } from "../src/lib/gst.js";
import { fyOf, fyRange, quarterOf, quarterMonths } from "../src/lib/fy.js";
import { inr, amountInWords } from "../src/lib/money.js";

const firm = { state: "West Bengal", gstin: "19ABCDE1234F1Z5", gstFrom: "2026-07-01", qrmp: true };
const items = [{ desc: "POS plan", qty: 12, rate: 599, gst: 18 }, { desc: "Setup", qty: 1, rate: 1000, gst: 18 }];
const inv = (o) => ({ date: "2026-08-10", pos: "West Bengal", items, ...o });

test("intra-state after registration: CGST + SGST, half the rate each", () => {
  const t = invoiceTotals(inv({}), firm);
  assert.equal(t.type, "intra");
  assert.equal(t.taxable, 8188);
  assert.equal(t.cgst, 736.92);
  assert.equal(t.sgst, 736.92);
  assert.equal(t.igst, 0);
  assert.equal(t.total, 9661.84);
});

test("inter-state after registration: IGST at the full rate", () => {
  const t = invoiceTotals(inv({ pos: "Maharashtra" }), firm);
  assert.equal(t.type, "inter");
  assert.equal(t.igst, 1473.84);
  assert.equal(t.cgst + t.sgst, 0);
  assert.equal(t.total, 9661.84);
});

test("before the registration date, or with no GSTIN: no GST at all", () => {
  const before = invoiceTotals(inv({ date: "2026-06-30", pos: "Maharashtra" }), firm);
  assert.equal(before.type, "unregistered");
  assert.equal(before.total, 8188);
  assert.equal(invoiceTotals(inv({ date: "2026-07-01" }), firm).type, "intra", "registered from gstFrom itself");
  assert.equal(invoiceTotals(inv({}), { ...firm, gstin: "" }).type, "unregistered");
  assert.equal(isRegistered({ ...firm, gstFrom: "" }, "2026-08-10"), false);
});

test("status from payments", () => {
  const base = { totals: { total: 1180 } };
  assert.equal(statusOf({ ...base, payments: [] }), "Unpaid");
  assert.equal(statusOf({ ...base, payments: [{ amount: 500 }] }), "Part paid");
  assert.equal(statusOf({ ...base, payments: [{ amount: 500 }, { amount: 680 }] }), "Paid");
});

test("invoice numbers: PREFIX/FY/### after the highest in that year", () => {
  const list = [{ no: "KK/2026-27/001" }, { no: "KK/2026-27/007" }, { no: "KK/2025-26/045" }];
  assert.equal(nextInvoiceNo("KK", "2026-27", list), "KK/2026-27/008");
  assert.equal(nextInvoiceNo("KK", "2027-28", list), "KK/2027-28/001");
  assert.ok("KK/2026-27/008".length <= 16, "GST invoice numbers are at most 16 characters");
});

test("expense ITC: all five conditions, else GST becomes cost", () => {
  const e = { date: "2026-08-01", amount: 1000, gstRate: 18, taxType: "cgst_sgst", vendorGstin: "19AAAAA0000A1Z5", inFirmName: true, businessUse: true, category: "Hosting & domain" };
  const ok = expenseTax(e, firm);
  assert.equal(ok.claimable, true);
  assert.deepEqual(ok.itc, { cgst: 90, sgst: 90, igst: 0 });
  assert.equal(ok.cost, 1000);
  for (const bad of [{ date: "2026-06-01" }, { vendorGstin: "" }, { inFirmName: false }, { businessUse: false }, { category: FOOD }]) {
    const x = expenseTax({ ...e, ...bad }, firm);
    assert.equal(x.claimable, false, JSON.stringify(bad));
    assert.equal(x.cost, 1180);
  }
  assert.equal(expenseTax({ ...e, inFirmName: false }, firm).notInFirmName, true);
});

test("stock bought before registration with a GSTIN bill is flagged", () => {
  const e = { date: "2026-05-01", amount: 9999, gstRate: 18, taxType: "igst", vendorGstin: "07AAAAA0000A1Z5", category: STOCK };
  assert.equal(expenseTax(e, firm).maybeAtRegistration, true);
  assert.equal(expenseTax({ ...e, date: "2026-08-01" }, firm).maybeAtRegistration, false);
  assert.equal(expenseTax({ ...e, vendorGstin: "" }, firm).maybeAtRegistration, false);
});

test("GSTR-1 sections", () => {
  const t = (o) => ({ totals: { type: "inter", total: 50000 }, ...o });
  assert.equal(gstr1Section(t({ clientGstin: "27ABCDE1234F1Z5" }), firm), "4A B2B");
  assert.equal(gstr1Section(t({ totals: { type: "inter", total: 150000 } }), firm), "5 B2CL");
  assert.equal(gstr1Section(t({ totals: { type: "intra", total: 150000 } }), firm), "7 B2CS");
  assert.equal(gstr1Section(t({}), firm), "7 B2CS");
});

test("credit set-off order and carry forward", () => {
  // IGST credit pays IGST then CGST then SGST; CGST/SGST credit never cross.
  const s = setOff({ cgst: 100, sgst: 100, igst: 50 }, { cgst: 0, sgst: 300, igst: 120 });
  assert.deepEqual(s.cash, { cgst: 30, sgst: 0, igst: 0 });
  assert.deepEqual(s.carry, { cgst: 0, sgst: 200, igst: 0 });
});

test("quarter summary carries unused credit into the next month", () => {
  const exp = [{ date: "2026-07-05", amount: 10000, gstRate: 18, taxType: "igst", vendorGstin: "29AAAAA0000A1Z5", category: "Hardware & equipment" }];
  const invs = [{ date: "2026-08-10", pos: "West Bengal", items: [{ qty: 1, rate: 5000, gst: 18 }] }];
  invs[0].totals = invoiceTotals(invs[0], firm);
  const q = quarterSummary("2026-27", 2, invs, exp, firm);
  const [jul, aug] = q.months;
  assert.deepEqual(jul.carry, { cgst: 0, sgst: 0, igst: 1800 });
  assert.deepEqual(aug.cash, { cgst: 0, sgst: 0, igst: 0 }, "July's IGST credit pays August's CGST and SGST");
  assert.deepEqual(aug.carry, { cgst: 0, sgst: 0, igst: 900 });
  assert.equal(q.gstr3b["3.1(a)"].taxable, 5000);
  assert.equal(q.gstr3b["4(A)(5)"].igst, 1800);
  assert.equal(q.invoices[0].section, "7 B2CS");
});

test("due dates under QRMP (West Bengal) and monthly", () => {
  const d = deadlines(firm, "2026-10-01", 6).map((x) => `${x.date} ${x.what}`);
  assert.deepEqual(d.slice(0, 4), [
    "2026-10-13 GSTR-1 for Q2 2026-27",
    "2026-10-24 GSTR-3B for Q2 2026-27",
    "2026-11-25 PMT-06 GST payment for Oct 2026",
    "2026-12-15 Advance tax: 75% of the year's tax",
  ]);
  const monthly = deadlines({ ...firm, qrmp: false }, "2026-10-01", 2).map((x) => x.date);
  assert.deepEqual(monthly, ["2026-10-11", "2026-10-20"]);
  assert.ok(deadlines({ ...firm, gstin: "" }, "2026-10-01", 6).every((x) => !/GST/.test(x.what)));
});

test("financial year helpers", () => {
  assert.equal(fyOf("2026-03-31"), "2025-26");
  assert.equal(fyOf("2026-04-01"), "2026-27");
  assert.deepEqual(fyRange("2026-27"), { from: "2026-04-01", to: "2027-03-31" });
  assert.equal(quarterOf("2026-04-15"), 1);
  assert.equal(quarterOf("2027-02-15"), 4);
  assert.deepEqual(quarterMonths("2026-27", 4), ["2027-01", "2027-02", "2027-03"]);
});

test("Indian money format and words", () => {
  assert.equal(inr(123456), "₹1,23,456.00");
  assert.equal(amountInWords(9661.84), "Rupees Nine Thousand Six Hundred Sixty One and Eighty Four Paise Only");
  assert.equal(amountInWords(12345678), "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only");
});

test("CSV export never hands Excel a formula", async () => {
  const { toCsv } = await import("../src/lib/gst.js");
  assert.equal(toCsv([["=SUM(A1)", "+91 98", "@x", -5, "Kolkata, WB"]]), "'=SUM(A1),'+91 98,'@x,-5,\"Kolkata, WB\"\n");
});

test("invoice PDF prints rupee signs and other symbols safely", async () => {
  const { invoicePdf } = await import("../src/lib/pdf.js");
  const f = { name: "KNOTKITCHEN", address: "Kolkata", state: "West Bengal" };
  const inv = { no: "KK/2026-27/001", date: "2026-08-10", client: "Café “Spice” — ₹ test", pos: "West Bengal", items: [{ desc: "Plan…", qty: 1, rate: 100, gst: 18 }] };
  inv.totals = invoiceTotals(inv, f);
  const text = Buffer.from(await invoicePdf(inv, f).arrayBuffer()).toString("latin1");
  assert.match(text, /Supplier not registered under GST/);
  assert.match(text, /Caf. "Spice" - Rs\. test/);
  assert.match(text, /Plan\.\.\./);
});
