const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

/**
 * Website payments open on ONE host (pay.<base>) so Cashfree needs a single
 * whitelist entry instead of one per store.
 */
const ID = "a".repeat(24);
let current = null;

const load = () => {
  const orig = Module._load;
  Module._load = function (r, ...rest) {
    if (r === "../models/websiteCheckoutModel") return { findById: () => ({ lean: async () => current }) };
    return orig.call(this, r, ...rest);
  };
  delete require.cache[require.resolve("../routes/payPageRoute")];
  try {
    return require("../routes/payPageRoute");
  } finally {
    Module._load = orig;
  }
};

const router = load();
const handler = (path) => router.stack.find((l) => l.route?.path === path).route.stack[0].handle;
const call = async (path, id) => {
  const res = { code: 200, headers: {}, body: "", location: "",
    setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; },
    send(b) { this.body = b; return this; }, redirect(c, u) { this.code = c; this.location = u; return this; } };
  await handler(path)({ params: { checkoutId: id } }, res);
  return res;
};

test("an open checkout renders Cashfree checkout on the pay page itself", async () => {
  current = { _id: ID, status: "PENDING", paymentSessionId: "session_abc", mode: "production", amount: 596, returnUrl: "https://231146.knotkitchen.com/menu" };
  const res = await call("/:checkoutId", ID);
  assert.equal(res.code, 200);
  assert.match(res.body, /sdk\.cashfree\.com\/js\/v3\/cashfree\.js/);
  assert.match(res.body, /"paymentSessionId":"session_abc"/);
  assert.match(res.body, /redirectTarget: "_self"/, "checkout must open on this host, not in the store's page");
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("Cashfree's return sends the customer back to their own store to confirm", async () => {
  current = { _id: ID, status: "PENDING", paymentSessionId: "s", returnUrl: "https://231146.knotkitchen.com/menu" };
  const res = await call("/:checkoutId/done", ID);
  assert.equal(res.code, 302);
  assert.equal(res.location, `https://231146.knotkitchen.com/menu?checkout=${ID}`);
});

test("a paid checkout is not offered for payment again", async () => {
  current = { _id: ID, status: "PLACED", paymentSessionId: "s", returnUrl: "https://231146.knotkitchen.com/menu" };
  const res = await call("/:checkoutId", ID);
  assert.equal(res.code, 302);
});

test("unknown or malformed ids are a 404, and nothing from the request is echoed", async () => {
  current = null;
  assert.equal((await call("/:checkoutId", ID)).code, 404);
  const bad = await call("/:checkoutId", "<script>alert(1)</script>");
  assert.equal(bad.code, 404);
  assert.ok(!bad.body.includes("<script>alert"));
});

test("the return address comes from the store's settings, never the request", () => {
  const src = require("node:fs").readFileSync(require.resolve("../controllers/storefrontController"), "utf8");
  assert.match(src, /returnUrl: `\$\{buildStorefrontUrl\(ctx\.settings\)\}\/menu`/);
  assert.match(src, /returnUrl: `\$\{payBase\}\/c\/\$\{checkout\._id\}\/done`/);
});
