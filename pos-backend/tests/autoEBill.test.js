const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("module");

/**
 * Automatic e-bills.
 *
 * Two things have to hold, and neither shows up as an error when broken:
 *
 *   1. The toggle must actually gate it. `posSettings.autoEBill` sat in the
 *      database for a long time read by nothing -- the operator switched it on
 *      and no e-bill was ever sent.
 *
 *   2. It must send exactly once. A settle gets retried in normal operation --
 *      a gateway webhook redelivery, a double-tap on Mark Paid -- and the
 *      customer must not be messaged twice for one bill.
 *
 * The service is exercised through its real seams (the Mongoose models and the
 * messaging service, replaced at require time) rather than by reassigning its
 * exports, which would not change the references the module closed over.
 */

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

const OK = { success: true, sent: true, deliveryStatus: "DELIVERED", route: "whatsapp" };
const FAILED = {
  success: false,
  sent: false,
  deliveryStatus: "FAILED",
  error: "Insufficient balance",
};

/**
 * Build eBillService with fake models.
 *
 * `claims` doubles as the persisted `eBillSentAt` column: the fake
 * findOneAndUpdate only succeeds while the id is unclaimed, exactly like the
 * conditional update the real one issues.
 */
const build = ({
  order = null,
  tableSession = null,
  restaurant = { posSettings: { autoEBill: true } },
  sendResult = OK,
  restaurantThrows = false,
  receiptPhone = "9477623682",
} = {}) => {
  const sent = [];
  const claims = {};

  const claimable = () => ({
    findOneAndUpdate: async (filter) => {
      const id = String(filter._id);
      if (claims[id]) return null;
      claims[id] = true;
      return { _id: filter._id };
    },
    updateOne: async (filter) => {
      claims[String(filter._id)] = false;
      return { acknowledged: true };
    },
  });

  const stubs = {
    "../models/orderModel": {
      ...claimable(),
      findOne: async () => order,
    },
    "../models/tableSessionModel": {
      ...claimable(),
      // The real call chains .populate("tableId") before awaiting.
      findOne: () => ({ populate: async () => tableSession }),
    },
    "../models/billModel": {
      findOne: async () => null,
      findById: async () => null,
    },
    "../models/restaurantModel": {
      findById: async () => {
        if (restaurantThrows) throw new Error("database is on fire");
        return restaurant;
      },
    },
    "./receiptService": {
      buildReceipt: () => ({
        restaurant: { name: "Spice Garden" },
        orderNumber: "A-1042",
        total: 525,
        quantities: 2,
        customerInformation: { name: "Asmit", phone: receiptPhone },
        items: [],
      }),
    },
    "./messagingService": {
      sendEBillMessage: async (payload) => {
        sent.push(payload);
        return sendResult;
      },
    },
    "./receiptLink": {
      urlForOrder: (id) => `https://api.knotkitchen.com/r/o_${id}_sig`,
      urlForSession: (id) => `https://api.knotkitchen.com/r/s_${id}_sig`,
    },
  };

  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.apply(this, [request, parent, isMain]);
  };
  delete require.cache[require.resolve("../services/eBillService")];
  const service = require("../services/eBillService");
  Module._load = originalLoad;

  return { service, sent, claims };
};

const ORDER = { _id: "order1", restaurantId: "rest1" };
const SESSION = { _id: "sess1", restaurantId: "rest1" };

// ---------------------------------------------------------------------------
// The toggle
// ---------------------------------------------------------------------------

test("autoEBillEnabled reads posSettings.autoEBill and nothing else", () => {
  const { service } = build();
  assert.equal(service.autoEBillEnabled({ posSettings: { autoEBill: true } }), true);
  assert.equal(service.autoEBillEnabled({ posSettings: { autoEBill: false } }), false);
  assert.equal(service.autoEBillEnabled({ posSettings: {} }), false);
  assert.equal(service.autoEBillEnabled({}), false, "no settings means off");
  assert.equal(service.autoEBillEnabled(null), false, "a missing restaurant means off");
});

