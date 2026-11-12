/**
 * services/projectedMenuCache: the customer-facing menu is rebuilt only when a
 * menu changed, and an edit shows on the very next request.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

let rows = [];
const calls = { full: 0, marks: 0 };
const query = (result, kind) => {
  const q = {
    sort: () => q,
    lean: () => q,
    then: (ok, bad) => { calls[kind] += 1; return Promise.resolve(result()).then(ok, bad); },
  };
  return q;
};
const MenuStub = {
  find: (filter, projection) =>
    projection
      ? query(() => rows.map((r) => ({ _id: r._id, updatedAt: r.updatedAt, __v: r.__v })), "marks")
      : query(() => rows.map((r) => ({ ...r, toObject: () => JSON.parse(JSON.stringify({ ...r, toObject: undefined })) })), "full"),
};
const { projectedMenus, clearProjectedMenuCache } = require("../services/projectedMenuCache");
const { AUDIENCES } = require("../services/menuCache");

const menu = (name, at) => ({
  _id: new mongoose.Types.ObjectId(),
  name,
  updatedAt: new Date(at),
  __v: 0,
  isDeleted: false,
  hasPublishedToWebsite: true,
  websiteSnapshot: { name, items: [{ _id: "i1", name: `${name} dish`, price: 100 }] },
  items: [{ _id: "i1", name: `${name} draft dish`, price: 999 }],
});
const args = { Menu: MenuStub, query: { restaurantId: "r1", isDeleted: { $ne: true } }, audience: AUDIENCES.WEBSITE };
const reset = () => { clearProjectedMenuCache(); calls.full = 0; calls.marks = 0; };

test("a second request with no menu change is served without loading the menus again", async () => {
  reset();
  rows = [menu("Starters", "2026-11-01T10:00:00Z")];
  const first = await projectedMenus(args);
  const second = await projectedMenus(args);
  assert.deepEqual(second, first);
  assert.equal(calls.full, 1, "full menus loaded once");
  assert.equal(calls.marks, 1, "only the change check ran the second time");
});

test("an edit (updatedAt moves) shows on the very next request", async () => {
  reset();
  rows = [menu("Starters", "2026-11-01T10:00:00Z")];
  await projectedMenus(args);
  rows = [{ ...rows[0], updatedAt: new Date("2026-11-01T10:05:00Z"), websiteSnapshot: { name: "Starters", items: [{ _id: "i1", name: "New dish", price: 150 }] } }];
  const after = await projectedMenus(args);
  assert.equal(JSON.stringify(after).includes("New dish"), true);
  assert.equal(calls.full, 2);
});

test("a menu added or removed is seen at once", async () => {
  reset();
  rows = [menu("Starters", "2026-11-01T10:00:00Z")];
  await projectedMenus(args);
  rows = [...rows, menu("Mains", "2026-11-01T10:00:00Z")];
  assert.equal((await projectedMenus(args)).length, 2);
  rows = rows.slice(1);
  assert.equal((await projectedMenus(args)).length, 1);
});

test("what a caller changes never reaches the next caller", async () => {
  reset();
  rows = [menu("Starters", "2026-11-01T10:00:00Z")];
  const a = await projectedMenus(args);
  a[0].items = [];
  a[0].name = "changed";
  const b = await projectedMenus(args);
  assert.notEqual(b[0].name, "changed");
  assert.notEqual(b[0].items.length, 0);
});

test("menus without updatedAt are never cached", async () => {
  reset();
  rows = [{ ...menu("Starters", "2026-11-01T10:00:00Z"), updatedAt: undefined }];
  await projectedMenus(args);
  await projectedMenus(args);
  assert.equal(calls.full, 2);
});

test("different stores and audiences never share an entry", async () => {
  reset();
  rows = [menu("Starters", "2026-11-01T10:00:00Z")];
  await projectedMenus(args);
  await projectedMenus({ ...args, query: { ...args.query, restaurantId: "r2" } });
  await projectedMenus({ ...args, audience: AUDIENCES.SYSTEM });
  assert.equal(calls.full, 3);
});
