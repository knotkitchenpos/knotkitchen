/**
 * The unauthenticated endpoints are throttled.
 *
 * Every `:token` route on the QR router is public, gated only by a table's QR
 * code — which anyone who has eaten at that table, or photographed the card
 * stuck to it, keeps indefinitely. None of them had a rate limit, so one person
 * could place unlimited orders onto a live table's bill or hold the waiter
 * alarm on permanently. The payment-link `/verify` endpoint, which settles a
 * payment, was unthrottled too.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { rateLimit, resetRateLimits, clientIp } = require("../middlewares/rateLimiter");

const routeSrc = (name) =>
  fs.readFileSync(path.join(__dirname, "..", "routes", name), "utf8");

// ---- the middleware itself -------------------------------------------

test("REGRESSION: a request with no headers does not crash the limiter", () => {
  // Express always populates headers; tests and internal calls do not. A
  // limiter that throws takes down the endpoint it was added to protect.
  resetRateLimits();
  assert.doesNotThrow(() => clientIp({}));
  assert.doesNotThrow(() => clientIp(undefined));
  assert.equal(clientIp({}), "unknown");
});

test("REGRESSION: a response with no setHeader does not crash the limiter", () => {
  resetRateLimits();
  const mw = rateLimit({ windowMs: 1000, max: 5 });
  let nextErr = "unset";
  assert.doesNotThrow(() => mw({ ip: "1.1.1.1" }, {}, (e) => { nextErr = e; }));
  assert.equal(nextErr, undefined, "the request must still pass through");
});

test("allows up to the limit, then refuses with 429", () => {
  resetRateLimits();
  const mw = rateLimit({ windowMs: 60_000, max: 3 });
  const req = { ip: "9.9.9.9", headers: {} };
  const res = { setHeader() {} };

  const errs = [];
  for (let i = 0; i < 5; i += 1) mw(req, res, (e) => errs.push(e));

  assert.deepEqual(errs.slice(0, 3), [undefined, undefined, undefined], "first 3 pass");
  assert.equal(errs[3]?.status ?? errs[3]?.statusCode, 429);
  assert.equal(errs[4]?.status ?? errs[4]?.statusCode, 429);
});

test("one caller's limit does not consume another's", () => {
  resetRateLimits();
  const mw = rateLimit({ windowMs: 60_000, max: 2 });
  const res = { setHeader() {} };
  const run = (ip) => { let e; mw({ ip, headers: {} }, res, (err) => { e = err; }); return e; };

  run("1.1.1.1"); run("1.1.1.1");
  assert.ok(run("1.1.1.1"), "the first caller is now limited");
  assert.equal(run("2.2.2.2"), undefined, "a different caller is unaffected");
});

test("a custom key scopes the bucket, so one table cannot exhaust another", () => {
  resetRateLimits();
  const mw = rateLimit({
    windowMs: 60_000,
    max: 1,
    keyGenerator: (req) => `qr:${req.params.token}`,
  });
  const res = { setHeader() {} };
  const run = (token) => { let e; mw({ params: { token }, headers: {} }, res, (err) => { e = err; }); return e; };

  run("table-A");
  assert.ok(run("table-A"), "table A is limited");
  assert.equal(run("table-B"), undefined, "table B still has its full allowance");
});

// ---- the routes are actually wired ------------------------------------

test("REGRESSION: every public QR endpoint carries a limiter", () => {
  const src = routeSrc("qrRoute.js");
  const publicRoutes = [...src.matchAll(/router\.route\("(\/[^"]*:token)"\)\.(get|post)\(([^,]+),/g)];

  assert.ok(publicRoutes.length >= 8, `expected the public QR routes, found ${publicRoutes.length}`);
  for (const [, route, , firstArg] of publicRoutes) {
    assert.match(firstArg, /Limiter/, `${route} is public and must be rate limited`);
  }
});

test("REGRESSION: the waiter call is the tightest limit, and keyed per table", () => {
  // It rings until a person walks over and clears it, so the harm is to the
  // staff rather than the caller — an IP-keyed limit would not stop it.
  const src = routeSrc("qrRoute.js");
  const block = src.slice(src.indexOf("qrWaiterLimiter = rateLimit"), src.indexOf("router.route("));
  assert.match(block, /keyGenerator:.*req\.params\.token/, "keyed on the table");
  assert.ok(!/clientIp/.test(block), "must NOT be keyed on IP: switching network would reset it");
});

test("REGRESSION: the payment link verify endpoint is throttled", () => {
  const src = routeSrc("paymentLinkRoute.js");
  const verify = src.slice(src.indexOf('router.route("/:token/verify")'));
  assert.match(verify.split("\n")[0], /Limiter/, "the endpoint that settles a payment must be limited");
});

test("the QR limits are configurable, not hardcoded", () => {
  const cfg = fs.readFileSync(path.join(__dirname, "..", "config", "config.js"), "utf8");
  for (const key of ["qrReadRateMax", "qrOrderRateMax", "qrWaiterCallRateMax"]) {
    assert.match(cfg, new RegExp(key), `${key} should be tunable without a code change`);
  }
});