test("REGRESSION: the Settings toggle is wired to something", () => {
  // It saved to the database and was read by no code at all: switching it on
  // did nothing, silently, forever.
  assert.match(SRC("services/eBillService.js"), /posSettings\.autoEBill/);

  // And the settle paths have to actually call it.
  assert.match(SRC("controllers/tableSessionController.js"), /fireAutoEBill\(\{ tableSessionId/);
  assert.match(SRC("controllers/orderController.js"), /fireAutoEBill\(\{ orderId/);
  assert.match(SRC("services/autoReadyService.js"), /fireAutoEBill\(\{ orderId/);
});

test("nothing is sent, and nothing is claimed, when the toggle is off", async () => {
  const { service, sent, claims } = build({
    order: ORDER,
    restaurant: { posSettings: { autoEBill: false } },
  });

  const res = await service.maybeSendAutoEBill({ orderId: "order1" });
  assert.equal(res.sent, false);
  assert.match(res.reason, /off/);
  assert.equal(sent.length, 0);
  assert.equal(claims.order1, undefined, "an untried send must not be marked as done");
});

// ---------------------------------------------------------------------------
// Sending once, and only once
// ---------------------------------------------------------------------------

test("a settled bill sends exactly one e-bill, however many times it settles", async () => {
  const { service, sent } = build({ order: ORDER });

  const first = await service.maybeSendAutoEBill({ orderId: "order1" });
  const second = await service.maybeSendAutoEBill({ orderId: "order1" });
  const third = await service.maybeSendAutoEBill({ orderId: "order1" });

  assert.equal(first.sent, true);
  assert.equal(second.sent, false);
  assert.equal(second.reason, "already sent");
  assert.equal(third.sent, false);
  assert.equal(sent.length, 1, "a webhook redelivery must not message the customer again");
});

test("a failed send releases the claim so it stays retryable", async () => {
  const { service, sent, claims } = build({ order: ORDER, sendResult: FAILED });

  const attempt = await service.maybeSendAutoEBill({ orderId: "order1" });
  assert.equal(attempt.sent, false);
  assert.match(attempt.reason, /Insufficient balance/);
  assert.equal(
    claims.order1,
    false,
    "marking a failed send as done would silently lose the customer's bill",
  );

  const retry = await service.maybeSendAutoEBill({ orderId: "order1" });
  assert.notEqual(retry.reason, "already sent");
  assert.equal(sent.length, 2, "the retry actually tried again");
});

test("auto-send never throws, whatever goes wrong underneath", async () => {
  const { service } = build({ order: ORDER, restaurantThrows: true });

  // The money has already moved by the time this runs. It must not be able to
  // turn a successful payment into an error for the operator.
  const res = await service.maybeSendAutoEBill({ orderId: "order1" });
  assert.equal(res.sent, false);
  assert.match(res.reason, /on fire/);

  assert.doesNotThrow(() => service.fireAutoEBill({ orderId: "order1" }));
});

test("a missing subject and a missing document are both handled", async () => {
  const { service, sent } = build({ order: null });
  assert.equal((await service.maybeSendAutoEBill({})).sent, false);
  assert.equal((await service.maybeSendAutoEBill({ orderId: "ghost" })).reason, "not found");
  assert.equal(sent.length, 0);
});

test("a bill with no phone number is skipped, and nothing is claimed", async () => {
  const { service, sent, claims } = build({ order: ORDER, receiptPhone: "" });

  const res = await service.maybeSendAutoEBill({ orderId: "order1" });
  assert.equal(res.sent, false);
  assert.match(res.reason, /phone/i);
  assert.equal(sent.length, 0, "nothing can be sent with no destination");
  assert.equal(
    claims.order1,
    false,
    "a walk-in that later gets a phone must still be sendable",
  );
});

// ---------------------------------------------------------------------------
// Shape of what gets sent
// ---------------------------------------------------------------------------

test("the total is sent as a bare two-decimal amount", async () => {
  const { service, sent } = build({ order: ORDER });
  await service.maybeSendAutoEBill({ orderId: "order1" });
  // The template renders "Total: Rs {{2}}" -- a symbol here would read "Rs Rs525".
  assert.equal(sent[0].total, "525.00");
  assert.match(sent[0].receiptUrl, /^https:\/\/api\.knotkitchen.com\/r\//);
});

test("a table session is linked as a session, not as an order", async () => {
  const { service, sent } = build({ tableSession: SESSION });
  await service.maybeSendAutoEBill({ tableSessionId: "sess1" });
  assert.match(sent[0].receiptUrl, /\/r\/s_sess1_/, "an order-shaped token would 404");
});

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

test("the manual button and the automatic send share one implementation", () => {
  // Two copies would drift, and both would keep answering 200 while one of
  // them sent the wrong thing.
  const controller = SRC("controllers/receiptController.js");
  assert.match(controller, /deliverEBill/, "the controller must go through the service");
  assert.ok(
    !/sendEBillMessage\s*\(/.test(controller),
    "the controller must not send messages itself any more",
  );
});

test("REGRESSION: a counter order paid at the till fires the e-bill too", () => {
  // It is created ALREADY "Completed", so it never passes through
  // updateOrderStatus. Hooking only the status change silently missed the most
  // common order in the system -- someone paying at the counter.
  const src = SRC("controllers/orderController.js");

  assert.match(
    src,
    /const initialStatus = isPaidAtTill \? "Completed"/,
    "anchor moved; retarget this guard",
  );
  assert.match(
    src,
    /if \(isPaidAtTill\) fireAutoEBill\(\{ orderId: order\._id \}\);/,
    "a till-paid order must send its e-bill at creation",
  );

  // ...and the two hooks are distinct: creation, and the later status change.
  assert.equal(
    (src.match(/fireAutoEBill\(/g) || []).length,
    2,
    "both the creation and the completion paths must fire",
  );
});

test("EVERY way a bill gets settled fires the e-bill", () => {
  // The point of the feature is that a customer always gets their bill. A new
  // settle path that forgets to fire is invisible: the money still moves, the
  // order still closes, and only the customer notices nothing arrived.
  //
  // Each entry is one way an order or table session reaches a settled state.
  const paths = [
    // Counter order paid at the till. Created ALREADY "Completed", so it never
    // reaches updateOrderStatus -- the most common order in the system.
    ["controllers/orderController.js", /if \(isPaidAtTill\) fireAutoEBill\(/],
    // Counter order completed later by a person.
    ["controllers/orderController.js", /if \(settledTransition\) fireAutoEBill\(/],
    // Finished by the auto-complete timer instead of a person.
    ["services/autoReadyService.js", /fireAutoEBill\(\{ orderId: order\._id \}\)/],
    // Table session settled at the POS -- and, through settleSessionFromGateway,
    // every QR and online table payment too.
    ["controllers/tableSessionController.js", /if \(paid\) fireAutoEBill\(\{ tableSessionId/],
    // Pay-by-link. Writes Completed straight onto the order, so it is settled
    // here and nowhere else.
    ["services/paymentLinkSettlement.js", /if \(updatedOrder\) fireAutoEBill\(/],
  ];

  for (const [file, pattern] of paths) {
    assert.match(SRC(file), pattern, `${file}: a settle path does not send the e-bill`);
  }
});

test("the auto-send fires only AFTER the payment transaction commits", () => {
  // Inside the transaction it would hold a Mongo transaction open across an
  // outbound HTTP call to Fast2SMS.
  const src = SRC("controllers/tableSessionController.js");
  const commit = src.indexOf("commitTransaction()");
  const fire = src.indexOf("fireAutoEBill(");
  assert.ok(commit !== -1 && fire !== -1, "anchors moved; retarget this guard");
  assert.ok(fire > commit, "the e-bill must not be sent from inside the payment transaction");
});

test("eBillSentAt exists on both schemas", () => {
  // The recurring fault in this codebase: a field written by code and absent
  // from the schema is dropped silently, so the idempotency lock would never
  // persist and every retry would send again.
  const Order = require("../models/orderModel");
  const TableSession = require("../models/tableSessionModel");
  assert.ok(Order.schema.path("eBillSentAt"), "Order.eBillSentAt missing from the schema");
  assert.ok(
    TableSession.schema.path("eBillSentAt"),
    "TableSession.eBillSentAt missing from the schema",
  );
});

// ---------------------------------------------------------------------------
// The table-order trigger in the POS
// ---------------------------------------------------------------------------

test("SOURCE: settling a table can send its e-bill", () => {
  const modal = SRC("../pos-frontend/src/components/tables/TableSettleModal.jsx");
  assert.match(modal, /customerPhone/, "the modal needs somewhere to send it");
  assert.match(modal, /sendEBill: Boolean\(phone && alsoEBill\)/);

  // Both screens that settle a table must offer it, or it depends on which
  // one the operator happened to use.
  for (const page of ["../pos-frontend/src/pages/Orders.jsx", "../pos-frontend/src/pages/Tables.jsx"]) {
    const src = SRC(page);
    assert.match(src, /sendTableEBill/, `${page} does not send the e-bill`);
    assert.match(src, /onSuccess: \(res, vars\)/, `${page} ignores what was asked for`);
  }
});
