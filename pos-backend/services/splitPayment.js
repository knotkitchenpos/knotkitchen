/**
 * Split payment: one bill, several counter methods.
 *
 * "Cash ₹500 + UPI ₹300" is the everyday case; the parts must add up to the
 * payable amount exactly (to the paisa) and every part must be a method the
 * counter can confirm on the spot.
 */
const COUNTER_METHODS = ["CASH", "UPI", "CARD", "QR_CODE"];

const { round2 } = require("./money");

/**
 * @returns {{ ok: boolean, message?: string, parts?: Array<{method: string, amount: number}> }}
 */
const validateSplits = (splits, payable) => {
  if (!Array.isArray(splits) || splits.length < 2) return { ok: false, message: "A split needs at least two parts." };
  if (splits.length > 6) return { ok: false, message: "At most six parts in a split." };
  const parts = [];
  for (const s of splits) {
    const method = String(s?.method || "").toUpperCase();
    const amount = round2(s?.amount);
    if (!COUNTER_METHODS.includes(method)) return { ok: false, message: `"${s?.method}" cannot be part of a split.` };
    if (!(amount > 0)) return { ok: false, message: "Every part of a split must be more than zero." };
    parts.push({ method, amount });
  }
  const sum = round2(parts.reduce((t, p) => t + p.amount, 0));
  if (Math.abs(sum - round2(payable)) > 0.009) {
    return { ok: false, message: `The parts add up to ₹${sum.toFixed(2)}, not the payable ₹${round2(payable).toFixed(2)}.` };
  }
  return { ok: true, parts };
};

/** "Split (Cash ₹500 + UPI ₹300)" for the order and the receipt. */
const splitLabel = (parts, labelOf = (m) => m) =>
  `Split (${parts.map((p) => `${labelOf(p.method)} ₹${p.amount.toFixed(2)}`).join(" + ")})`;

module.exports = { COUNTER_METHODS, validateSplits, splitLabel };
