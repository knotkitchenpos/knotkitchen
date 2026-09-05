/**
 * Cashfree Payments (PG) adapter.
 *
 * Cashfree's flow is shaped differently from Razorpay's, and the difference
 * matters for how we decide a payment happened:
 *
 *   Razorpay  the browser hands back a signature over (order_id|payment_id)
 *             and the server re-computes it with the secret.
 *   Cashfree  the browser hands back nothing worth trusting. The server
 *             creates an order, the browser pays against a
 *             `payment_session_id`, and the server then ASKS CASHFREE what
 *             happened.
 *
 * The second is strictly safer: there is no client-supplied token in the
 * decision at all. `isOrderPaid` is therefore the only thing that may settle
 * a bill, and it talks to Cashfree directly every time.
 *
 * API: https://www.cashfree.com/docs/api-reference/payments/latest/orders/create
 */

const crypto = require("crypto");

/** Pinned. A silent version bump would change response shapes under us. */
const API_VERSION = "2026-01-01";

const BASE_URLS = {
  TEST: "https://sandbox.cashfree.com/pg",
  PROD: "https://api.cashfree.com/pg",
};

const TIMEOUT_MS = 15_000;

class CashfreeError extends Error {
  constructor(message, { status, code, retryable = false, body } = {}) {
    super(message);
    this.name = "CashfreeError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.body = body; // for logs only; never returned to a browser
  }
}

const baseUrlFor = (environment) =>
  BASE_URLS[String(environment || "TEST").toUpperCase()] || BASE_URLS.TEST;

/**
 * `customer_id` must be 3-50 chars and Cashfree rejects most punctuation.
 * Derive a stable one from whatever we have rather than sending a raw Mongo
 * id with characters they may reject.
 */
const toCustomerId = (seed) => {
  const cleaned = String(seed || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (cleaned.length >= 3) return cleaned.slice(0, 50);
  return `cust_${crypto.randomBytes(8).toString("hex")}`;
};

/** Their order_id is 3-45 chars, alphanumeric plus underscore and hyphen. */
const toOrderId = (seed) => {
  const cleaned = String(seed || "").replace(/[^a-zA-Z0-9_-]/g, "");
  const base = cleaned.length >= 3 ? cleaned : `kk_${Date.now().toString(36)}`;
  return base.slice(0, 45);
};

/** Cashfree wants exactly 10 digits for an Indian number. */
const toTenDigit = (phone) => String(phone || "").replace(/\D/g, "").slice(-10);

const request = async ({ path, method = "GET", body, appId, secretKey, environment }) => {
  if (!appId || !secretKey) throw new CashfreeError("Cashfree credentials are not configured.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${baseUrlFor(environment)}${path}`, {
      method,
      headers: {
        "x-api-version": API_VERSION,
        "x-client-id": appId,
        "x-client-secret": secretKey,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new CashfreeError("Cashfree request timed out.", { retryable: true });
    }
    throw new CashfreeError(`Cashfree network error: ${err.message}`, { retryable: true });
  } finally {
    clearTimeout(timer);
  }

  const payload = await response.json().catch(() => ({}));

  if (response.status >= 500) {
    throw new CashfreeError(`Cashfree ${response.status}`, {
      status: response.status,
      retryable: true,
      body: payload,
    });
  }
  if (!response.ok) {
    throw new CashfreeError(payload?.message || `Cashfree rejected the request (HTTP ${response.status})`, {
      status: response.status,
      code: payload?.code || payload?.type,
      body: payload,
    });
  }

  return payload;
};

/**
 * Open an order. The AMOUNT MUST come from the caller's own record, never
 * from a browser — this function does not know the difference and will
 * faithfully charge whatever it is given.
 *
 * @returns {{orderId, cfOrderId, paymentSessionId, orderStatus, environment}}
 */
const createOrder = async ({
  appId,
  secretKey,
  environment,
  amount,
  currency = "INR",
  orderId,
  customer = {},
  returnUrl,
  notifyUrl,
  tags,
}) => {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new CashfreeError("Cashfree order amount must be a positive number.");
  }

  const phone = toTenDigit(customer.phone);
  if (phone.length !== 10) {
    // Cashfree requires it, so fail here with a message an operator can act on
    // rather than letting their API return a generic 400.
    throw new CashfreeError("A 10-digit customer phone number is required to take an online payment.");
  }

  const body = {
    order_amount: Math.round(value * 100) / 100, // two decimals, as documented
    order_currency: currency,
    order_id: toOrderId(orderId),
    customer_details: {
      customer_id: toCustomerId(customer.id || orderId),
      customer_phone: phone,
      ...(customer.name ? { customer_name: String(customer.name).slice(0, 100) } : {}),
      ...(customer.email ? { customer_email: String(customer.email).slice(0, 100) } : {}),
    },
    ...(returnUrl || notifyUrl
      ? {
          order_meta: {
            ...(returnUrl ? { return_url: String(returnUrl).slice(0, 250) } : {}),
            // Must be HTTPS per their docs; a plain-http notify_url is
            // rejected, so drop it rather than fail the whole order.
            ...(notifyUrl && /^https:\/\//i.test(notifyUrl)
              ? { notify_url: String(notifyUrl).slice(0, 250) }
              : {}),
          },
        }
      : {}),
    ...(tags ? { order_tags: tags } : {}),
  };

  const res = await request({
    path: "/orders",
    method: "POST",
    body,
    appId,
    secretKey,
    environment,
  });

  return {
    orderId: res.order_id,
    cfOrderId: res.cf_order_id,
    paymentSessionId: res.payment_session_id,
    orderStatus: res.order_status,
    environment: String(environment || "TEST").toUpperCase(),
  };
};

