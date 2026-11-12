import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const events = [];
globalThis.window = { dispatchEvent: (e) => events.push(e), addEventListener() {} };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });

const { isNetworkError, mayHaveReachedServer, localOrderView, enqueueOrder } = await import("../src/utils/offlineQueue.js");
const { isReachable, markReachable } = await import("../src/utils/connectivity.js");
const src = (f) => fs.readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

test("the API being down behind the gateway keeps the sale on the device", () => {
  for (const status of [502, 503, 504]) assert.equal(isNetworkError({ response: { status } }), true);
  assert.equal(isNetworkError({ response: { status: 500 } }), false);
  assert.equal(isNetworkError({ response: { status: 409 } }), false);
  // Only where the server may hold the sale does the till leave the KOT to it.
  assert.equal(mayHaveReachedServer({ code: "ECONNABORTED" }), true);
  assert.equal(mayHaveReachedServer({ response: { status: 504 } }), true);
  assert.equal(mayHaveReachedServer({ response: { status: 502 } }), false);
  assert.equal(mayHaveReachedServer({ code: "ERR_NETWORK" }), false);
});

test("a paid sale taken offline shows as paid, split or not", () => {
  const cash = localOrderView(enqueueOrder({ paymentMethod: "Cash", bills: { totalWithTax: 238 } }));
  assert.deepEqual(cash.payments, [{ method: "cash", amount: 238, status: "paid" }]);
  const split = localOrderView(enqueueOrder({ paymentMethod: "Split", bills: { totalWithTax: 300 }, splits: [{ method: "CASH", amount: 100 }, { method: "UPI", amount: 200 }] }));
  assert.deepEqual(split.payments.map((p) => [p.method, p.amount, p.status]), [["cash", 100, "paid"], ["upi", 200, "paid"]]);
  assert.equal(localOrderView(enqueueOrder({ bills: { totalWithTax: 50 } })).payments, undefined);
});

test("reachability follows what happened, and is announced once per change", () => {
  assert.equal(isReachable(), true);
  events.length = 0;
  markReachable(false);
  markReachable(false);
  assert.equal(isReachable(), false);
  markReachable(true);
  assert.deepEqual(events.map((e) => [e.type, e.detail.online]), [["kk:connectivity", false], ["kk:connectivity", true]]);
});

test("the till's badge, the API client and the socket all use the real signal", () => {
  const panel = src("components/pos/OrderPanel.jsx");
  assert.match(panel, /const online = useReachable\(\);/);
  assert.match(panel, /\{online \? \(/);
  assert.match(panel, /Offline\s*<\/span>/);
  const ax = src("https/axiosWrapper.js");
  assert.match(ax, /markReachable\(true\);\s*return response;/);
  assert.match(ax, /markReachable\(!\[502, 503, 504\]\.includes\(error\.response\.status\)\)/);
  assert.match(src("socket.js"), /socket\.on\("connect", \(\) => \{[\s\S]{0,400}markReachable\(true\)/);
});

test("the queue syncs on reconnect, in batches, with a time limit, and retries every 15 s", () => {
  const hook = src("hooks/useOfflineQueue.js");
  assert.match(hook, /const BATCH = 25;/);
  assert.match(hook, /const RETRY_MS = 15_000;/);
  assert.match(hook, /window\.addEventListener\("kk:connectivity", reach\)/);
  assert.match(hook, /if \(e\.detail\?\.online\) flush\(\);/);
  assert.match(hook, /document\.addEventListener\("visibilitychange", visible\)/);
  assert.match(src("https/index.js"), /"\/api\/offline\/orders\/sync", \{ orders \}, \{ timeout: 30000 \}/);
});

test("a table order offline says why, instead of 'No tables configured'", () => {
  const modal = src("components/pos/TableModal.jsx");
  assert.match(modal, /offline = false,/);
  assert.match(modal, /No internet\. Table orders need the connection/);
  assert.match(src("components/pos/OrderPanel.jsx"), /offline=\{!online\}/);
});

test("a refused order is resent every 5 minutes, or at once from Retry, not every 15 seconds", () => {
  const hook = src("hooks/useOfflineQueue.js");
  assert.match(hook, /const REFUSED_RETRY_MS = 5 \* 60_000;/);
  assert.match(hook, /const due = \(e, force\) => force \|\| !e\.error \|\| !e\.failedAt \|\| Date\.now\(\) - new Date\(e\.failedAt\)\.getTime\(\) >= REFUSED_RETRY_MS;/);
  assert.match(hook, /const all = readQueue\(\)\.filter\(\(e\) => due\(e, forced\)\);/);
  // The banner's Retry forces; the browser's "online" event (an Event object) does not.
  assert.match(hook, /const forced = force === true;/);
  assert.match(hook, /flush: \(\) => flush\(true\)/);
});

test("a till that thinks it is offline asks the server every 15 s, so the badge clears without the socket", () => {
  const hook = src("hooks/useOfflineQueue.js");
  assert.match(hook, /if \(readQueue\(\)\.some\(\(e\) => due\(e, false\)\)\) flush\(\);\s*\/\/[^\n]*\n[^\n]*\n\s*else if \(enabled && !isReachable\(\) && navigator\.onLine !== false\) getUserData\(\)\.catch\(\(\) => \{\}\);/);
});

test("signing out with orders still waiting asks first", () => {
  const settings = src("pages/Settings.jsx");
  assert.match(settings, /const waiting = readQueue\(\)\.length;/);
  assert.match(settings, /have not synced yet[\s\S]{0,200}\)\s*return;\s*logoutMutation\.mutate\(\);/);
});

test("the menu query never passes React Query's context as URL parameters", () => {
  // queryFn: getMenus sent ?client=[object Object]&signal=[object AbortSignal] to /api/menu.
  for (const f of ["components/dashboard/ManageMenu.jsx", "pages/Menu.jsx"]) {
    assert.doesNotMatch(src(f), /queryFn: getMenus\b/);
    assert.match(src(f), /queryFn: \(\) => getMenus\(\)/);
  }
});
