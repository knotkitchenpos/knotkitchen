const { test } = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const { billRows, gstr1, gstr1Sheets, gstr1Json, tallyXml, stateCodeOf } = require("../services/accountantExports");
const { buildXlsx, crc32 } = require("../services/xlsx");

const store = { storeId: "893146", name: "Spice Route Kitchen", gstin: "19ABCDE1234F1Z5", state: "West Bengal" };
const at = (d, h = 13) => new Date(`${d}T${String(h).padStart(2, "0")}:00:00+05:30`);
const order = (o) => ({
  _id: o.id,
  orderNumber: o.id,
  orderStatus: "Completed",
  source: "POS",
  createdAt: at(o.day || "2026-11-05", o.hour),
  customerDetails: {},
  payments: [{ method: "cash", amount: o.bills.totalWithTax, status: "paid" }],
  ...o,
});
const methodOf = (o) => (o.isSplit ? "split" : o.payments?.[0]?.method || "cash");

// 5% exclusive: 1000 food + 50 GST.
const B2C = order({ id: "100001", bills: { subtotal: 1000, tax: 50, taxPercent: 5, totalWithTax: 1050 } });
// 5% inclusive with a discount and packaging: base 1000 - 100 + 50 = 950, tax 45.24.
const INCL = order({ id: "100002", bills: { subtotal: 1000, discount: 100, packagingFee: 50, tax: 45.24, taxPercent: 5, taxInclusive: true, totalWithTax: 950 } });
// B2B buyer with a GSTIN, paid by UPI.
const B2B = order({ id: "100003", customerDetails: { company: "Acme Pvt Ltd", gstin: "19AAACA1234A1Z5" }, bills: { subtotal: 2000, tax: 100, taxPercent: 5, totalWithTax: 2100 }, payments: [{ method: "upi", amount: 2100, status: "paid" }] });
// Service charge and delivery carry no GST.
const CHG = order({ id: "100004", bills: { subtotal: 500, tax: 25, taxPercent: 5, serviceCharge: 52.5, deliveryFee: 30, totalWithTax: 607.5 } });
// Half refunded.
const REF = order({ id: "100005", bills: { subtotal: 400, tax: 20, taxPercent: 5, totalWithTax: 420 }, refunds: [{ amount: 210, status: "SUCCESS" }] });
// Cancelled: no sale, but a document issued.
const CAN = order({ id: "100006", orderStatus: "Cancelled", bills: { subtotal: 300, tax: 15, taxPercent: 5, totalWithTax: 315 }, payments: [] });
// Swiggy: GST paid by the platform.
const ECO = order({ id: "100007", source: "MARKETPLACE", marketplace: "Swiggy", bills: { subtotal: 600, tax: 30, taxPercent: 5, totalWithTax: 630 } });
// Split payment, cash + card.
const SPLIT = order({ id: "100008", isSplit: true, bills: { subtotal: 200, tax: 10, taxPercent: 5, totalWithTax: 210 }, payments: [{ method: "cash", amount: 110, status: "paid" }, { method: "card", amount: 100, status: "paid" }] });
// A bad GSTIN is B2C.
const BAD = order({ id: "100009", customerDetails: { company: "Typo Ltd", gstin: "19XXXX" }, bills: { subtotal: 100, tax: 5, taxPercent: 5, totalWithTax: 105 } });

const ALL = [B2C, INCL, B2B, CHG, REF, CAN, ECO, SPLIT, BAD];
const rows = billRows(ALL, { methodOf });
const by = Object.fromEntries(rows.map((r) => [r.number, r]));