/** Read an order back. This is the only source of truth about payment. */
const fetchOrder = async ({ appId, secretKey, environment, orderId }) =>
  request({
    path: `/orders/${encodeURIComponent(orderId)}`,
    appId,
    secretKey,
    environment,
  });

/**
 * Did this order actually get paid?
 *
 * Asks Cashfree. Never infers from anything the browser said. A non-PAID
 * status (ACTIVE, EXPIRED, TERMINATED) resolves false rather than throwing,
 * so a caller can tell "not paid" apart from "we could not find out".
 */
const isOrderPaid = async ({ appId, secretKey, environment, orderId }) => {
  const order = await fetchOrder({ appId, secretKey, environment, orderId });
  return {
    paid: String(order?.order_status).toUpperCase() === "PAID",
    orderStatus: order?.order_status || "",
    amount: Number(order?.order_amount) || 0,
    cfOrderId: order?.cf_order_id || "",
  };
};

/**
 * Verify a webhook came from Cashfree.
 *
 * Base64(HMAC-SHA256(timestamp + rawBody, secret)) — the timestamp and the
 * RAW body concatenated with no separator. It must be the raw bytes: a body
 * that has been through JSON.parse and re-stringified will not match, because
 * key order and whitespace are not preserved.
 */
const verifyWebhook = ({ rawBody, timestamp, signature, secretKey }) => {
  if (!rawBody || !timestamp || !signature || !secretKey) return false;
  const expected = crypto
    .createHmac("sha256", secretKey)
    .update(`${timestamp}${rawBody}`)
    .digest("base64");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signature), "utf8");
  // Length check first: timingSafeEqual throws on a mismatch.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/**
 * Cheapest call that proves a credential pair works, for the
 * "Verify credentials" button in Website Settings.
 *
 * Reads a deliberately absent order: correct credentials give 404 (or a
 * Cashfree "order not found" code), bad ones give 401. Anything else is
 * reported as unverified rather than guessed at.
 */
const verifyCredentials = async ({ appId, secretKey, environment }) => {
  const probe = `kkverify${crypto.randomBytes(6).toString("hex")}`;
  try {
    await fetchOrder({ appId, secretKey, environment, orderId: probe });
    // Astonishing, but a 200 also means the credentials work.
    return { ok: true };
  } catch (err) {
    if (err instanceof CashfreeError && err.status === 404) return { ok: true };
    if (err instanceof CashfreeError && (err.status === 401 || err.status === 403)) {
      return { ok: false, reason: "Cashfree rejected these credentials." };
    }
    return {
      ok: false,
      reason: err?.message || "Could not reach Cashfree to check these credentials.",
    };
  }
};

module.exports = {
  API_VERSION,
  BASE_URLS,
  CashfreeError,
  createOrder,
  fetchOrder,
  isOrderPaid,
  verifyWebhook,
  verifyCredentials,
  toOrderId,
  toCustomerId,
  toTenDigit,
};
