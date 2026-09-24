const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = require("../services/subscriptionPeriod");
const { format } = require("../services/invoiceNumber");
const { PlatformInvoice } = require("../models/platformSubscriptionModel");
const money = require("../services/money");

/**
 * Subscription periods, add-on proration, and invoices that never change.
 *
 * The period arithmetic is where a spec sentence turns into money: "Do not use
 * the exact payment time to extend the subscription" and "the restaurant
 * should not receive the missed days for free" are both testable, and both
 * fail silently if got wrong -- a subscription that drifts a few minutes
 * earlier each month, or one that quietly gifts nine days.
 */

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const ist = (s) => new Date(`${s}+05:30`);

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

test("REGRESSION: the time of day a restaurant pays cannot move the boundary", () => {
  // Otherwise a period bought at 23:58 ends at 23:58 and every renewal drifts
  // earlier, and someone paying at 09:00 gets a shorter month than someone
  // paying at midnight.
  const ends = ["00:02", "09:00", "14:30", "23:58"].map(
    (t) => P.nextPeriod({ subscription: null, days: 30, on: ist(`2026-09-10T${t}:00`) }).end.getTime(),
  );
  assert.equal(new Set(ends).size, 1, "all four must buy the identical period");
});

test("every boundary is IST midnight, not UTC midnight", () => {
  // UTC midnight would expire subscriptions at 05:30 in the morning, and cut
  // an evening renewal a day short.
  const start = P.startOfIstDay(ist("2026-09-10T23:58:00"));
  assert.equal(start.toISOString(), "2026-09-09T18:30:00.000Z", "= 10 Sept 00:00 IST");
});

test("REGRESSION: paying late buys no free days", () => {
  // The spec's own example: expires 1 September, pays on the 10th.
  const subscription = { currentPeriodEnd: P.startOfIstDay(ist("2026-09-01T00:00:00")) };
  const on = ist("2026-09-10T14:30:00");

  const fromPayment = P.nextPeriod({ subscription, days: 30, policy: "FROM_PAYMENT", on });
  assert.equal(fromPayment.lapsedDays, 9);
  assert.equal(
    fromPayment.start.getTime(),
    P.startOfIstDay(on).getTime(),
    "the new period starts today; 1-10 September is simply not covered",
  );

  const fromExpiry = P.nextPeriod({ subscription, days: 30, policy: "FROM_EXPIRY", on });
  assert.equal(
    fromExpiry.start.getTime(),
    subscription.currentPeriodEnd.getTime(),
    "or it starts at the old expiry, so the nine days come out of the new month",
  );
  assert.ok(fromExpiry.end < fromPayment.end, "either way, the gap is never a gift");
});

test("renewing early never throws away days already paid for", () => {
  const subscription = { currentPeriodEnd: P.startOfIstDay(ist("2026-10-01T00:00:00")) };
  for (const policy of ["FROM_PAYMENT", "FROM_EXPIRY"]) {
    const r = P.nextPeriod({
      subscription,
      days: 30,
      policy,
      on: ist("2026-09-20T10:00:00"),
    });
    assert.equal(
      r.start.getTime(),
      subscription.currentPeriodEnd.getTime(),
      `${policy}: charging someone and shortening their subscription is indefensible`,
    );
    assert.equal(r.lapsedDays, 0);
  }
});

test("a first-ever subscription starts today", () => {
  const on = ist("2026-09-10T14:00:00");
  const r = P.nextPeriod({ subscription: null, days: 30, on });
  assert.equal(r.start.getTime(), P.startOfIstDay(on).getTime());
  assert.equal(P.daysBetween(r.start, r.end), 30);
});

// ---------------------------------------------------------------------------
// Proration (an add-on or tablet bought mid-period)
// ---------------------------------------------------------------------------

test("an add-on bought mid-period pays for the time left, rounded up to the paise", () => {
  const periodEnd = P.startOfIstDay(ist("2026-10-01T00:00:00"));
  // 15 of 30 days left: half of 200.
  assert.equal(P.prorate({ pricePaise: money.toPaise(200), periodEnd, days: 30, on: P.addDays(periodEnd, -15) }), money.toPaise(100));
  // A third of a paise still owed is a whole paise, never a free fraction.
  assert.equal(P.prorate({ pricePaise: 100, periodEnd, days: 30, on: P.addDays(periodEnd, -10) }), 34);
  // To the millisecond, not whole days: one hour left is not a free day.
  assert.equal(P.prorate({ pricePaise: 72000, periodEnd, days: 30, on: new Date(periodEnd.getTime() - 3600 * 1000) }), 100);
});

