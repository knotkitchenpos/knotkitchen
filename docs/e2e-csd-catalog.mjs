/** End-to-end: CSD Menus / Tables / Users — the Admin Portal's last three features. */
const BASE = "http://localhost:8000/api/csd";
const OTP = "123456";

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${!ok && d ? "  <- " + d : ""}`); };

const jar = new Map();
const call = async (path, { method = "GET", body, who } = {}) => {
  const h = { "content-type": "application/json" };
  if (who && jar.has(who)) h.cookie = jar.get(who);
  const res = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.getSetCookie?.() || [];
  if (who && sc.length) jar.set(who, sc.map((c) => c.split(";")[0]).join("; "));
  let json = null; try { json = await res.json(); } catch { /* none */ }
  return { status: res.status, json };
};

import { createRequire } from "node:module";
const nodeRequire = createRequire("D:/Knotkitchen/Restaurant_POS_System-master/pos-backend/");
const mongoose = nodeRequire("mongoose");
await mongoose.connect("mongodb://127.0.0.1:27019/knotkitchen");
const db = mongoose.connection.db;

const oid = () => new mongoose.Types.ObjectId();
const RESTAURANT_ID = oid();
const STORE_ID = "778899";

// --- seed -------------------------------------------------------------------
// Idempotent: a previous run leaves rows behind, and "restaurants" has a
// unique index on storeId that a second null would collide with.
await db.collection("otpverifications").deleteMany({});
await db.collection("stores").deleteMany({ storeId: { $in: [STORE_ID, "112233"] } });
await db.collection("restaurants").deleteMany({ name: { $in: ["Catalog Test Kitchen", "Other Place"] } });
await db.collection("menus").deleteMany({ name: "Main Menu" });
await db.collection("tables").deleteMany({ tableNumber: { $in: [7, 1] } });
await db.collection("users").deleteMany({ email: "ravi@example.com" });

await db.collection("restaurants").insertOne({
  _id: RESTAURANT_ID, name: "Catalog Test Kitchen", isDeleted: false, createdAt: new Date(),
});
await db.collection("stores").insertOne({
  storeId: STORE_ID, restaurantId: RESTAURANT_ID, storeName: "Catalog Test Kitchen",
  isDeleted: false, status: "active", createdAt: new Date(),
});

const ITEM_A = oid(), ITEM_B = oid();
const MENU_ID = oid();
await db.collection("menus").insertOne({
  _id: MENU_ID, restaurantId: RESTAURANT_ID, name: "Main Menu", published: false, isPublished: false,
  isDeleted: false, createdAt: new Date(), createdBy: oid(),
  items: [
    { _id: ITEM_A, name: "Paneer Tikka", price: 240, category: "Starters", isAvailable: true, isVegetarian: true },
    { _id: ITEM_B, name: "Chicken Biryani", price: 320, category: "Mains", isAvailable: false, isVegetarian: false },
  ],
});

const TABLE_ID = oid();
await db.collection("tables").insertOne({
  _id: TABLE_ID, restaurantId: RESTAURANT_ID, tableNumber: 7, capacity: 4,
  status: "available", zone: "Ground", qrEnabled: true, isDeleted: false, createdAt: new Date(),
});

const USER_ID = oid();
await db.collection("users").insertOne({
  _id: USER_ID, restaurantId: RESTAURANT_ID, name: "Ravi Kumar", phone: "9812345678",
  email: "ravi@example.com", role: "Waiter", isActive: true, password: "hashed-secret",
  isDeleted: false, createdAt: new Date(),
});

// Another restaurant, to prove cross-store access is refused.
const OTHER_RESTAURANT = oid();
const OTHER_TABLE = oid();
await db.collection("stores").insertOne({
  storeId: "112233", restaurantId: OTHER_RESTAURANT, storeName: "Other Place",
  isDeleted: false, status: "active", createdAt: new Date(),
});
await db.collection("tables").insertOne({
  _id: OTHER_TABLE, restaurantId: OTHER_RESTAURANT, tableNumber: 1, capacity: 2,
  status: "available", isDeleted: false, createdAt: new Date(),
});

// A non-admin CSD staff member, so the read-vs-write split can be tested.
await db.collection("csdstaffs").deleteMany({ phone: "9000000002" });
await db.collection("csdstaffs").insertOne({
  staffId: "KK-ST-900", fullName: "Support Staff", phone: "9000000002",
  role: "staff", status: "active", permissions: [], dateJoined: new Date(),
  createdAt: new Date(), updatedAt: new Date(),
});

const signIn = async (who, phone) => {
  await db.collection("otpverifications").deleteMany({});
  await call("/auth/send-otp", { method: "POST", body: { phone }, who });
  return call("/auth/verify-otp", { method: "POST", body: { phone, otp: OTP }, who });
};
const admin = await signIn("admin", "8646826709");
const staff = await signIn("staff", "9000000002");
check("admin signed in", admin.status === 200, JSON.stringify(admin.json).slice(0, 120));
check("staff signed in", staff.status === 200, JSON.stringify(staff.json).slice(0, 120));

console.log("\n--- Menus ---");
{
  const r = await call(`/restaurants/${STORE_ID}/menus`, { who: "staff" });
  check("staff can list menus", r.status === 200, JSON.stringify(r.json).slice(0, 150));
  const m = r.json.data.menus[0];
  check("menu returned", !!m && m.name === "Main Menu");
  check("item count correct", m.itemCount === 2, `${m?.itemCount}`);
  check("staff told they cannot edit", r.json.data.canEdit === false);

  // The field-name bug this would have hidden: isAvailable / isVegetarian.
  const veg = m.items.find((i) => i.name === "Paneer Tikka");
  const nonveg = m.items.find((i) => i.name === "Chicken Biryani");
  check("veg flag reads from isVegetarian", veg.isVegetarian === true && nonveg.isVegetarian === false);
  check("availability reads from isAvailable", veg.isAvailable === true && nonveg.isAvailable === false);
  check("price surfaced", veg.price === 240);

  const a = await call(`/restaurants/${STORE_ID}/menus`, { who: "admin" });
  check("admin told they can edit", a.json.data.canEdit === true);
}

console.log("\n--- editing a dish ---");
{
  const bad = await call(`/restaurants/${STORE_ID}/menus/${MENU_ID}/items/${ITEM_A}`, {
    method: "PATCH", who: "staff", body: { price: 999 } });
  check("staff CANNOT edit a dish", bad.status === 403, `got ${bad.status}`);

  const ok = await call(`/restaurants/${STORE_ID}/menus/${MENU_ID}/items/${ITEM_A}`, {
    method: "PATCH", who: "admin", body: { price: 265, isAvailable: false } });
  check("admin CAN edit a dish", ok.status === 200, JSON.stringify(ok.json).slice(0, 150));
  check("price updated", ok.json.data.price === 265, `${ok.json?.data?.price}`);
  check("availability updated", ok.json.data.isAvailable === false);

  const row = await db.collection("menus").findOne({ _id: MENU_ID });
  const item = row.items.find((i) => String(i._id) === String(ITEM_A));
  check("persisted to the real schema field", item.isAvailable === false && item.price === 265,
    JSON.stringify({ isAvailable: item.isAvailable, price: item.price }));

  const neg = await call(`/restaurants/${STORE_ID}/menus/${MENU_ID}/items/${ITEM_A}`, {
    method: "PATCH", who: "admin", body: { price: -5 } });
  check("negative price refused", neg.status === 400, `got ${neg.status}`);

  const empty = await call(`/restaurants/${STORE_ID}/menus/${MENU_ID}/items/${ITEM_A}`, {
    method: "PATCH", who: "admin", body: { name: "   " } });
  check("empty dish name refused", empty.status === 400, `got ${empty.status}`);
}

console.log("\n--- publishing a menu ---");
{
  const t = await call(`/restaurants/${STORE_ID}/menus/${MENU_ID}/publish`, { method: "PATCH", who: "admin" });
  check("admin can publish", t.status === 200 && t.json.data.published === true, JSON.stringify(t.json).slice(0, 120));
  const row = await db.collection("menus").findOne({ _id: MENU_ID });
  check("both published flags kept in step", row.published === true && row.isPublished === true);
  check("publishedAt stamped", !!row.publishedAt);

  const t2 = await call(`/restaurants/${STORE_ID}/menus/${MENU_ID}/publish`, { method: "PATCH", who: "admin" });
  check("toggles back off", t2.json.data.published === false);

  const s = await call(`/restaurants/${STORE_ID}/menus/${MENU_ID}/publish`, { method: "PATCH", who: "staff" });
  check("staff CANNOT publish", s.status === 403, `got ${s.status}`);
}

console.log("\n--- Tables ---");
{
  const r = await call(`/restaurants/${STORE_ID}/tables`, { who: "staff" });
  check("staff can list tables", r.status === 200);
  check("table returned", r.json.data.tables[0]?.tableNumber === 7);
  check("allowed statuses advertised", Array.isArray(r.json.data.statuses) && r.json.data.statuses.includes("cleaning"));

  const ok = await call(`/restaurants/${STORE_ID}/tables/${TABLE_ID}`, {
    method: "PATCH", who: "admin", body: { status: "cleaning", capacity: 6, zone: "Terrace" } });
  check("admin can update a table", ok.status === 200, JSON.stringify(ok.json).slice(0, 150));
  check("status/capacity/zone applied", ok.json.data.status === "cleaning" && ok.json.data.capacity === 6 && ok.json.data.zone === "Terrace");

  const badStatus = await call(`/restaurants/${STORE_ID}/tables/${TABLE_ID}`, {
    method: "PATCH", who: "admin", body: { status: "on-fire" } });
  check("invalid status refused", badStatus.status === 400, `got ${badStatus.status}`);

  const badCap = await call(`/restaurants/${STORE_ID}/tables/${TABLE_ID}`, {
    method: "PATCH", who: "admin", body: { capacity: 0 } });
  check("zero capacity refused", badCap.status === 400, `got ${badCap.status}`);

  const s = await call(`/restaurants/${STORE_ID}/tables/${TABLE_ID}`, {
    method: "PATCH", who: "staff", body: { status: "occupied" } });
  check("staff CANNOT update a table", s.status === 403, `got ${s.status}`);
}

console.log("\n--- Users (the restaurant's own staff) ---");
{
  const r = await call(`/restaurants/${STORE_ID}/users`, { who: "staff" });
  check("staff can list users", r.status === 200);
  const u = r.json.data.users[0];
  check("user returned", u?.name === "Ravi Kumar");
  check("roles advertised", r.json.data.roles.includes("Manager"));
  check("password never leaves the server", !JSON.stringify(r.json).toLowerCase().includes("hashed-secret")
    && !JSON.stringify(r.json).includes("password"));

  const ok = await call(`/restaurants/${STORE_ID}/users/${USER_ID}`, {
    method: "PATCH", who: "admin", body: { role: "Manager", isActive: false } });
  check("admin can change a role", ok.status === 200 && ok.json.data.role === "Manager", JSON.stringify(ok.json).slice(0, 150));
  check("can deactivate", ok.json.data.isActive === false);

  const badRole = await call(`/restaurants/${STORE_ID}/users/${USER_ID}`, {
    method: "PATCH", who: "admin", body: { role: "SuperUser" } });
  check("invalid role refused", badRole.status === 400, `got ${badRole.status}`);

  const pw = await call(`/restaurants/${STORE_ID}/users/${USER_ID}`, {
    method: "PATCH", who: "admin", body: { password: "hunter2" } });
  const row = await db.collection("users").findOne({ _id: USER_ID });
  check("password cannot be set from CSD", row.password === "hashed-secret", `password is now ${row.password}`);

  const s = await call(`/restaurants/${STORE_ID}/users/${USER_ID}`, {
    method: "PATCH", who: "staff", body: { role: "Owner" } });
  check("staff CANNOT change a role", s.status === 403, `got ${s.status}`);
}

console.log("\n--- scoping: one store cannot touch another ---");
{
  const cross = await call(`/restaurants/${STORE_ID}/tables/${OTHER_TABLE}`, {
    method: "PATCH", who: "admin", body: { status: "occupied" } });
  check("another store's table is not reachable", cross.status === 404, `got ${cross.status}`);

  const otherList = await call(`/restaurants/112233/tables`, { who: "admin" });
  check("the other store lists only its own table", otherList.json.data.tables.length === 1
    && String(otherList.json.data.tables[0].id) === String(OTHER_TABLE));

  const bogus = await call(`/restaurants/999999/menus`, { who: "admin" });
  check("unknown store is 404", bogus.status === 404, `got ${bogus.status}`);

  const badId = await call(`/restaurants/abc/menus`, { who: "admin" });
  check("non-numeric store id is 400", badId.status === 400, `got ${badId.status}`);
}

console.log("\n--- signed out ---");
{
  const anon = await fetch(`${BASE}/restaurants/${STORE_ID}/menus`);
  check("listing requires a session", anon.status === 401, `got ${anon.status}`);
}

console.log("\n--- everything is audited ---");
{
  const a = await call("/reports/audit", { who: "admin" });
  const actions = a.json.data.actions || [];
  for (const act of ["CSD_DISH_UPDATED", "CSD_MENU_PUBLISH_TOGGLED", "CSD_TABLE_UPDATED", "CSD_RESTAURANT_USER_UPDATED"]) {
    check(`${act} recorded`, actions.includes(act), JSON.stringify(actions).slice(0, 200));
  }
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
await mongoose.disconnect();
process.exit(fail ? 1 : 0);