test("each bill's taxable value and CGST/SGST come from what the bill charged", () => {
  assert.deepEqual([by["100001"].taxable, by["100001"].cgst, by["100001"].sgst], [1000, 25, 25]);
  assert.deepEqual([by["100002"].taxable, by["100002"].tax], [904.76, 45.24], "inclusive: base 950 less its tax");
  assert.equal(by["100002"].cgst + by["100002"].sgst, 45.24, "the halves add back to the tax, paisa for paisa");
  assert.equal(by["100003"].kind, "b2b");
  assert.equal(by["100004"].untaxed, 82.5);
  assert.deepEqual([by["100005"].taxable, by["100005"].tax, by["100005"].value, by["100005"].refunded], [200, 10, 210, 210], "half refunded: half of everything");
  assert.equal(by["100006"].kind, "cancelled");
  assert.equal(by["100007"].kind, "eco");
  assert.equal(by["100009"].kind, "b2c");
  assert.equal(by["100009"].badGstin, true);
});

test("GSTR-1 sections: B2B by invoice, B2C summed by rate, platform bills apart, every bill in the documents table", () => {
  const g = gstr1({ rows, store, from: "2026-11-01", to: "2026-11-30" });
  assert.equal(g.store.pos, "19");
  assert.equal(g.period.fp, "112026");
  assert.deepEqual(g.b2b.map((r) => r.number), ["100003"]);
  assert.equal(g.b2cs.length, 1);
  const b2cs = g.b2cs[0];
  // B2C: 1000 + 904.76 + 500 + 200 (refund) + 200 (split) + 100 (bad GSTIN); never Swiggy or the cancelled bill.
  assert.equal(b2cs.taxable, 2904.76);
  assert.equal(b2cs.rate, 5);
  assert.deepEqual(g.eco.map((r) => [r.channel, r.taxable]), [["Swiggy", 600]]);
  // These bills predate the series: one line of their own, first to last by time.
  assert.deepEqual(g.docs, [{ nature: "Invoices for outward supply (earlier numbering)", from: "100001", to: "100009", total: 8, cancelled: 1 }], "the Swiggy bill is the platform's invoice, not the restaurant's");
  assert.equal(g.hsnB2b[0].hsn, "996331");
  assert.equal(g.hsnB2c[0].taxable, 2904.76);
  assert.ok(g.warnings.some((w) => /section 9\(5\)/.test(w)));
  assert.ok(g.warnings.some((w) => /not valid/.test(w)));
  assert.ok(g.warnings.some((w) => /service charge and delivery/.test(w)));
  // An unregistered store is told GSTR-1 does not apply.
  assert.ok(gstr1({ rows, store: { ...store, gstin: "" }, from: "2026-11-01", to: "2026-11-30" }).warnings[0].includes("no GST number"));
  assert.equal(stateCodeOf("", "Karnataka"), "29");
});

test("GSTR-1 JSON in the portal's shape", () => {
  const j = gstr1Json(gstr1({ rows, store, from: "2026-11-01", to: "2026-11-30" }));
  assert.equal(j.gstin, store.gstin);
  assert.equal(j.fp, "112026");
  assert.equal(j.b2b[0].ctin, "19AAACA1234A1Z5");
  assert.deepEqual(j.b2b[0].inv[0], {
    inum: "100003", idt: "05-11-2026", val: 2100, pos: "19", rchrg: "N", inv_typ: "R",
    itms: [{ num: 501, itm_det: { rt: 5, txval: 2000, camt: 50, samt: 50, csamt: 0 } }],
  });
  assert.deepEqual(Object.keys(j.b2cs[0]), ["sply_ty", "rt", "typ", "pos", "txval", "camt", "samt", "csamt"]);
  assert.equal(j.b2cs[0].sply_ty, "INTRA");
  assert.equal(j.hsn.hsn_b2c[0].hsn_sc, "996331");
  assert.equal(j.doc_issue.doc_det[0].docs[0].net_issue, 7);
  assert.equal(j.doc_issue.doc_det[0].docs[0].num, 1);
});

