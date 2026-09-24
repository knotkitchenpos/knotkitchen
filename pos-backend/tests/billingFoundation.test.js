const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const money = require("../services/money");
const { computeTax, gstApplicableAt } = require("../services/tax");
const { catalogPricePaise, priceFor } = require("../services/pricing");

/**
 * The billing foundation: money arithmetic, GST, and price resolution.
 *
 * Everything here is checked against the worked examples in the specification
 * rather than against my own arithmetic, so a disagreement with the business
 * shows up as a failing test and not as a wrong invoice.
 */

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const GST_18 = {
  registered: true,
  percent: 18,
  mode: "exclusive",
  effectiveFrom: new Date("2026-01-01"),
  placeOfSupplyState: "West Bengal",
};

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

test("the spec's own worked examples come out exactly", () => {
  // "1299 + 18% GST = 1532.82"
  const plan = money.toPaise(1299);
  const planTax = money.percentOf(plan, 18);
  assert.equal(money.formatAmount(plan + planTax), "1,532.82");

  // "150 paid website orders x 9 = 1350 ... + 243 GST = 1593"
  const usage = money.toPaise(9) * 150;
  assert.equal(money.formatAmount(usage), "1,350.00");
  const usageTax = money.percentOf(usage, 18);
  assert.equal(money.formatAmount(usageTax), "243.00");
  assert.equal(money.formatAmount(usage + usageTax), "1,593.00");
});

test("REGRESSION: money is integer paise, because floats do not survive accumulation", () => {
  // This is the monthly usage invoice: a hundred small charges added up. In
  // floats the tax on 100 orders of 9 rupees comes to 162.00000000000023, so
  // the invoice total stops matching the sum of its own lines.
  let floatTax = 0;
  for (let i = 0; i < 100; i += 1) floatTax += 9 * 0.18;
  assert.notEqual(floatTax, 162, "floats really do drift here");

  let paiseTax = 0;
  for (let i = 0; i < 100; i += 1) paiseTax += money.percentOf(money.toPaise(9), 18);
  assert.equal(paiseTax, money.toPaise(162), "paise do not");
  assert.ok(Number.isInteger(paiseTax));

  // And a rate that does not divide cleanly still lands on a whole paise.
  assert.equal(money.percentOf(money.toPaise(7), 2.5), 18); // 0.175 -> 0.18
  assert.ok(Number.isInteger(money.percentOf(money.toPaise(1299), 2.5)));
});

test("a split always sums back to what was split", () => {
  // CGST and SGST are each half the GST, and half an odd paise is not a paise.
  for (const rupees of [1299, 9, 1350, 0.05, 7, 1699, 599]) {
    const tax = money.percentOf(money.toPaise(rupees), 18);
    const parts = money.splitEvenly(tax, 2);
    assert.equal(parts[0] + parts[1], tax, `${rupees} split drifted`);
    assert.ok(Math.abs(parts[0] - parts[1]) <= 1, `${rupees} split lopsided`);
  }
});

test("amounts in words read as an invoice needs them", () => {
  assert.equal(
    money.amountInWords(money.toPaise(1532.82)),
    "Rupees One Thousand Five Hundred Thirty Two and Eighty Two Paise Only",
  );
  assert.equal(money.amountInWords(money.toPaise(1593)), "Rupees One Thousand Five Hundred Ninety Three Only");
  assert.equal(money.amountInWords(0), "Rupees Zero Only");
  assert.match(money.amountInWords(money.toPaise(10000000)), /One Crore/);
  assert.match(money.amountInWords(money.toPaise(150000)), /One Lakh Fifty Thousand/);
});

// ---------------------------------------------------------------------------
// GST
// ---------------------------------------------------------------------------

test("REGRESSION: nothing is taxed before the effective date", () => {
  // The spec is explicit: "Before GST becomes applicable, the restaurant
  // should only pay the base price. 1299 + 0 GST = 1299."
  const before = computeTax({
    amountPaise: money.toPaise(1299),
    gst: GST_18,
    on: new Date("2025-12-31"),
  });
  assert.equal(before.applicable, false);
  assert.equal(before.totalTaxPaise, 0);
  assert.equal(money.formatAmount(before.totalPaise), "1,299.00");

  const after = computeTax({
    amountPaise: money.toPaise(1299),
    gst: GST_18,
    on: new Date("2026-01-01"),
  });
  assert.equal(after.applicable, true);
  assert.equal(money.formatAmount(after.totalPaise), "1,532.82");
});

