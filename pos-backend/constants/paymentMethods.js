/**
 * The single source of truth for `PaymentTransaction.method`.
 *
 * Why this file exists
 * --------------------
 * `PaymentTransaction.method` is an enum of payment *instruments* — how the
 * customer paid: CASH, CARD, UPI, WALLET. Which *provider* processed it is a
 * separate field (`provider`: RAZORPAY, CASHFREE, SECURE_LINK, ...).
 *
 * Two call sites conflated the two and wrote a provider name into the method
 * field, which the enum rejected at validation time:
 *
 *   1. paymentLinkController.verifyAndCaptureLinkPayment defaults
 *      `paymentMethod` to "RAZORPAY". The customer-facing page never sends the
 *      field, so every genuine capture hit the default, threw a
 *      ValidationError and aborted the whole transaction — the pay-by-link
 *      flow could not complete.
 *
 *   2. paymentController's webhook path forwards Razorpay's own
 *      `payment.method` uppercased. Razorpay sends "netbanking" for a large
 *      share of Indian payments, and "NETBANKING" is not in the enum either.
 *      That error was caught and logged, so those payments silently never
 *      reconciled.
 *
 * The failure was asymmetric and dangerous: the enum rejected the values the
 * legitimate flows produced while accepting anything an attacker chose to send
 * (see tests/paymentSecurity.test.js).
 *
 * Rather than widening the enum to accept provider names — which would make
 * `method` mean two different things — every value now passes through
 * `normalizePaymentMethod()` before it reaches the model.
 */

/** Values `PaymentTransaction.method` actually accepts. Keep in sync with the model. */
const PAYMENT_METHODS = [
  "CASH",
  "QR_CODE",
  "ONLINE",
  "PAYMENT_LINK",
  "CARD",
  "UPI",
  "WALLET",
  "SPLIT",
];

/**
 * Provider and gateway-instrument names that are NOT payment methods, mapped
 * onto the instrument they represent. Anything a gateway can report as
 * `payment.method`, plus the provider names that were being written by mistake.
 */
const METHOD_ALIASES = new Map([
  // Providers — these belong in `provider`, not `method`.
  ["razorpay", "ONLINE"],
  ["cashfree", "ONLINE"],
  ["phonepe", "ONLINE"],
  ["secure_link", "PAYMENT_LINK"],
  // Instruments as the gateways spell them.
  ["netbanking", "ONLINE"],
  ["net_banking", "ONLINE"],
  ["emi", "CARD"],
  ["credit_card", "CARD"],
  ["debit_card", "CARD"],
  ["paylater", "ONLINE"],
  ["bank_transfer", "ONLINE"],
  ["qr", "QR_CODE"],
  ["qrcode", "QR_CODE"],
]);

/**
 * Map any provider/instrument string onto a valid `PaymentTransaction.method`.
 *
 * Unknown values fall back to `ONLINE` rather than propagating a value the
 * model will reject: losing the exact instrument name costs a little reporting
 * detail, whereas a ValidationError here aborts the surrounding transaction and
 * loses the record of a payment that really happened. The raw value is still
 * preserved on `provider` / `gatewayResponse`.
 *
 * @param {string} value  e.g. "RAZORPAY", "netbanking", "upi"
 * @param {string} [fallback="ONLINE"]
 * @returns {string} a member of PAYMENT_METHODS
 */
const normalizePaymentMethod = (value, fallback = "ONLINE") => {
  const raw = String(value || "").trim();
  if (!raw) return fallback;

  const upper = raw.toUpperCase();
  if (PAYMENT_METHODS.includes(upper)) return upper;

  const alias = METHOD_ALIASES.get(raw.toLowerCase());
  if (alias) return alias;

  return fallback;
};

/**
 * `Order.payments[].method` is a SEPARATE, narrower, lower-case enum
 * (cash|card|upi|wallet|online|split) declared in models/orderModel.js. Writing
 * a PaymentTransaction method straight into it fails validation for QR_CODE and
 * PAYMENT_LINK, and writing a raw gateway name fails for everything except the
 * six it lists — `"razorpay".toLowerCase()` is not a member.
 *
 * @param {string} value  any provider/instrument string
 * @returns {string} a member of the Order payment enum
 */
const ORDER_PAYMENT_METHODS = ["cash", "card", "upi", "wallet", "online", "split"];

const toOrderPaymentMethod = (value) => {
  const normalized = normalizePaymentMethod(value);
  // QR_CODE and PAYMENT_LINK have no Order-level equivalent; both are online.
  if (normalized === "QR_CODE" || normalized === "PAYMENT_LINK") return "online";
  const lower = normalized.toLowerCase();
  return ORDER_PAYMENT_METHODS.includes(lower) ? lower : "online";
};

module.exports = {
  PAYMENT_METHODS,
  ORDER_PAYMENT_METHODS,
  METHOD_ALIASES,
  normalizePaymentMethod,
  toOrderPaymentMethod,
};