test("Tally: every voucher balances, ledgers are created, B2B goes to the buyer with a receipt", () => {
  for (const mode of ["bill", "day"]) {
    const xml = tallyXml({ rows, store, mode, ledgers: { cash: "Cash Counter" } });
    const vouchers = xml.match(/<VOUCHER [\s\S]*?<\/VOUCHER>/g);
    assert.ok(vouchers.length > 0);
    for (const v of vouchers) {
      const sum = [...v.matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].reduce((s, m) => s + Number(m[1]), 0);
      assert.ok(Math.abs(sum) < 0.005, `${mode}: a voucher does not balance (${sum})\n${v.slice(0, 300)}`);
    }
    assert.match(xml, /<LEDGER NAME="Cash Counter"[^>]*>.*?<PARENT>Cash-in-Hand<\/PARENT>/s, "a renamed ledger is used and created");
    assert.match(xml, /<LEDGER NAME="Output CGST @ 2.5%"[^>]*>.*?<GSTDUTYHEAD>Central Tax<\/GSTDUTYHEAD>/s);
    assert.match(xml, /<LEDGER NAME="Acme Pvt Ltd"[^>]*>.*?<PARENT>Sundry Debtors<\/PARENT><PARTYGSTIN>19AAACA1234A1Z5<\/PARTYGSTIN>/s);
    assert.match(xml, /VCHTYPE="Receipt"[\s\S]*?<VOUCHERNUMBER>R-100003<\/VOUCHERNUMBER>/);
    assert.doesNotMatch(xml, /100006/, "the cancelled bill is no voucher");
  }
  const day = tallyXml({ rows, store, mode: "day" });
  // B2C and platform bills of 5 Nov summed into one voucher at 5%.
  assert.equal((day.match(/VCHTYPE="Sales"/g) || []).length, 2, "one day voucher + the B2B bill");
  const bill = tallyXml({ rows, store, mode: "bill" });
  assert.match(bill, /<VOUCHERNUMBER>100008<\/VOUCHERNUMBER>[\s\S]*?<LEDGERNAME>Cash<\/LEDGERNAME>[\s\S]*?<AMOUNT>-110.00<\/AMOUNT>[\s\S]*?<LEDGERNAME>Card Collections<\/LEDGERNAME>[\s\S]*?<AMOUNT>-100.00<\/AMOUNT>/, "a split bill debits each method");
  // XML-unsafe names are escaped.
  const x = tallyXml({ rows: billRows([order({ id: "1", customerDetails: { company: "A & B <Foods>", gstin: "19AAACA1234A1Z5" }, bills: { subtotal: 100, tax: 5, taxPercent: 5, totalWithTax: 105 } })], { methodOf }), store });
  assert.match(x, /A &amp; B &lt;Foods&gt;/);
});

test("the workbook is a real zip of the offline tool's sheets", () => {
  const g = gstr1({ rows, store, from: "2026-11-01", to: "2026-11-30" });
  const sheets = gstr1Sheets(g, rows);
  assert.deepEqual(sheets.map((s) => s.name), ["Summary", "b2b", "b2cs", "hsn(b2b)", "hsn(b2c)", "docs", "eco (Swiggy, Zomato)", "Bills"]);
  assert.deepEqual(sheets[1].rows[0].slice(0, 5), ["GSTIN/UIN of Recipient", "Receiver Name", "Invoice Number", "Invoice date", "Invoice Value"]);
  assert.deepEqual(sheets[1].rows[1].slice(0, 6), ["19AAACA1234A1Z5", "Acme Pvt Ltd", "100003", "05-Nov-2026", 2100, "19-West Bengal"]);
  const buf = buildXlsx(sheets);
  assert.equal(buf.readUInt32LE(0), 0x04034b50, "a zip");
  // Read the first entry back: name, inflate, CRC.
  const nameLen = buf.readUInt16LE(26);
  const size = buf.readUInt32LE(18);
  const name = buf.slice(30, 30 + nameLen).toString();
  const data = zlib.inflateRawSync(buf.slice(30 + nameLen, 30 + nameLen + size));
  assert.equal(name, "[Content_Types].xml");
  assert.equal(crc32(data), buf.readUInt32LE(14));
  assert.match(data.toString(), /sheet8\.xml/);
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926, "the standard CRC-32 check value");
});

