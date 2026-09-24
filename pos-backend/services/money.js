/**
 * Money, in paise.
 *
 * Every amount in the billing system is an INTEGER number of paise. Rupees as
 * floats do not survive tax arithmetic: 1299 * 0.18 is 233.82000000000002 in
 * IEEE 754, and a few of those down a monthly invoice is a figure that does
 * not match the sum of its own lines. Integers cannot drift.
 *
 * Rupees appear only at the boundaries -- what a gateway is told, and what a
 * person reads. Everything in between is paise.
 */

const PAISE_PER_RUPEE = 100;

/** Rupees (number or numeric string) -> paise. Rounds half away from zero. */
const toPaise = (rupees) => {
  const n = Number(rupees);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * PAISE_PER_RUPEE);
};

/** Paise -> rupees as a Number. For display and for gateway payloads only. */
const toRupees = (paise) => Math.round(Number(paise) || 0) / PAISE_PER_RUPEE;

/** "1,532.82" -- Indian digit grouping, always two decimals. */
const formatAmount = (paise) => {
  const value = Math.round(Number(paise) || 0);
  const negative = value < 0;
  const abs = Math.abs(value);
  const rupees = Math.floor(abs / PAISE_PER_RUPEE);
  const fraction = String(abs % PAISE_PER_RUPEE).padStart(2, "0");
  return `${negative ? "-" : ""}${rupees.toLocaleString("en-IN")}.${fraction}`;
};

/** "₹1,532.82" */
const formatINR = (paise) => `₹${formatAmount(paise)}`;

/**
 * A percentage of an amount, in paise, rounded half away from zero.
 *
 * `percent` may be fractional (2.5%, 18%). Kept as one function so every tax
 * line in the system rounds the same way -- two call sites rounding
 * differently is how an invoice stops adding up to its own total.
 */
const percentOf = (paise, percent) => {
  const base = Math.round(Number(paise) || 0);
  const rate = Number(percent) || 0;
  const exact = (base * rate) / 100;
  return exact < 0 ? -Math.round(-exact) : Math.round(exact);
};

/**
 * Split an amount into `parts` pieces that sum EXACTLY back to it.
 *
 * CGST and SGST are each half of the GST, and half of an odd number of paise
 * is not a whole paise. Splitting naively leaves the invoice one paise short
 * of its own total. The remainder goes to the earlier parts.
 */
const splitEvenly = (paise, parts) => {
  const total = Math.round(Number(paise) || 0);
  const n = Math.max(1, Math.floor(parts));
  const base = Math.trunc(total / n);
  const remainder = total - base * n;
  const sign = remainder < 0 ? -1 : 1;

  return Array.from({ length: n }, (_, i) => base + (i < Math.abs(remainder) ? sign : 0));
};

// --- Amount in words (the invoice requires it) -----------------------------

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const twoDigits = (n) =>
  n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;

const threeDigits = (n) => {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [
    hundreds ? `${ONES[hundreds]} Hundred` : "",
    rest ? twoDigits(rest) : "",
  ]
    .filter(Boolean)
    .join(" ");
};

/** Indian numbering: crore, lakh, thousand, hundred. */
const wholeInWords = (n) => {
  if (n === 0) return "Zero";
  const groups = [
    [Math.floor(n / 10000000), "Crore"],
    [Math.floor((n % 10000000) / 100000), "Lakh"],
    [Math.floor((n % 100000) / 1000), "Thousand"],
    [n % 1000, ""],
  ];
  return groups
    .filter(([value]) => value > 0)
    .map(([value, label]) => `${threeDigits(value)}${label ? ` ${label}` : ""}`)
    .join(" ")
    .trim();
};

/** "Rupees One Thousand Five Hundred Thirty Two and Eighty Two Paise Only" */
const amountInWords = (paise) => {
  const value = Math.round(Number(paise) || 0);
  const negative = value < 0;
  const abs = Math.abs(value);
  const rupees = Math.floor(abs / PAISE_PER_RUPEE);
  const fraction = abs % PAISE_PER_RUPEE;

  const parts = [negative ? "Minus" : "", "Rupees", wholeInWords(rupees)];
  if (fraction) parts.push("and", wholeInWords(fraction), "Paise");
  parts.push("Only");

  return parts.filter(Boolean).join(" ");
};

/** An amount as the API sends it: paise inside, rupees and a label for the UI. */
const asAmount = (paise) => ({ paise, rupees: toRupees(paise), label: formatINR(paise) });

/** Rupees to the paisa, as a number: 12.345 -> 12.35. The one rounding for order money. */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

module.exports = {
  PAISE_PER_RUPEE,
  round2,
  toPaise,
  toRupees,
  formatAmount,
  formatINR,
  asAmount,
  percentOf,
  splitEvenly,
  amountInWords,
};
