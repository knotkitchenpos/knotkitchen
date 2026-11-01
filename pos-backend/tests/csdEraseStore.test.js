const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Delete permanently: a deleted store's record erased from the support desk
 * (owner, 2026-10-31). Its agreement and invoices stay; its Store ID is never
 * issued again while they carry it.
 */

const load = (store, calls) => {
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r) {
    if (r === "../models/storeModel") {
      return {
        findOne: async () => store,
        deleteOne: async (q) => calls.push(["Store.deleteOne", q]),
      };
    }
    if (r === "../models/restaurantModel") {
      return {
        findOne: () => ({ select: async () => null }),
        deleteOne: async () => {},
        deleteMany: async () => {},
      };
    }
    if (r === "../models/csdAgreementLinkModel") return { findOne: () => ({ lean: async () => ({ agreementId: "AG-1" }) }) };
    if (r === "../services/storePurge") {
      return { purgeStoreData: async (q) => (calls.push(["purge", q]), { deleted: {}, skipped: [] }) };
    }
    if (r === "../services/csdAuditService") return { csdAudit: async (a) => calls.push(["audit", a.action]) };
    return orig.apply(this, arguments);
  };
  const file = require.resolve("../controllers/csdStoreController");
  delete require.cache[file];
  try {
    return require(file);
  } finally {
    Module._load = orig;
  }
};

const call = async (fn, storeId, confirmStoreId) => {
  let status;
  let error;
  await fn(
    { params: { storeId }, body: { confirmStoreId }, csdStaff: { role: "admin" } },
    { status: (s) => ((status = s), { json: () => {} }) },
    (e) => (error = e),
  );
  return { status, error };
};

const deletedStore = () => ({
  _id: "s1", storeId: "255132", storeName: "Demo", ownerName: "O", ownerPhone: "1234567890",
  status: "deleted", isDeleted: true, restaurantId: null, async save() {},
});

test("a deleted store's record is swept once more, then erased and audited", async () => {
  const calls = [];
  const { eraseStoreRecord } = load(deletedStore(), calls);
  const res = await call(eraseStoreRecord, "255132", "255132");
  assert.equal(res.status, 200);
  assert.deepEqual(calls.map((c) => c[0]), ["purge", "audit", "Store.deleteOne", "audit"]);
  assert.deepEqual(calls[2][1], { _id: "s1" });
  assert.equal(calls[3][1], "CSD_STORE_RECORD_ERASED");
});

test("refused without the typed Store ID, or for a store that is not deleted", async () => {
  const calls = [];
  const { eraseStoreRecord } = load(deletedStore(), calls);
  assert.equal((await call(eraseStoreRecord, "255132", "255133")).error.status, 400);
  const live = load({ ...deletedStore(), status: "active", isDeleted: false }, calls).eraseStoreRecord;
  assert.equal((await call(live, "255132", "255132")).error.status, 409);
  assert.equal(calls.length, 0, "nothing touched");
});

test("only an admin can, and an erased store's ID is never issued again", () => {
  const route = fs.readFileSync(path.join(__dirname, "../routes/csdRoute.js"), "utf8");
  assert.match(route, /router\.delete\("\/stores\/:storeId", requireCsdAdmin, eraseStoreRecord\);/);
  const gen = fs.readFileSync(path.join(__dirname, "../services/storeIdGenerator.js"), "utf8");
  assert.match(gen, /\(await Store\.exists\(\{ storeId \}\)\) \|\|\s*\(await PlatformInvoice\.exists\(\{ storeId \}\)\) \|\|\s*\(await CsdAgreementLink\.exists\(\{ storeId \}\)\)/);
  assert.match(gen, /if \(!\(await storeIdTaken\(storeId\)\)\) return storeId;/);
});
