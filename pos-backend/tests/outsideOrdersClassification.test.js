/**
 * "Outside Orders" means a third-party delivery platform, and nothing else.
 *
 * The report classified sources as:
 *
 *     if (source === "POS")          system
 *     else if (source === "WEBSITE") website
 *     else                           outside      <-- catch-all
 *
 * The source enum is POS, WEBSITE, QR, MARKETPLACE, PHONE, so every table QR
 * order and every phone order was reported as an "outside" order alongside the
 * genuine marketplace ones. In production that was 8 QR dine-in orders counted
 * as Swiggy/Zomato business, against zero real marketplace orders.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const Order = require("../models/orderModel");

const { buildReportBuckets } = require("../controllers/orderController");

/** Which source card an order with this source lands on. */
const bucketFor = (source) => {
  const summary = buildReportBuckets([{ source, bills: { totalWithTax: 1 } }]);
  return ["system", "website", "tableQr", "outside"].filter((k) => summary[k].count)[0];
};

test("REGRESSION: a table QR order is ours, not an outside order", () => {
  // Table QR now has its own card; it is still never "outside".
  assert.equal(bucketFor("QR"), "tableQr");
});

test("REGRESSION: a phone order is ours too", () => {
  assert.equal(bucketFor("PHONE"), "system");
});

test("only MARKETPLACE counts as outside", () => {
  assert.equal(bucketFor("MARKETPLACE"), "outside");
  for (const ours of ["POS", "QR", "PHONE", "WEBSITE"]) {
    assert.notEqual(bucketFor(ours), "outside", `${ours} is our own channel`);
  }
});

test("the website keeps its own bucket", () => {
  assert.equal(bucketFor("WEBSITE"), "website");
});

test("REGRESSION: an unknown source counts as ours, not as marketplace", () => {
  // A new internal source added later must not silently inflate the
  // marketplace figure the way QR did.
  assert.equal(bucketFor("SOMETHING_NEW"), "system");
  assert.equal(bucketFor(""), "system");
  assert.equal(bucketFor(undefined), "system");
});

test("every source in the schema lands in exactly one bucket", () => {
  const sources = Order.schema.path("source").enumValues;
  assert.ok(sources.includes("MARKETPLACE"), "the enum still has a marketplace source");

  const counts = { system: 0, website: 0, tableQr: 0, outside: 0 };
  sources.forEach((s) => {
    counts[bucketFor(s)] += 1;
  });

  assert.equal(counts.outside, 1, "exactly one source is external");
  assert.equal(counts.website, 1);
  assert.equal(counts.tableQr, 1);
  assert.equal(counts.system, sources.length - 3);
});