test("not registered, no date, or a zero rate all mean no tax", () => {
  const base = money.toPaise(1299);
  const cases = {
    "not registered": { ...GST_18, registered: false },
    "no effective date": { ...GST_18, effectiveFrom: null },
    "zero percent": { ...GST_18, percent: 0 },
    "no config at all": null,
  };
  for (const [label, gst] of Object.entries(cases)) {
    const r = computeTax({ amountPaise: base, gst, on: new Date("2026-06-01") });
    assert.equal(r.applicable, false, label);
    assert.equal(r.totalPaise, base, `${label}: must charge the base price`);
  }
});

test("a ticked Registered box with no date does not retroactively tax anything", () => {
  // An admin half-way through filling the form must not start taxing invoices.
  assert.equal(gstApplicableAt({ registered: true, percent: 18, effectiveFrom: null }), false);
});

test("intra-state splits CGST/SGST; inter-state is IGST", () => {
  const base = money.toPaise(1299);

  const intra = computeTax({ amountPaise: base, gst: GST_18, restaurantState: "West Bengal", on: new Date("2026-06-01") });
  assert.equal(intra.igstPaise, 0);
  assert.equal(intra.cgstPaise + intra.sgstPaise, intra.totalTaxPaise);
  assert.equal(money.formatAmount(intra.cgstPaise), "116.91");

  const inter = computeTax({ amountPaise: base, gst: GST_18, restaurantState: "Karnataka", on: new Date("2026-06-01") });
  assert.equal(inter.cgstPaise, 0);
  assert.equal(inter.sgstPaise, 0);
  assert.equal(inter.igstPaise, inter.totalTaxPaise);

  // Same state written differently is still the same state.
  const messy = computeTax({ amountPaise: base, gst: GST_18, restaurantState: "  west bengal ", on: new Date("2026-06-01") });
  assert.equal(messy.interState, false);
});

test("an unknown restaurant state falls back to CGST/SGST, not IGST", () => {
  // Reporting a domestic supply as inter-state is the more wrong of the two.
  const r = computeTax({ amountPaise: money.toPaise(1299), gst: GST_18, restaurantState: "", on: new Date("2026-06-01") });
  assert.equal(r.interState, false);
  assert.equal(r.igstPaise, 0);
});

test("inclusive tax mode extracts rather than adds, and still reconciles", () => {
  const gross = money.toPaise(1532.82);
  const r = computeTax({
    amountPaise: gross,
    gst: { ...GST_18, mode: "inclusive" },
    on: new Date("2026-06-01"),
  });
  assert.equal(r.totalPaise, gross, "an inclusive price is what is charged");
  assert.equal(r.taxablePaise + r.totalTaxPaise, gross, "the parts must equal the whole");
  assert.equal(money.formatAmount(r.taxablePaise), "1,299.00");
});

