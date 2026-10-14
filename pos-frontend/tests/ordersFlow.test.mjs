import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addedAfterOpening } from "../src/utils/orderItems.js";
import { awaitingAccept, paidTakeawayCooking } from "../src/constants/orderStatus.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const oid = (ms) => Math.floor(ms / 1000).toString(16).padStart(8, "0") + "0000000000000000";

test("N069: a dish added in a later round is told apart on Orders; the first round is not", () => {
  const opened = Date.parse("2026-10-13T15:00:00.400Z");
  const order = { createdAt: new Date(opened).toISOString() };
  assert.equal(addedAfterOpening({ _id: oid(opened - 300) }, order), null);
  assert.equal(addedAfterOpening({ _id: oid(opened + 5 * 60_000) }, order)?.toISOString(), "2026-10-13T15:05:00.000Z");
  assert.equal(addedAfterOpening({ name: "no id" }, order), null);
  const orders = SRC("src/pages/Orders.jsx");
  assert.match(orders, /Added \{time12\(addedAfterOpening\(it, selected\)\)\}/);
  assert.match(orders, /Awaiting acceptance/);
});

test("N018: a takeaway paid at the till can be marked Ready from Orders", () => {
  const paid = { orderStatus: "Completed", source: "POS", orderType: "collection", readyAt: null, createdAt: new Date().toISOString() };
  assert.equal(paidTakeawayCooking(paid), true);
  // REGRESSION: last week's paid takeaway was handed over long ago; Mark Ready would text the customer now.
  assert.equal(paidTakeawayCooking({ ...paid, createdAt: new Date(Date.now() - 13 * 3600e3).toISOString() }), false);
  assert.equal(paidTakeawayCooking({ ...paid, createdAt: undefined }), false);
  assert.equal(paidTakeawayCooking({ ...paid, readyAt: new Date() }), false);
  assert.equal(paidTakeawayCooking({ ...paid, orderType: "dine-in" }), false);
  assert.equal(paidTakeawayCooking({ ...paid, source: "WEBSITE" }), false);
  assert.match(SRC("src/pages/Orders.jsx"), /isPreparing\(selected\.orderStatus\) \|\| paidTakeawayCooking\(selected\) \?/);
});

test("N020: Orders accepts a customer order nobody accepted (website or table) instead of marking it Ready", () => {
  const waiting = [{ name: "Naan", status: "pending" }, { name: "Dal", status: "cancelled" }];
  assert.equal(awaitingAccept({ source: "WEBSITE", orderStatus: "Preparing", items: [{ name: "Biryani", status: "pending" }] }), true, "website Pending reaches Orders as Preparing");
  assert.equal(awaitingAccept({ source: "QR", tableSessionId: "s1", orderStatus: "Preparing", items: waiting }), true);
  assert.equal(awaitingAccept({ source: "POS", tableSessionId: "s1", orderStatus: "Preparing", items: waiting }), true, "a guest's first round on a table the till opened");
  assert.equal(awaitingAccept({ source: "QR", tableSessionId: "s1", orderStatus: "Preparing", items: [{ status: "preparing" }, { status: "pending" }] }), false, "an accepted order with an addition under review");
  assert.equal(awaitingAccept({ source: "POS", orderStatus: "Preparing", items: [{ status: "pending" }] }), false, "a till order is never waiting");
  assert.equal(awaitingAccept({ source: "WEBSITE", orderStatus: "Completed", items: [{ status: "pending" }] }), false, "a finished order is past accepting");
  assert.equal(awaitingAccept({ source: "WEBSITE", orderStatus: "Cancelled", items: [{ status: "cancelled" }] }), false);
  const orders = SRC("src/pages/Orders.jsx");
  assert.match(orders, /\bawaitingAccept, statusLabel,[^\n]*from "\.\.\/constants\/orderStatus"/, "one rule, from the constants");
  assert.doesNotMatch(orders, /const awaitingAccept\b/);
  assert.match(orders, /mutationFn: \(orderId\) => updateOnlineOrderStatus\(orderId, "accept"\)/);
  const accept = orders.indexOf("{awaitingAccept(selected) ? (");
  assert.ok(accept > 0 && accept < orders.indexOf(") : isPreparing(selected.orderStatus) || paidTakeawayCooking(selected) ? ("), "Accept is checked before Mark Ready");
});

test("REGRESSION N018: a paid takeaway still cooking is listed and counted under Preparing, with a live timer", () => {
  const orders = SRC("src/pages/Orders.jsx");
  const a = orders.indexOf("const TABS = [");
  const b = orders.indexOf("/* ---------- Module 4 §6", a);
  const { TABS, inTab } = new Function("OUT_FOR_DELIVERY", "paidTakeawayCooking", `${orders.slice(a, b)}\nreturn { TABS, inTab };`)("Out for delivery", paidTakeawayCooking);
  const tab = (k) => TABS.find((t) => t.key === k);
  const cooking = { orderStatus: "Completed", source: "POS", orderType: "collection", readyAt: null, createdAt: new Date().toISOString() };
  assert.equal(inTab(tab("Preparing"), cooking), true);
  assert.equal(inTab(tab("Completed"), cooking), true, "still a completed sale");
  assert.equal(inTab(tab("Preparing"), { ...cooking, readyAt: new Date().toISOString() }), false);
  assert.match(orders, /c\[t\.key\] = orders\.filter\(\(o\) => inTab\(t, o\)\)\.length;/);
  assert.match(orders, /if \(tabDef\?\.statuses && !inTab\(tabDef, o\)\) return false;/);
  assert.match(orders, /const done = isFinished\(o\.orderStatus\) && !cooking;/);
  assert.match(orders, /const preparingBadge = isPreparing\(o\.orderStatus\) \|\| cooking;/);
});
