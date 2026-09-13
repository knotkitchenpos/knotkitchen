const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

/**
 * A collection order for a later pickup is accepted into the queue but not
 * started: cooking begins Auto Ready minutes before the pickup time.
 */
const loadService = (autoReadyMinutes) => {
  const orig = Module._load;
  Module._load = function (r, ...rest) {
    if (r === "../models/websiteSettingsModel") {
      return {
        findOne: () => ({
          select: async () => ({ ordering: { autoReadyMinutes: { collection: autoReadyMinutes }, autoCompleteMinutes: { collection: 0 } } }),
        }),
      };
    }
    return orig.call(this, r, ...rest);
  };
  delete require.cache[require.resolve("../services/autoReadyService")];
  try {
    return require("../services/autoReadyService");
  } finally {
    Module._load = orig;
  }
};

const at = (hhmm) => new Date(`2026-09-14T${hhmm}:00.000Z`);
const order = (scheduledFor) => ({ restaurantId: "r1", storeId: "s1", orderType: "takeaway", scheduledFor });

test("REGRESSION: pickup 7:00 PM with 20 min Auto Ready starts preparing at 6:40 PM", async () => {
  const { clocksOnAccept } = loadService(20);
  const clocks = await clocksOnAccept(order(at("19:00")), at("17:00"));
  assert.equal(clocks.prepStartAt.toISOString(), at("18:40").toISOString());
  assert.equal(clocks.readyDueAt.toISOString(), at("19:00").toISOString(), "ready AT the pickup time");
});

test("an order for now starts at acceptance", async () => {
  const { clocksOnAccept } = loadService(20);
  const clocks = await clocksOnAccept(order(null), at("17:00"));
  assert.equal(clocks.prepStartAt, null);
  assert.equal(clocks.readyDueAt.toISOString(), at("17:20").toISOString());
});

test("a pickup too close to queue starts now", async () => {
  const { clocksOnAccept } = loadService(20);
  const clocks = await clocksOnAccept(order(at("17:10")), at("17:00"));
  assert.equal(clocks.prepStartAt, null);
  assert.equal(clocks.readyDueAt.toISOString(), at("17:20").toISOString());
});

test("the prep alert fires once and only for accepted, unstarted orders", () => {
  const src = require("node:fs").readFileSync(require.resolve("../services/autoReadyService"), "utf8");
  const tick = src.slice(src.indexOf("const runPrepStartTick"), src.indexOf("const prepDuePayload"));
  assert.match(tick, /prepAlertedAt: null,\s+prepStartedAt: null/);
  assert.match(tick, /Order\.updateOne\(\{ _id: order\._id, prepAlertedAt: null \}/, "claimed, so two ticks cannot alert twice");
  assert.match(tick, /"order:prepDue"/);
});

test("a website order is only placed after the gateway says it was paid", () => {
  const fs = require("node:fs");
  const route = fs.readFileSync(require.resolve("../routes/storefrontRoute"), "utf8");
  assert.ok(!/router\.post\("\/:slug\/orders"/.test(route), "no route may place an unpaid website order");
  assert.match(route, /router\.post\("\/:slug\/checkout", orderLimiter, startStorefrontCheckout\)/);
  const ctrl = fs.readFileSync(require.resolve("../controllers/storefrontController"), "utf8");
  const verify = ctrl.slice(ctrl.indexOf("const verifyStorefrontCheckout"), ctrl.indexOf("/** Customer-facing projection"));
  assert.ok(verify.indexOf("isOrderPaid") < verify.indexOf("new Order("), "payment is checked before the order exists");
  assert.match(verify, /if \(!result\.paid\)/);
  const open = ctrl.slice(ctrl.indexOf("const openCheckout"), ctrl.indexOf("const startStorefrontCheckout"));
  assert.ok(!/order\.save\(/.test(open), "opening a payment must not save an order");
});