test("the tax total always equals the sum of its own components", () => {
  for (const rupees of [399, 599, 1299, 1699, 9, 7, 1350, 0.01]) {
    for (const percent of [5, 12, 18, 28, 2.5]) {
      for (const state of ["West Bengal", "Karnataka"]) {
        const r = computeTax({
          amountPaise: money.toPaise(rupees),
          gst: { ...GST_18, percent },
          restaurantState: state,
          on: new Date("2026-06-01"),
        });
        assert.equal(
          r.cgstPaise + r.sgstPaise + r.igstPaise,
          r.totalTaxPaise,
          `${rupees} @ ${percent}% ${state}`,
        );
        assert.equal(r.taxablePaise + r.totalTaxPaise, r.totalPaise, `${rupees} @ ${percent}%`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// One price per code
// ---------------------------------------------------------------------------

const CATALOG = {
  basePlan: { code: "POS", name: "POS", pricePaise: 39900 },
  addons: [{ code: "WEBSITE", pricePaise: 30000 }, { code: "GMB", pricePaise: 10000 }],
  tablet: { firstPricePaise: 60000, extraPricePaise: 50000, rechargeRequiredPaise: 400000 },
  printers: [{ code: "PRINTER_2IN", pricePaise: 190000 }],
};

test("every code resolves to its catalogue price, and an unknown one to nothing", () => {
  assert.equal(catalogPricePaise(CATALOG, "POS"), 39900);
  assert.equal(catalogPricePaise(CATALOG, "WEBSITE"), 30000);
  assert.equal(catalogPricePaise(CATALOG, "TABLET_FIRST"), 60000);
  assert.equal(catalogPricePaise(CATALOG, "TABLET_EXTRA"), 50000);
  assert.equal(catalogPricePaise(CATALOG, "PRINTER_2IN"), 190000);
  // Null, so a caller cannot charge for something that is not sold.
  assert.equal(catalogPricePaise(CATALOG, "GROWTH"), null);
});

test("a negotiated price beats the catalogue, per code, in rupees converted once", async () => {
  const override = { planPrices: [{ code: "POS", price: 299 }, { code: "website", price: 0 }] };
  assert.equal(await priceFor({ code: "POS", config: CATALOG, override }), money.toPaise(299));
  // A 0 is a real negotiated price, not "no override". Old lowercase codes still match.
  assert.equal(await priceFor({ code: "WEBSITE", config: CATALOG, override }), 0);
  assert.equal(await priceFor({ code: "GMB", config: CATALOG, override }), 10000, "the rest stay on the catalogue");
  assert.equal(await priceFor({ code: "tablet_first", config: CATALOG, override: null }), 60000);
  assert.equal(await priceFor({ code: "NOPE", config: CATALOG, override }), null);
});

// ---------------------------------------------------------------------------
// Nothing hard-coded
// ---------------------------------------------------------------------------

test("REGRESSION: no price, rate or charge is written into the code", () => {
  // The single most important rule in the specification: every one of these
  // lives in the admin panel, and a constant here is a number nobody can
  // change without a deploy.
  const files = [
    "services/tax.js",
    "services/pricing.js",
    "services/ledger.js",
    "services/subscription.js",
    "services/planFeatures.js",
    "models/platformBillingModel.js",
  ];
  const forbidden = [
    [/\b18\b/, "the GST rate"],
    [/\b1299\b|\b399\b|\b599\b|\b1699\b|\b2500\b|\b4000\b/, "a price"],
    [/\b0\.18\b/, "a tax multiplier"],
  ];

  for (const file of files) {
    const code = stripComments(SRC(file));
    for (const [pattern, what] of forbidden) {
      assert.ok(!pattern.test(code), `${file} hard-codes ${what}`);
    }
  }
});

test("SOURCE: the balance can only move through the ledger", () => {
  // Anything that writes balancePaise directly bypasses both invariants.
  const ledger = SRC("services/ledger.js");
  assert.match(ledger, /balancePaise: \{ \$gte: amount \}/, "a debit must be guarded by the query itself");
  assert.match(ledger, /session\.withTransaction/, "the movement and its record must be one unit");

  const model = SRC("models/businessBalanceModel.js");
  assert.match(model, /min: 0/, "the balance floor is declared on the schema too");
  assert.match(model, /unique: true, partialFilterExpression/, "idempotency needs an index, not a lookup");
});

// ---------------------------------------------------------------------------
// One place per-restaurant prices live
// ---------------------------------------------------------------------------

test("REGRESSION: there is exactly one per-restaurant override model", () => {
  // CsdStoreCharges already existed, with an audited PATCH and a CSD dialog
  // behind it. A second override collection beside it would have been a
  // fourth copy of "what does this restaurant pay" -- the failure this
  // codebase keeps repeating (four copies of gateway resolution, three of
  // website visibility, five of the address join).
  const platform = SRC("models/platformBillingModel.js");
  assert.ok(
    !/RestaurantBillingOverride/.test(stripComments(platform)),
    "the duplicate override model must stay deleted",
  );

  const CsdStoreCharges = require("../models/csdStoreChargesModel");
  assert.ok(CsdStoreCharges.schema.path("planPrices"), "negotiated prices live here");
  assert.ok(CsdStoreCharges.schema.path("onlinePaidOrderCharge"), "as does the per-order charge");

  // And pricing reads that one, not another.
  const pricing = stripComments(SRC("services/pricing.js"));
  assert.match(pricing, /csdStoreChargesModel/);
});

test("rupees become paise in exactly one place", () => {
  // CsdStoreCharges stores rupees because that is what the admin dialog
  // edits. Two conversion points is how an amount ends up 100x out.
  const pricing = SRC("services/pricing.js");
  const conversions = (pricing.match(/toPaise\(/g) || []).length;
  assert.ok(conversions > 0, "the boundary must convert");
  assert.ok(conversions <= 3, `too many conversion points (${conversions}) — keep it at the boundary`);

  // Nothing downstream of pricing should be converting again.
  for (const file of ["services/orderCharge.js", "services/ledger.js"]) {
    assert.ok(
      !/toPaise\(/.test(stripComments(SRC(file))),
      `${file} should receive paise already`,
    );
  }
});
