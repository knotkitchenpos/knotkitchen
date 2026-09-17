const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { findOrCreate, isDuplicateKey } = require("../services/idempotency");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const e11000 = () => Object.assign(new Error("E11000 duplicate key"), { code: 11000 });

test("an existing document is returned without creating", async () => {
  let created = 0;
  const out = await findOrCreate({ find: async () => ({ _id: "a" }), create: async () => { created += 1; } });
  assert.deepEqual(out, { doc: { _id: "a" }, duplicate: true });
  assert.equal(created, 0);
});

test("a miss creates", async () => {
  const out = await findOrCreate({ find: async () => null, create: async () => ({ _id: "new" }) });
  assert.deepEqual(out, { doc: { _id: "new" }, duplicate: false });
});

test("a lost race re-reads and returns the winner", async () => {
  let reads = 0;
  const out = await findOrCreate({
    find: async () => (reads++ === 0 ? null : { _id: "winner" }),
    create: async () => { throw e11000(); },
  });
  assert.deepEqual(out, { doc: { _id: "winner" }, duplicate: true });
});

test("a duplicate-key error with nothing to re-read is still an error", async () => {
  await assert.rejects(
    findOrCreate({ find: async () => null, create: async () => { throw e11000(); } }),
    (err) => isDuplicateKey(err),
  );
});

test("any other error passes through untouched", async () => {
  const boom = new Error("boom");
  await assert.rejects(
    findOrCreate({ find: async () => null, create: async () => { throw boom; } }),
    (err) => err === boom,
  );
});

test("SOURCE: every keyed once-only path goes through findOrCreate", () => {
  for (const [file, count] of [
    [["services", "ledger.js"], 1],
    [["controllers", "storefrontController.js"], 3],
    [["routes", "offlineRoute.js"], 1],
    [["controllers", "qrController.js"], 2],
  ]) {
    const src = read(...file);
    assert.equal((src.match(/findOrCreate\(\{/g) || []).length, count, file.join("/"));
    assert.ok(!/code === 11000/.test(src), `${file.join("/")} hand-rolls the duplicate check`);
  }
  // The payment-link capture creates inside a transaction, so it catches the
  // race at the transaction boundary instead.
  assert.match(read("controllers", "paymentLinkController.js"), /isDuplicateKey\(error\) && link && effectiveIdempotencyKey/);
});

test("REGRESSION: the offline key is on the order from birth, not stamped afterwards", () => {
  const route = read("routes", "offlineRoute.js");
  assert.match(route, /fakeReq\.idempotencyKey = idempotencyKey/);
  assert.ok(!/\$set: \{ idempotencyKey: key/.test(route), "a crash between create and stamp left an unkeyed order");
  assert.match(read("controllers", "orderController.js"), /req\.idempotencyKey \? \{ idempotencyKey: req\.idempotencyKey \}/);
});

test("REGRESSION: a table payment on a standalone mongod no longer calls into a null session", () => {
  const ctrl = read("controllers", "tableSessionController.js");
  const fn = ctrl.slice(ctrl.indexOf("const recordSessionPayment"), ctrl.indexOf("// Move a party to another table"));
  assert.ok(!/useTxn/.test(fn), "the flag was written and never read");
  assert.ok(!/mongoSession\.(commit|abort)Transaction/.test(fn), "guard the fallback where mongoSession is null");
  assert.match(fn, /mongoSession\?\.commitTransaction\(\)/);
});

test("REGRESSION: the table-session payment key is unique per restaurant, not globally", () => {
  const model = read("models", "tableSessionModel.js");
  assert.match(model, /\{ restaurantId: 1, "paymentHistory\.idempotencyKey": 1 \}/);
  assert.ok(!/\{ "paymentHistory\.idempotencyKey": 1 \}/.test(model), "the global index spec must not come back");
  assert.ok(fs.existsSync(path.join(__dirname, "..", "migrations", "010-tenant-scope-payment-idempotency-index.js")), "and the old index is dropped by a migration");
});
