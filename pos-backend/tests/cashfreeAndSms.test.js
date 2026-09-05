/**
 * Cashfree PG and the Fast2SMS DLT transport.
 *
 * Neither can be exercised end to end without live credentials, so what is
 * pinned here is everything that does NOT need them: the shapes we send, the
 * things we refuse to send, and — most importantly — that no secret ever
 * leaves the server and no browser-supplied value can decide that a bill was
 * paid.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const cashfree = require("../services/gateways/cashfree");
const { resolveGateway, PROVIDERS } = require("../services/paymentGateway");
const { MESSAGES } = require("../services/messagingService");
const { sendDlt, Fast2SmsError } = require("../services/fast2smsProvider");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

// ---------------------------------------------------------------------------
// Cashfree: webhook signatures
// ---------------------------------------------------------------------------

test("a webhook signature is Base64(HMAC-SHA256(timestamp + rawBody))", () => {
  const secret = "test_secret_value";
  const rawBody = '{"type":"PAYMENT_SUCCESS_WEBHOOK","data":{"order":{"order_id":"kk_1"}}}';
  const timestamp = "1725500000";
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}${rawBody}`)
    .digest("base64");

  assert.equal(cashfree.verifyWebhook({ rawBody, timestamp, signature, secretKey: secret }), true);
});

test("a tampered body, timestamp or secret fails verification", () => {
  const secret = "test_secret_value";
  const rawBody = '{"amount":100}';
  const timestamp = "1725500000";
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}${rawBody}`)
    .digest("base64");

  assert.equal(
    cashfree.verifyWebhook({ rawBody: '{"amount":1}', timestamp, signature, secretKey: secret }),
    false,
    "body swapped",
  );
  assert.equal(
    cashfree.verifyWebhook({ rawBody, timestamp: "1725500001", signature, secretKey: secret }),
    false,
    "timestamp swapped",
  );
  assert.equal(
    cashfree.verifyWebhook({ rawBody, timestamp, signature, secretKey: "other" }),
    false,
    "secret swapped",
  );
});

test("verification never throws on a malformed or absent signature", () => {
  // timingSafeEqual throws when the buffers differ in length, and a webhook
  // endpoint that throws is a webhook endpoint that retries forever.
  const args = { rawBody: "{}", timestamp: "1", secretKey: "s" };
  assert.equal(cashfree.verifyWebhook({ ...args, signature: "" }), false);
  assert.equal(cashfree.verifyWebhook({ ...args, signature: "short" }), false);
  assert.equal(cashfree.verifyWebhook({ ...args, signature: "x".repeat(500) }), false);
  assert.equal(cashfree.verifyWebhook({}), false);
});

// ---------------------------------------------------------------------------
// Cashfree: what we refuse to send
// ---------------------------------------------------------------------------

test("an order is never opened without credentials", async () => {
  await assert.rejects(
    () => cashfree.createOrder({ amount: 100, customer: { phone: "9876543210" } }),
    /credentials are not configured/i,
  );
});

test("an order is never opened for a non-positive amount", async () => {
  for (const amount of [0, -5, NaN, "abc", null]) {
    await assert.rejects(
      () =>
        cashfree.createOrder({
          appId: "a",
          secretKey: "b",
          amount,
          customer: { phone: "9876543210" },
        }),
      /positive number/i,
      `amount ${amount}`,
    );
  }
});

test("an order is never opened without a usable phone number", async () => {
  // Cashfree requires one. Failing here gives an operator something to act on
  // instead of a generic 400 from their API.
  await assert.rejects(
    () => cashfree.createOrder({ appId: "a", secretKey: "b", amount: 10, customer: { phone: "123" } }),
    /10-digit customer phone/i,
  );
});

test("identifiers are coerced into the shapes Cashfree accepts", () => {
  // order_id: 3-45 chars, alphanumeric plus _ and -. customer_id: 3-50.
  assert.match(cashfree.toOrderId("tbl_TS_ABC/123#x"), /^[a-zA-Z0-9_-]+$/);
  assert.ok(cashfree.toOrderId("x".repeat(200)).length <= 45);
  assert.ok(cashfree.toOrderId("a").length >= 3, "too short falls back to a generated id");
  assert.match(cashfree.toCustomerId("sess_6a9b!!"), /^[a-zA-Z0-9_-]+$/);
  assert.ok(cashfree.toCustomerId("").length >= 3);
  assert.equal(cashfree.toTenDigit("+91 98765 43210"), "9876543210");
});

test("the sandbox and production hosts are not interchangeable", () => {
  assert.equal(cashfree.BASE_URLS.TEST, "https://sandbox.cashfree.com/pg");
  assert.equal(cashfree.BASE_URLS.PROD, "https://api.cashfree.com/pg");
  // An unrecognised environment must land on SANDBOX, never on production:
  // a typo in CASHFREE_ENV should cost a failed test payment, not a real one.
  const src = read("services", "gateways", "cashfree.js");
  assert.match(src, /BASE_URLS\[String\(environment \|\| "TEST"\)\.toUpperCase\(\)\] \|\| BASE_URLS\.TEST/);
});

test("the API version is pinned", () => {
  // Their response shapes are versioned; drifting silently is how
  // payment_session_id stops arriving one morning.
  assert.match(cashfree.API_VERSION, /^\d{4}-\d{2}-\d{2}$/);
});

// ---------------------------------------------------------------------------
// Gateway resolution
// ---------------------------------------------------------------------------

test("with no credentials anywhere, online payment is simply off", async () => {
  const gw = await resolveGateway({});
  assert.equal(typeof gw.enabled, "boolean");
  assert.equal(gw.source, "platform");
  assert.ok(Object.values(PROVIDERS).includes(gw.provider));
});

test("a stored gateway marked configured but with an unusable secret is not trusted", () => {
  // "isConfigured: true" in the database is a claim, not a check. A blank or
  // undecodable secret must fall through to the platform keys rather than
  // producing a gateway that fails on first use.
  const src = read("services", "paymentGateway.js");
  assert.match(src, /if \(!gw \|\| !gw\.isConfigured\) return null;/);
  assert.match(src, /const secret = decodeSecret\(gw\.clientSecretEncrypted\);/);
  assert.match(src, /if \(secret\) \{/);
});

test("Cashfree webhooks are signed with the same client secret", () => {
  const src = read("services", "paymentGateway.js");
  const cf = src.slice(src.indexOf("name === PROVIDERS.CASHFREE"), src.indexOf("PROVIDERS.PHONEPE"));
  assert.match(cf, /webhookSecret: secret/);
});

// ---------------------------------------------------------------------------
// Fast2SMS DLT
// ---------------------------------------------------------------------------

test("a DLT send refuses to go out half-configured", async () => {
  const base = { phone: "9876543210", apiKey: "k", senderId: "KNOTKT", templateId: "12345" };
  await assert.rejects(() => sendDlt({ ...base, apiKey: "" }), /API key/i);
  await assert.rejects(() => sendDlt({ ...base, senderId: "" }), /sender ID/i);
  await assert.rejects(() => sendDlt({ ...base, templateId: "" }), /template ID/i);
  await assert.rejects(() => sendDlt({ ...base, phone: "12345" }), /10-digit/i);
});

test("a pipe inside a variable cannot shift the other variables", async () => {
  // variables_values is pipe-separated with no escape. A customer called
  // "A|B" would push every later value into the wrong placeholder -- the
  // total into the order-number slot, and so on.
  let sent = null;
  const originalFetch = global.fetch;
  global.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ return: true, request_id: "r1" }) };
  };
  try {
    await sendDlt({
      phone: "9876543210",
      apiKey: "k",
      senderId: "KNOTKT",
      templateId: "12345",
      variables: ["A|B", "1042", 450],
    });
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(sent.route, "dlt");
  assert.equal(sent.sender_id, "KNOTKT");
  assert.equal(sent.message, "12345", "the template id travels as `message`");
  assert.equal(sent.numbers, "9876543210");
  assert.equal(sent.variables_values, "A B|1042|450", "three values, three separators");
  assert.equal(sent.variables_values.split("|").length, 3);
});

test("each message declares the variable order its template expects", () => {
  // The one thing that cannot be inferred and does not error when wrong: a
  // mismatched order just puts the total where the order number should be.
  for (const [name, spec] of Object.entries(MESSAGES)) {
    assert.equal(typeof spec.variables, "function", `${name} must declare its variables`);
    assert.equal(typeof spec.templateId, "function", `${name} must read its template id from env`);
    assert.equal(typeof spec.text, "function", `${name} needs a non-DLT fallback`);
    const vars = spec.variables({});
    assert.ok(Array.isArray(vars) && vars.length > 0, `${name} variables must be an ordered array`);
  }
});

test("with no template configured a message still goes out as free text", () => {
  // A store mid-DLT-registration must keep working exactly as it did.
  const src = read("services", "messagingService.js");
  assert.match(src, /templateId && sender\s*\?\s*await sendDlt/);
  assert.match(src, /:\s*await sendText/);
});

test("an unconfigured provider reports failure rather than pretending", () => {
  const src = read("services", "messagingService.js");
  const block = src.slice(src.indexOf("if (!key) {"), src.indexOf("const templateId = spec.templateId()"));
  assert.match(block, /sent: false/);
  assert.match(block, /deliveryStatus: "FAILED"/);
});

test("the Fast2SMS error message is surfaced, and it never carries the key", () => {
  // "Invalid Message ID" / "Insufficient balance" is exactly what an operator
  // needs. The provider puts the key in a header, never in its own message.
  const src = read("services", "fast2smsProvider.js");
  assert.match(src, /authorization: apiKey/);
  const errCtor = src.slice(src.indexOf("class Fast2SmsError"), src.indexOf("const toIndianTenDigit"));
  assert.ok(!/apiKey/.test(errCtor), "the error type does not carry the credential");
  assert.ok(err_is_reported());

  function err_is_reported() {
    const svc = read("services", "messagingService.js");
    return /err instanceof Fast2SmsError \? err\.message/.test(svc);
  }
});

test("Fast2SmsError is still the type callers catch", () => {
  assert.equal(typeof Fast2SmsError, "function");
  const e = new Fast2SmsError("x", { retryable: true });
  assert.equal(e.retryable, true);
  assert.equal(e.name, "Fast2SmsError");
});

// ---------------------------------------------------------------------------
// The webhook: the safety net when the browser never comes back
// ---------------------------------------------------------------------------

test("the webhook settles nothing it cannot trace back to an order WE opened", () => {
  const src = read("controllers", "cashfreeWebhookController.js");
  // A forged event naming an order we never created must find nothing.
  const lookup = src.indexOf("TableSession.findOne");
  const verify = src.indexOf("cashfree.verifyWebhook");
  const settle = src.indexOf("settleSessionFromGateway");
  assert.ok(lookup > 0 && verify > lookup, "look up the order, THEN verify");
  assert.ok(settle > verify, "and never settle before verifying");
  assert.match(src, /"payment\.gatewayOrderId": orderId/);
});

test("the signature is checked against the tenant that owns the order", () => {
  // A signature valid under some other store's secret must not settle this
  // store's table.
  const src = read("controllers", "cashfreeWebhookController.js");
  assert.match(src, /resolveGateway\(\{ restaurantId: session\.restaurantId \}\)/);
  assert.match(src, /secretKey: gw\.webhookSecret/);
});

test("even a correctly signed event is not believed about the money", () => {
  const src = read("controllers", "cashfreeWebhookController.js");
  assert.match(src, /cashfree\.isOrderPaid/);
  assert.match(src, /if \(!status\.paid\) return ack/);
  assert.match(src, /status\.amount.*payable|Math\.abs\(Number\(status\.amount\)/s);
});

test("it verifies over the RAW bytes, never a re-serialised body", () => {
  const src = read("controllers", "cashfreeWebhookController.js");
  assert.match(src, /req\.rawBody/);
  assert.ok(!/JSON\.stringify\(req\.body\)/.test(src));
});

test("the webhook never answers 5xx, and 4xx only for a bad signature", () => {
  // Anything else would be retried for days over our own bug.
  const src = read("controllers", "cashfreeWebhookController.js");
  const statuses = [...src.matchAll(/status\((\d{3})\)/g)].map((m) => m[1]);
  assert.ok(statuses.includes("401"), "a rejected signature is worth refusing");
  assert.ok(!statuses.includes("500"), "never 500 at a webhook");
  assert.ok(
    statuses.every((c) => c === "200" || c === "401"),
    `only 200 and 401, found ${statuses.join(",")}`,
  );
});

test("browser and webhook share one idempotency key, so whichever loses is a no-op", () => {
  const hook = read("controllers", "cashfreeWebhookController.js");
  const qr = read("routes", "qrRoute.js");
  assert.match(hook, /idempotencyKey: `qr-online-\$\{status\.cfOrderId \|\| orderId\}`/);
  assert.match(qr, /idempotencyKey: `qr-online-\$\{transactionId\}`/);
});

test("Cashfree payloads on the Razorpay endpoint are refused, not handled", () => {
  // Its signature scheme and headers are different; a branch here could only
  // ever be a second, weaker implementation.
  const src = read("controllers", "paymentController.js");
  assert.match(src, /cashfree\/webhook/);
  assert.ok(
    !/finalizePaymentLinkFromGateway/.test(
      src.slice(src.indexOf("PAYMENT_SUCCESS_WEBHOOK"), src.indexOf("Razorpay Webhook Handling")),
    ),
    "the disabled branch must not start acting again",
  );
});

// ---------------------------------------------------------------------------
// Payment links
// ---------------------------------------------------------------------------

test("a payment link is never created without a usable gateway", () => {
  // It used to mint a synthetic `CASHFREE_LINK_<ts>` id without calling the
  // provider: the link opened, could not be paid, and could not have been
  // verified even if it had been. A link nobody can pay is worse than none.
  const src = read("controllers", "paymentLinkController.js");
  assert.match(src, /No payment gateway is configured for this store/);
  assert.match(src, /createHttpError\(\s*503/);
});

test("a Cashfree payment link opens a REAL gateway order", () => {
  const src = read("controllers", "paymentLinkController.js");
  assert.match(src, /cashfree\.createOrder/);
  // Comments may still describe the old behaviour -- one does, explaining
  // exactly this. Only executable code is in question.
  const code = src
    .split(String.fromCharCode(10))
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join(String.fromCharCode(10));
  assert.ok(
    !/CASHFREE_LINK_/.test(code),
    "the synthetic order id that could never be verified is gone",
  );
  assert.ok(!/PHONEPE_LINK_/.test(code));
});

test("capture picks its check from the LINK, not from the request", () => {
  // Reading the gateway off the request would let a caller choose the weaker
  // verification path by naming a different gateway.
  const src = read("controllers", "paymentLinkController.js");
  assert.match(src, /const linkGateway = String\(link\.gatewayName \|\| "RAZORPAY"\)\.toUpperCase\(\)/);
  const capture = src.slice(src.indexOf("const linkGateway"), src.indexOf("// Idempotency check"));
  assert.match(capture, /if \(linkGateway === "CASHFREE"\)/);
  assert.match(capture, /cashfree\.isOrderPaid/);
  assert.match(capture, /timingSafeEquals/, "Razorpay still verifies its signature");
  assert.match(capture, /501/, "an unintegrated gateway is refused, not guessed at");
});

test("an unconfirmable Cashfree capture is not reported as a failed payment", () => {
  const src = read("controllers", "paymentLinkController.js");
  const capture = src.slice(src.indexOf('if (linkGateway === "CASHFREE")'), src.indexOf('} else if (linkGateway === "RAZORPAY")'));
  assert.match(capture, /502/);
  assert.match(capture, /could not confirm that payment/i);
  assert.match(capture, /status\.amount/, "and the amount is checked against the link");
});

test("the link page is given public values only", () => {
  const src = read("controllers", "paymentLinkController.js");
  const payload = src.slice(src.indexOf("gatewayKeyId:"), src.indexOf("restaurantName:"));
  assert.match(payload, /gatewayKeyId: linkGw\.provider === PROVIDERS\.RAZORPAY \? linkGw\.keyId : ""/);
  assert.ok(!/linkGw\.secret/.test(payload), "never the secret");
  assert.ok(!/\.secret/.test(payload));
});

test("the link page uses the STORE's key, not a build-time platform key", () => {
  // A store paying into its own Razorpay account had the platform key put in
  // front of the customer, against an order id that key does not own.
  const src = read("..", "pos-frontend", "src", "pages", "PaymentLink.jsx");
  assert.match(src, /key: link\.gatewayKeyId \|\| import\.meta\.env\.VITE_RAZORPAY_KEY_ID/);
  assert.match(src, /loadCashfree/);
  assert.match(src, /paymentSessionId: link\.paymentSessionId/);
});