test("REGRESSION: proration never exceeds a full period or goes below zero", () => {
  const periodEnd = P.startOfIstDay(ist("2026-10-01T00:00:00"));
  assert.equal(P.prorate({ pricePaise: 30000, periodEnd, days: 30, on: P.addDays(periodEnd, -45) }), 30000);
  assert.equal(P.prorate({ pricePaise: 30000, periodEnd, days: 30, on: P.addDays(periodEnd, 1) }), 0, "a refund nobody authorised");
});

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

test("invoice numbers follow KK-<storeId>-0001", () => {
  assert.equal(format("148379", 1), "KK-148379-0001");
  assert.equal(format("148379", 42), "KK-148379-0042");
  assert.equal(format("148379", 12345), "KK-148379-12345", "past 9999 it grows rather than wraps");
});

test("REGRESSION: an issued invoice cannot be edited", () => {
  // "if a restaurant purchased Growth for 1299 and Admin later changes Growth
  // to 999, the old invoice must still show 1299."
  const { rejectedEdits } = require("../models/platformSubscriptionModel");

  for (const field of ["totalPaise", "lines", "buyer.gstin", "invoiceNumber", "cgstPaise", "invoiceDate"]) {
    assert.deepEqual(rejectedEdits([field]), [field], `${field} must not be editable after issue`);
  }

  // And the hook that uses it actually refuses the save.
  const src = SRC("models/platformSubscriptionModel.js");
  assert.match(src, /invoiceSchema\.pre\("save", function guardImmutability/);
  assert.match(src, /return next\(\s*new Error\(/);
});

test("voiding and annotating remain possible", () => {
  // A mistake is cancelled by a void plus a fresh invoice, never by rewriting
  // the original -- which may already be in a filed return.
  const src = SRC("models/platformSubscriptionModel.js");
  assert.match(src, /\["status", "notes", "updatedAt"\]/);
  assert.match(src, /Void it and issue a new one/);
});

test("an invoice snapshots both parties and every rate", () => {
  // A restaurant that renames itself must not rewrite the name on last year's
  // bills, and a GST change must not restate old tax.
  const schema = PlatformInvoice.schema;
  for (const field of [
    "seller.name", "seller.gstin", "buyer.name", "buyer.gstin", "buyer.state",
    "lines", "cgstPaise", "sgstPaise", "igstPaise", "totalInWords", "placeOfSupply",
  ]) {
    assert.ok(schema.path(field), `${field} must be stored on the invoice, not derived later`);
  }
});

test("SOURCE: the balance is debited before the invoice is issued", () => {
  // The other order would produce an invoice marked PAID for a payment that
  // failed for want of funds. Every charge goes through charge().
  const src = SRC("services/subscription.js");
  const charge = src.slice(src.indexOf("const charge = async"), src.indexOf("const canonical"));
  const debitAt = charge.indexOf("await debit({");
  const dupAt = charge.indexOf("if (duplicate) return");
  const invoiceAt = charge.indexOf("await issueInvoice({");
  assert.ok(debitAt !== -1 && invoiceAt !== -1, "anchors moved; retarget this guard");
  assert.ok(debitAt < dupAt && dupAt < invoiceAt, "money first, document second, and a repeat issues nothing");
  assert.equal((src.match(/await debit\(/g) || []).length, 1, "no charge bypasses charge()");
  assert.equal((src.match(/issueInvoice\(\{/g) || []).length, 1);
});

test("SOURCE: an unaffordable subscription is refused, not part-applied", () => {
  const src = SRC("services/subscription.js");
  assert.match(src, /InsufficientBalanceError/);
  assert.match(src, /402/, "payment required, with the shortfall named");
});

// ---------------------------------------------------------------------------
// The invoice document
// ---------------------------------------------------------------------------

test("the invoice carries every field the spec lists", () => {
  const { renderInvoice } = require("../services/invoiceDocument");
  const html = renderInvoice({
    invoiceNumber: "KK-148379-0001",
    invoiceDate: new Date("2026-09-07"),
    seller: { name: "KnotKitchen", gstin: "19AAAAA0000A1Z5", addressLines: ["Kolkata"], state: "West Bengal" },
    buyer: { name: "Spice Garden", gstin: "19BBBBB1111B1Z5", addressLines: ["MG Road"], state: "West Bengal" },
    lines: [{
      serial: 1, description: "Growth plan — 30 days",
      amountPaise: money.toPaise(1299), taxableValuePaise: money.toPaise(1299),
      cgstRate: 9, cgstPaise: money.toPaise(116.91),
      sgstRate: 9, sgstPaise: money.toPaise(116.91),
      igstRate: 0, igstPaise: 0, totalPaise: money.toPaise(1532.82),
    }],
    subtotalPaise: money.toPaise(1299),
    cgstPaise: money.toPaise(116.91),
    sgstPaise: money.toPaise(116.91),
    igstPaise: 0,
    totalTaxPaise: money.toPaise(233.82),
    totalPaise: money.toPaise(1532.82),
    totalInWords: money.amountInWords(money.toPaise(1532.82)),
    placeOfSupply: "West Bengal",
    interState: false,
    status: "PAID",
  });

  for (const [label, needle] of [
    ["TAX INVOICE heading", "TAX INVOICE"],
    ["invoice number", "KK-148379-0001"],
    ["seller GSTIN", "19AAAAA0000A1Z5"],
    ["bill to", "Spice Garden"],
    ["buyer GSTIN", "19BBBBB1111B1Z5"],
    ["plan name", "Growth plan"],
    ["plan value", "1,299.00"],
    ["cgst amount", "116.91"],
    ["total in figures", "1,532.82"],
    ["total in words", "Thirty Two and Eighty Two Paise Only"],
    ["footer", "computer generated digital invoice, no signature required"],
  ]) {
    assert.ok(html.includes(needle), `missing ${label}`);
  }
});

test("REGRESSION: tax columns follow the supply", () => {
  // A nil IGST column on an intra-state invoice reads as a claim that IGST
  // was charged at zero, which is not the same as it not applying.
  const { taxColumns } = require("../services/invoiceDocument");
  assert.deepEqual(taxColumns({ interState: false }).map((c) => c[0]), ["CGST", "SGST"]);
  assert.deepEqual(taxColumns({ interState: true }).map((c) => c[0]), ["IGST"]);
});

test("the invoice escapes both parties' names", () => {
  const { renderInvoice } = require("../services/invoiceDocument");
  const html = renderInvoice({
    invoiceNumber: "KK-1-0001", invoiceDate: new Date(),
    seller: {}, buyer: { name: "<script>alert(1)</script>" },
    lines: [], subtotalPaise: 0, totalPaise: 0, totalInWords: "", status: "PAID",
  });
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /&lt;script&gt;/);
});

test("an invoice link is signed, and a session is never required to read it", () => {
  const link = require("../services/receiptLink");
  assert.equal(link.KIND_INVOICE, "i");

  const saved = process.env.RECEIPT_LINK_SECRET;
  process.env.RECEIPT_LINK_SECRET = "s3cr3t";
  try {
    const token = link.tokenForInvoice("65f1a2b3c4d5e6f708192a3b");
    assert.equal(link.readToken(token).isInvoice, true);
    // An invoice token must not open an order, or the reverse.
    assert.equal(link.readToken(token.replace(/^i_/, "o_")), null);
  } finally {
    if (saved === undefined) delete process.env.RECEIPT_LINK_SECRET;
    else process.env.RECEIPT_LINK_SECRET = saved;
  }
});

test("SOURCE: no subscription route accepts a restaurantId or a price", () => {
  const route = SRC("routes/subscriptionRoute.js");
  assert.match(route, /const ownRestaurantId = \(req\)/);
  assert.ok(
    !/req\.body\?\.restaurantId|req\.params\.restaurantId/.test(route),
    "the restaurant always comes from the session",
  );
  assert.ok(
    !/req\.body\?\.(price|amount|pricePaise)/.test(route),
    "a restaurant must never be able to name its own price",
  );
});
