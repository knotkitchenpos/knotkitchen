const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const src = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("books: mounted, every data route behind the access list, files never public", () => {
  assert.match(src("app.js"), /app\.use\("\/api\/books", require\("\.\/routes\/booksRoute"\)\);/);
  const r = src("routes/booksRoute.js");
  for (const route of ['"/sync", requireUser', '"/access", requireUser', '"/files", requireUser', '"/files/:id", requireUser']) {
    assert.ok(r.includes(route), route);
  }
  // Removing someone from the list locks them out even with a token.
  assert.match(r, /!\(await allowedUsers\(\)\)\.includes\(claims\.sub\)/);
  // Test sign-in is off in production whatever the env says.
  assert.match(r, /if \(config\.isProduction \|\| process\.env\.BOOKS_DEV_LOGIN !== "1"\)/);
  // Bills sit with the private documents, not in the public /uploads.
  assert.match(r, /path\.join\(DOCUMENTS_DIR, "books"\)/);
  assert.doesNotMatch(r, /uploadsDir/);
});

test("books: invoice numbers are unique among live invoices", () => {
  const { BooksRecord } = require("../models/booksModel");
  const idx = BooksRecord.schema.indexes().find(([keys]) => keys["data.no"]);
  assert.ok(idx, "an index on data.no");
  assert.equal(idx[1].unique, true);
  assert.deepEqual(idx[1].partialFilterExpression, { kind: "invoice", deleted: false });
});

test("scan bill: AI output is cleaned before it reaches the form", () => {
  const { clean } = require("../services/billScan");
  const c = clean({
    isBill: true, vendor: " Hostinger ", vendorGstin: "27aaacx1234a1z5", billedTo: "KNOTKITCHEN", invoiceNo: "H-1",
    date: "26/11/2026", description: "VPS", amountBeforeGst: "1000.456", gstRate: 17, taxType: "vat",
    totalAmount: -5, category: "Servers", note: "",
  });
  assert.equal(c.vendor, "Hostinger");
  assert.equal(c.vendorGstin, "27AAACX1234A1Z5");
  assert.equal(c.date, "", "only YYYY-MM-DD dates");
  assert.equal(c.amountBeforeGst, 1000.46);
  assert.equal(c.gstRate, 0, "only real GST rates");
  assert.equal(c.taxType, "none");
  assert.equal(c.totalAmount, 0, "no negative amounts");
  assert.equal(c.category, "Other", "only the app's categories");
  assert.equal(clean({ vendorGstin: "not-a-gstin" }).vendorGstin, "");
});

test("scan bill: behind sign-in and a per-user hourly limit", () => {
  const r = src("routes/booksRoute.js");
  assert.match(r, /router\.post\("\/scan", requireUser, scanLimit,/);
  assert.match(r, /keyGenerator: \(req\) => `books-scan:\$\{req\.booksUser\}`/);
});
