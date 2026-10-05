const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The audit write is not under test; keep it off the database.
const audit = require("../services/auditService");
audit.logActivity = async () => null;

const CsdJob = require("../models/csdJobModel");
const Store = require("../models/storeModel");
const { createSupportRequest } = require("../controllers/supportController");

const USER = { _id: "u1", name: "Asmit", role: "Owner", phone: "9876543210", storeId: "231146" };

const call = async (body, { open = null } = {}) => {
  const created = [];
  const saved = { findOne: CsdJob.findOne, create: CsdJob.create, next: CsdJob.nextJobId, store: Store.findOne };
  CsdJob.findOne = () => ({ select: () => ({ lean: async () => open }) });
  CsdJob.nextJobId = async () => "KK-JOB-0042";
  CsdJob.create = async (doc) => (created.push(doc), { ...doc, _id: "j1" });
  Store.findOne = () => ({ select: () => ({ lean: async () => ({ storeName: "Demo Store 1" }) }) });
  try {
    let status = 0;
    let payload = null;
    let error = null;
    const res = { status: (s) => ((status = s), res), json: (p) => (payload = p) };
    await createSupportRequest({ body, user: USER }, res, (e) => (error = e));
    return { status, payload, error, created };
  } finally {
    Object.assign(CsdJob, { findOne: saved.findOne, create: saved.create, nextJobId: saved.next });
    Store.findOne = saved.store;
  }
};

test("each Help & Support card becomes an open job in the CSD queue, tagged to the store", async () => {
  const out = await call({ type: "printer", details: "Bluetooth printer not printing" });
  assert.equal(out.status, 201);
  assert.deepEqual(out.payload.data, { jobId: "KK-JOB-0042", existing: false });
  const job = out.created[0];
  assert.equal(job.title, "Printer not working");
  assert.equal(job.priority, "high");
  assert.equal(job.source, "store");
  assert.equal(job.status, "open");
  assert.equal(job.storeId, "231146");
  assert.equal(job.restaurantName, "Demo Store 1");
  assert.match(job.createdByName, /Asmit \(Owner\)/);
  assert.match(job.description, /Raised from the POS by Asmit, Owner, phone 9876543210\./);
  assert.match(job.description, /Bluetooth printer not printing/);
  for (const [type, title] of [["website", "Website not working"], ["menu", "Menu change request"], ["other", "Other technical issue"]]) {
    assert.equal((await call({ type })).created[0].title, title);
  }
});

test("a call back needs a 10-digit number and carries it to the job", async () => {
  assert.equal((await call({ type: "callback", phone: "123" })).error.status, 400);
  const out = await call({ type: "callback", phone: "98765 43210", preferredTime: "In 15 minutes" });
  assert.match(out.created[0].description, /Call back on 9876543210 \(In 15 minutes\)\./);
});

test("the same request again while it is open returns that job instead of a duplicate", async () => {
  const out = await call({ type: "printer" }, { open: { jobId: "KK-JOB-0041" } });
  assert.equal(out.status, 200);
  assert.deepEqual(out.payload.data, { jobId: "KK-JOB-0041", existing: true });
  assert.equal(out.created.length, 0);
});

test("an unknown request type is refused", async () => {
  assert.equal((await call({ type: "refund-me" })).error.status, 400);
});

test("a store-raised job needs no CSD creator; a CSD job still does", () => {
  const store = new CsdJob({ jobId: "KK-JOB-0001", title: "Printer not working", source: "store", createdByName: "Asmit" });
  assert.equal(store.validateSync(), undefined);
  const csd = new CsdJob({ jobId: "KK-JOB-0002", title: "Call the owner" });
  assert.ok(csd.validateSync()?.errors?.createdById, "CSD jobs still record who made them");
});

test("the route is signed-in, rate limited, and open even when the account is locked", () => {
  const route = fs.readFileSync(path.join(__dirname, "..", "routes", "supportRoute.js"), "utf8");
  assert.match(route, /router\.post\("\/requests", isVerifiedUser, requestLimiter, createSupportRequest\);/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8"), /app\.use\("\/api\/support", require\("\.\/routes\/supportRoute"\)\);/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "middlewares", "accountLock.js"), "utf8"), /"\/api\/support",/);
  const pos = fs.readFileSync(path.join(__dirname, "..", "..", "pos-frontend", "src", "pages", "Support.jsx"), "utf8");
  assert.match(pos, /await send\(\{ type: selectedIssue\.id, details: issueDetails \}\)/);
  assert.match(pos, /await send\(\{ type: "callback", phone: phoneInput, preferredTime, details: notesInput \}\)/);
});
