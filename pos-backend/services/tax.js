/**
 * GST, as configured -- never as a constant.
 *
 * There is no 18 in this file. The rate, the registration status, the date it
 * starts applying and whether prices include or exclude it all come from the
 * admin panel, because "18%" written into code is a number nobody can change
 * without a deploy and which is wrong the moment a rate changes.
 *
 * Three things make tax zero, and they are checked in this order:
 *   1. not registered
 *   2. before the effective date  -- "1299 + 0 GST = 1299" in the spec
 *   3. a zero rate
 *
 * Intra-state supply splits into CGST + SGST; inter-state is IGST. The split
 * uses splitEvenly so the two halves always sum back to the total, even on an
 * odd number of paise.
 */

const { percentOf, splitEvenly } = require("./money");

const EMPTY = Object.freeze({
  applicable: false,
  percent: 0,
  mode: "exclusive",
  taxablePaise: 0,
  cgstPaise: 0,
  sgstPaise: 0,
  igstPaise: 0,
  totalTaxPaise: 0,
  totalPaise: 0,
  interState: false,
});

const sameState = (a, b) =>
  String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

/**
 * Is GST chargeable at `on`?
 *
 * A null effectiveFrom means "not started yet", not "always" -- an admin who
 * ticks Registered before filling in the date should not retroactively start
 * taxing every invoice.
 */
const gstApplicableAt = (gst, on = new Date()) => {
  if (!gst || !gst.registered) return false;
  if (!gst.effectiveFrom) return false;
  if (new Date(on) < new Date(gst.effectiveFrom)) return false;
  return Number(gst.percent) > 0;
};

/**
 * Compute tax on an amount.
 *
 * `amountPaise` is read according to `gst.mode`: under "exclusive" it is the
 * taxable value and tax is added; under "inclusive" it is the gross and the
 * tax is extracted from within it. Either way `totalPaise` is what the
 * restaurant actually pays, so callers never have to know which mode is set.
 */
const computeTax = ({ amountPaise, gst, restaurantState, on = new Date() } = {}) => {
  const base = Math.round(Number(amountPaise) || 0);

  if (!gstApplicableAt(gst, on)) {
    return { ...EMPTY, taxablePaise: base, totalPaise: base };
  }

  const percent = Number(gst.percent);
  const mode = gst.mode === "inclusive" ? "inclusive" : "exclusive";

  // Inclusive: base already contains the tax, so the taxable value is
  // base / (1 + rate) and the tax is the remainder. Derived by subtraction so
  // taxable + tax always equals base exactly, with no rounding gap.
  const taxablePaise =
    mode === "inclusive" ? Math.round((base * 100) / (100 + percent)) : base;
  const totalTaxPaise = mode === "inclusive" ? base - taxablePaise : percentOf(base, percent);
  const totalPaise = mode === "inclusive" ? base : base + totalTaxPaise;

  // No configured place of supply means we cannot tell intra from inter
  // state. CGST+SGST is the safe reading: it is the domestic default, and
  // getting it wrong as IGST would misreport the split on a real return.
  const interState =
    Boolean(gst.placeOfSupplyState) &&
    Boolean(restaurantState) &&
    !sameState(gst.placeOfSupplyState, restaurantState);

  const [cgstPaise, sgstPaise] = interState ? [0, 0] : splitEvenly(totalTaxPaise, 2);

  return {
    applicable: true,
    percent,
    mode,
    taxablePaise,
    cgstPaise,
    sgstPaise,
    igstPaise: interState ? totalTaxPaise : 0,
    totalTaxPaise,
    totalPaise,
    interState,
  };
};

module.exports = { computeTax, gstApplicableAt, EMPTY_TAX: EMPTY };
