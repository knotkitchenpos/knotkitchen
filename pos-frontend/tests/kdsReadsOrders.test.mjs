import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SRC = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("REGRESSION: the KDS reads the orders the tills write", () => {
  // It read a separate KDS store that no order path ever filled: always empty.
  const kds = SRC("src/pages/KDS.jsx");
  assert.match(kds, /import \{ getOrders, markOrderReady \} from "\.\.\/https";/);
  assert.doesNotMatch(kds, /getKDSOrders|updateKDSItemStatus|updateKDSOrderStatus/);
  // Under the "orders" key, so useRealtimeSync refetches it on every order event.
  assert.match(kds, /queryKey: \["orders", "kds"\]/);
  // A QR order waiting for a till to accept it is not the kitchen's yet.
  assert.match(kds, /listAwaitingOrders/);
  assert.match(kds, /!awaiting\.has\(String\(o\._id\)\)/);
  assert.match(kds, /ready\.mutate\(o\._id\)/);
  assert.match(kds, /awaiting approval/);
});

test("REGRESSION: a till order's lines are not marked awaiting approval", () => {
  // Till lines are stored "pending" too; only a table's diner additions wait for approval.
  const kds = SRC("src/pages/KDS.jsx");
  assert.match(kds, /\{i\.status === "pending" && o\.tableSessionId && \(/);
});

test("REGRESSION: a takeaway paid at the till reaches the kitchen screen", () => {
  // It is created Completed, and the KDS listed only Preparing / In Progress.
  const kds = SRC("src/pages/KDS.jsx");
  assert.match(kds, /const COOKING = "[^"]*,Completed";/);
  assert.match(kds, /o\.source === "POS"/);
  assert.match(kds, /!o\.readyAt/);
  assert.match(kds, /!isSettled\(o\.orderStatus\) \|\| paidTakeaway\(o\)/);
});

test("the kitchen screen is in the navigation", () => {
  const sidebar = SRC("src/components/shared/Sidebar.jsx");
  assert.equal((sidebar.match(/\{ path: "\/kds", label: "Kitchen", Icon: IconKitchen \}/g) || []).length, 2, "side panel and bottom bar");
});

test("the backend no longer serves /api/kds (it let any store move another store's orders)", () => {
  const app = fs.readFileSync(new URL("../../pos-backend/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /\/api\/kds/);
});
