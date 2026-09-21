/**
 * REGRESSION (2026-09-22): "alerts stop after the system is idle" and "Call
 * Waiter stops working after a few calls".
 *
 * 1. The POS socket signs in with the 15-minute access token. A quiet till
 *    never renews it, so when a dropped connection came back the handshake
 *    was refused, and socket.io does not retry a refusal: the till went deaf.
 *    The handshake now trusts the LOGIN SESSION the token names instead.
 * 2. The waiter-call limit counted every call for five minutes, including
 *    ones staff had already answered. Answering a call now resets it.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const jwt = require("jsonwebtoken");
const config = require("../config/config");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

/** Load services/socket with a fake User model holding one user. */
const loadSocketWith = (user) => {
  const orig = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "../models/userModel") return { findById: async (id) => (String(id) === String(user._id) ? user : null) };
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve("../services/socket")];
  try {
    return require("../services/socket");
  } finally {
    Module._load = orig;
  }
};

const handshake = (token, storeId = "231146") => ({
  handshake: { headers: { cookie: `accessToken_${storeId}=${token}` }, query: { storeId } },
});
const run = (auth, socket) => new Promise((resolve) => auth(socket, (err) => resolve(err || null)));
const sign = (claims, expiresIn) => jwt.sign(claims, config.accessTokenSecret, { algorithm: "HS256", expiresIn });

const baseUser = (sessions) => ({
  _id: "64b000000000000000000001",
  isActive: true,
  isDeleted: false,
  restaurantId: "64b0000000000000000000aa",
  storeId: "231146",
  sessions,
});
const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 1000);

test("a till whose short token has lapsed is let back in while its login session is alive", async () => {
  const user = baseUser([{ _id: "sess1", isRevoked: false, expiresAt: future }]);
  const { authenticateSocket } = loadSocketWith(user);
  const expired = sign({ _id: user._id, jti: "sess1" }, -60);
  const socket = handshake(expired);
  assert.equal(await run(authenticateSocket, socket), null, "this is the reconnect that used to be refused");
  assert.equal(socket.tenant.storeId, "231146");
});

test("a revoked, expired or unknown session is refused, fresh token or not", async () => {
  for (const sessions of [
    [{ _id: "sess1", isRevoked: true, expiresAt: future }],
    [{ _id: "sess1", isRevoked: false, expiresAt: past }],
    [],
  ]) {
    const user = baseUser(sessions);
    const { authenticateSocket } = loadSocketWith(user);
    for (const ttl of [-60, 600]) {
      const err = await run(authenticateSocket, handshake(sign({ _id: user._id, jti: "sess1" }, ttl)));
      assert.ok(err, "signing out or revoking a session shuts its socket out too");
    }
  }
});

test("an expired token that names no session is refused; a forged one always is", async () => {
  const user = baseUser([{ _id: "sess1", isRevoked: false, expiresAt: future }]);
  const { authenticateSocket } = loadSocketWith(user);
  assert.ok(await run(authenticateSocket, handshake(sign({ _id: user._id }, -60))));
  const forged = jwt.sign({ _id: user._id, jti: "sess1" }, "not-the-secret", { expiresIn: 600 });
  assert.ok(await run(authenticateSocket, handshake(forged)));
  // A store the user does not belong to is still refused.
  assert.ok(await run(authenticateSocket, handshake(sign({ _id: user._id, jti: "sess1" }, 600), "999999")));
});

test("SOURCE: the access cookie outlives the token inside it, so the handshake has something to show", () => {
  const src = read("controllers", "userController.js");
  assert.ok(!/maxAge: 1000 \* 60 \* 15/.test(src), "a 15-minute cookie is gone before the socket needs it");
  assert.ok((src.match(/accessCookieName\([\s\S]{0,420}?maxAge: SESSION_LIFETIME_MS/g) || []).length >= 2);
  // REST is no laxer: it still verifies the expiry.
  assert.ok(!/ignoreExpiration/.test(read("middlewares", "tokenVerification.js")));
});

test("the waiter-call allowance comes back when staff answer the call", () => {
  const { rateLimit, resetRateLimit, resetRateLimits } = require("../middlewares/rateLimiter");
  resetRateLimits();
  const limiter = rateLimit({ windowMs: 300_000, max: 5, keyGenerator: (req) => `qr-waiter:${req.scope.table._id}` });
  const call = () => {
    let error = null;
    limiter({ scope: { table: { _id: "t1" } }, headers: {} }, { setHeader() {} }, (e) => { error = e || null; });
    return error;
  };
  for (let i = 0; i < 5; i++) assert.equal(call(), null);
  assert.equal(call()?.status, 429, "an unanswered call cannot be rung for ever");
  resetRateLimit("qr-waiter:t1");
  assert.equal(call(), null, "answered, so the table may call again");
});

test("SOURCE: the limit is per table and is reset by the acknowledge route", () => {
  const routes = read("routes", "qrRoute.js");
  assert.match(routes, /"\/waiter-call\/:token"\)\.post\(qrWriteLimiter, resolveTableScope, qrWaiterLimiter, qr\.callWaiter\)/);
  assert.match(routes, /qr-waiter:\$\{req\.scope\?\.table\?\._id/);
  const ctrl = read("controllers", "qrController.js");
  const dismiss = ctrl.slice(ctrl.indexOf("const dismissWaiterCall"), ctrl.indexOf("module.exports"));
  assert.match(dismiss, /resetRateLimit\(`qr-waiter:\$\{table\._id\}`\)/);
});

test("SOURCE: a table opened at the till can still be paid from the QR: the diner is asked for a phone", () => {
  // The gateway refuses an order without a 10-digit phone. A POS-opened table
  // has none, the call failed quietly, and the page said "Ask for the bill".
  const ctrl = read("controllers", "qrController.js");
  const intent = ctrl.slice(ctrl.indexOf("const paymentIntent"), ctrl.indexOf("const paymentVerify"));
  assert.match(intent, /tenDigits\(req\.body\?\.phone\)\.length === 10/);
  assert.match(intent, /session\.customerPhone = tenDigits\(req\.body\.phone\)/);
  assert.match(intent, /gw\.enabled && payable > 0 && hasPhone/, "no doomed gateway call without a phone");
  assert.match(intent, /needsPhone: Boolean\(gw\.enabled && payable > 0 && !hasPhone\)/);
  // The amount still comes from the session's own bill, never the request.
  assert.ok(!/req\.body\?\.amount|req\.body\.amount/.test(intent));
});
