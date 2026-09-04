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
const fs = require("fs");
const path = require("path");

const Order = require("../models/orderModel");

/** The classification, mirrored from orderController's report summary. */
const bucketFor = (source) => {
  const s = String(source || "").toUpperCase();
  if (s === "MARKETPLACE") return "outside";
  if (s === "WEBSITE") return "website";
  return "system";
};

test("REGRESSION: a table QR order is ours, not an outside order", () => {
  assert.equal(bucketFor("QR"), "system");
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

  const counts = { system: 0, website: 0, outside: 0 };
  sources.forEach((s) => {
    counts[bucketFor(s)] += 1;
  });

  assert.equal(counts.outside, 1, "exactly one source is external");
  assert.equal(counts.website, 1);
  assert.equal(counts.system, sources.length - 2);
});

test("REGRESSION: the controller no longer uses a catch-all else for outside", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "controllers", "orderController.js"), "utf8");
  const block = src.slice(src.indexOf("---- Source (mutually exclusive)"));
  const decision = block.slice(0, block.indexOf("---- Type"));

  assert.match(decision, /MARKETPLACE/, "outside must be selected by name");
  assert.ok(
    !/else\s+inc\(summary\.outside/.test(decision),
    "outside must never be the fallback bucket again",
  );
  assert.match(decision, /else inc\(summary\.system/, "unknown sources fall to system");
});
