const { test } = require("node:test");
const assert = require("node:assert/strict");
const createHttpError = require("http-errors");

/**
 * N1: CSD closing a store closes it at once (locked, reason STORE_CLOSED) and
 * cancels its renewals; reopening a closed store reinstates it and lifts the
 * lock. The subscription service and the lock are stubbed; this checks the
 * wiring, the order (status saved first) and what counts as a failure.
 */

const calls = [];
let fail = null;
require.cache[require.resolve("../services/subscription")] = {
  exports: {
    cancelSubscription: async (args) => {
      calls.push(["cancel", args]);
      if (fail) throw fail;
      return { already: args.restaurantId === "already" };
    },
    reinstateSubscription: async (args) => {
      calls.push(["reinstate", args]);
      if (fail) throw fail;
    },
  },
};
require.cache[require.resolve("../services/accountLock")] = {
  exports: { evaluateLock: async (rid) => calls.push(["lock", String(rid)]) },
};
require.cache[require.resolve("../services/csdAuditService")] = {
  exports: { csdAudit: async (entry) => calls.push(["audit", entry.newValue]) },
};
const Store = require("../models/storeModel");

const { syncSubscriptionWithStatus, updateStoreStatus, ALLOWED_STATUS } = require("../controllers/csdStoreController");

const RID = "64b000000000000000000001";
const req = { csdStaff: { fullName: "Asha Admin" } };
const run = (from, to) =>
  syncSubscriptionWithStatus({ req, store: { restaurantId: RID }, storeId: "123456", from, to });

test("CSD can set a store closed", () => {
  assert.ok(ALLOWED_STATUS.includes("closed"));
});

test("closing cancels at period end, as CSD", async () => {
  calls.length = 0;
  fail = null;
  assert.equal(await run("active", "closed"), "renewals cancelled");
  assert.deepEqual(calls, [
    ["cancel", { restaurantId: RID, reason: "Store closed in CSD", by: { type: "CSD", name: "Asha Admin" } }],
  ]);
});

test("reopening a closed store reinstates; other changes leave billing alone", async () => {
  calls.length = 0;
  fail = null;
  assert.equal(await run("closed", "active"), "reinstated");
  assert.equal(calls[0][0], "reinstate");

  calls.length = 0;
  assert.equal(await run("active", "suspended"), null);
  assert.equal(await run("suspended", "active"), null);
  assert.deepEqual(calls, []);
  // Saving "closed" again retries the (idempotent) cancel, e.g. after a failure.
  assert.equal(await run("closed", "closed"), "renewals cancelled");
  assert.equal(calls[0][0], "cancel");
});

test("already cancelled or never started is tolerated; a real fault is not", async () => {
  fail = null;
  const again = await syncSubscriptionWithStatus({
    req, store: { restaurantId: "already" }, storeId: "123456", from: "active", to: "closed",
  });
  assert.equal(again, "already cancelled");

  fail = createHttpError(409, "Already cancelled.");
  assert.match(await run("active", "closed"), /^unchanged: Already cancelled/);

  fail = createHttpError(404, "No subscription.");
  assert.match(await run("active", "closed"), /^unchanged/);

  fail = new Error("connection lost");
  await assert.rejects(() => run("active", "closed"), /connection lost/);
  fail = null;
});

test("the Store model accepts \"closed\" (BLOCKER: it used to fail validation)", () => {
  const doc = new Store({ storeId: "123456", storeName: "S", ownerName: "O", ownerPhone: "9876543210", status: "closed" });
  assert.equal(doc.validateSync(), undefined);
  doc.status = "closed_forever";
  assert.ok(doc.validateSync()?.errors?.status, "an unknown status is still refused");
});

/** updateStoreStatus against a real (validated) Store document, not saved to a database. */
const updateStatus = async (doc, body) => {
  const originalFindOne = Store.findOne;
  Store.findOne = async () => doc;
  const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  let error = null;
  try {
    await updateStoreStatus({ params: { storeId: "123456" }, body, csdStaff: { fullName: "Asha Admin" } }, res, (e) => (error = e));
  } finally {
    Store.findOne = originalFindOne;
  }
  return { res, error };
};

const storeDoc = (status) => {
  const doc = new Store({ storeId: "123456", storeName: "S", ownerName: "O", ownerPhone: "9876543210", status, restaurantId: RID });
  doc.save = async function save() {
    await this.validate();
    calls.push(["save", this.status]);
    return this;
  };
  return doc;
};

test("CSD close: status saved first, then renewals cancelled and the store locked at once; reopen reverses it", async () => {
  fail = null;
  calls.length = 0;
  const doc = storeDoc("active");
  const closed = await updateStatus(doc, { status: "closed", reason: "Owner left" });
  assert.equal(closed.error, null);
  assert.equal(closed.res.code, 200);
  assert.equal(doc.status, "closed");
  assert.deepEqual(calls.map((c) => c[0]), ["save", "cancel", "lock", "audit"]);
  assert.equal(calls[3][1].subscription, "renewals cancelled");

  calls.length = 0;
  const reopened = await updateStatus(doc, { status: "active" });
  assert.equal(reopened.res.code, 200);
  assert.equal(doc.status, "active");
  assert.deepEqual(calls.map((c) => c[0]), ["save", "reinstate", "lock", "audit"]);
});

test("CSD close: a subscription fault after the save still locks, is audited, and says how to retry", async () => {
  calls.length = 0;
  fail = new Error("connection lost");
  const doc = storeDoc("active");
  const { res, error } = await updateStatus(doc, { status: "closed" });
  fail = null;
  assert.equal(res.code, 0, "no success reply");
  assert.equal(error.status, 502);
  assert.match(error.message, /now closed.*connection lost.*again to retry/);
  assert.equal(doc.status, "closed", "the status change is not half-applied");
  assert.deepEqual(calls.map((c) => c[0]), ["save", "cancel", "lock", "audit"]);
});

test("other status changes leave billing and the lock alone", async () => {
  calls.length = 0;
  const { res } = await updateStatus(storeDoc("active"), { status: "suspended" });
  assert.equal(res.code, 200);
  assert.deepEqual(calls.map((c) => c[0]), ["save", "audit"]);
});
