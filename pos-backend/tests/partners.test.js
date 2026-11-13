const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { allowed } = require("../middlewares/partnerPassthrough");
const { aggregateDashboard, change } = require("../services/partnerDashboard");
const { isOwnerLogin, fingerprintOf } = require("../services/partners");

const src = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("Partners pass-through: only a store's billing and read-only reports, nothing else", () => {
  // Billing
  assert.ok(allowed("GET", "/api/subscription"));
  assert.ok(allowed("GET", "/api/subscription/quote"));
  assert.ok(allowed("GET", "/api/subscription/invoices"));
  assert.ok(allowed("POST", "/api/subscription/plan"));
  assert.ok(allowed("POST", "/api/subscription/hardware-requests/HR-1/cancel"));
  assert.ok(allowed("DELETE", "/api/subscription/addons/WEBSITE"));
  assert.ok(allowed("GET", "/api/business-balance/transactions"));
  assert.ok(allowed("POST", "/api/business-balance/recharge/verify"));
  // Reports and orders, read only
  assert.ok(allowed("GET", "/api/order/report"));
  assert.ok(allowed("GET", "/api/order/report/export"));
  assert.ok(allowed("GET", "/api/order/6af670da403e505d31ad669c"));
  // Manage Menu, Inventory, Staff, Help & Support (owner, 2026-11-13)
  for (const [m, p] of [
    ["GET", "/api/menu"],
    ["POST", "/api/menu/dish"],
    ["PUT", "/api/menu/6af670da403e505d31ad669c/publish"],
    ["POST", "/api/menu/publish/system"],
    ["POST", "/api/media"],
    ["GET", "/api/inventory/ingredients"],
    ["POST", "/api/inventory/stock-counts"],
    ["GET", "/api/restaurant/staff"],
    ["POST", "/api/restaurant/staff"],
    ["DELETE", "/api/restaurant/staff/6af670da403e505d31ad669c"],
    ["POST", "/api/restaurant/verify-pin"],
    ["POST", "/api/support/requests"],
  ]) assert.equal(allowed(m, p), true, `${m} ${p}`);
  // The POS's everything else
  for (const [m, p] of [
    ["POST", "/api/table-session/open"],
    ["PUT", "/api/restaurant/properties"],
    ["PUT", "/api/restaurant/order-toggles"],
    ["PUT", "/api/website/settings"],
    ["POST", "/api/menuX"],
    ["POST", "/api/order"],
    ["PUT", "/api/order/6af670da403e505d31ad669c"],
    ["PUT", "/api/restaurant/pos-settings"],
    ["GET", "/api/user"],
    ["POST", "/api/user/change-password"],
    ["DELETE", "/api/subscription/plan"],
    ["GET", "/api/csd/stores"],
  ]) assert.equal(allowed(m, p), false, `${m} ${p}`);
});

test("only a store's Owner login signs in or links; a changed password changes the fingerprint", () => {
  assert.equal(isOwnerLogin({ role: "Owner" }), true);
  for (const role of ["Manager", "Cashier", "Admin", "Staff", "owner", ""]) assert.equal(isOwnerLogin({ role }), false, role);
  const a = fingerprintOf({ password: "$2b$10$abc" });
  assert.equal(a, fingerprintOf({ password: "$2b$10$abc" }));
  assert.notEqual(a, fingerprintOf({ password: "$2b$10$xyz" }));
  assert.ok(!a.includes("abc"), "the hash itself is never stored");
});

test("dashboard figures are the stores' own report buckets added up, with change against the period before", () => {
  const b = (count, amount) => ({ count, amount });
  const s1 = { total: b(5, 2908), cancelled: b(1, 100), system: b(5, 2908), cash: b(4, 1792), upi: b(1, 1116), tips: b(0, 0) };
  const s2 = { total: b(2, 500), website: b(2, 500), upi: b(2, 500) };
  const out = aggregateDashboard({
    stores: [
      { storeId: "111111", name: "A", report: { summary: s1, breakdown: { byItem: [{ name: "Dosa", quantity: 3, amount: 447 }], byHour: [{ hour: 7, count: 3, amount: 1000 }] }, daily: [{ day: "2026-11-13", count: 5, amount: 2908 }] }, previous: { summary: { total: b(4, 2400) } } },
      { storeId: "222222", name: "B", report: { summary: s2, breakdown: { byItem: [{ name: "Dosa", quantity: 1, amount: 149 }], byHour: [{ hour: 7, count: 2, amount: 500 }] }, daily: [{ day: "2026-11-13", count: 2, amount: 500 }] }, previous: { summary: {} } },
    ],
  });
  assert.equal(out.totals.sales, 3408);
  assert.equal(out.totals.orders, 7);
  assert.equal(out.totals.cancelled, 1);
  assert.equal(out.totals.salesChange, 42);
  assert.deepEqual(out.stores.map((s) => s.storeId), ["111111", "222222"], "biggest first");
  assert.equal(out.stores[1].salesChange, null, "nothing before: no percentage");
  assert.deepEqual(out.channels.map((c) => c.label), ["POS", "Website"]);
  assert.deepEqual(out.topItems, [{ name: "Dosa", quantity: 4, amount: 596 }]);
  assert.deepEqual(out.byHour, [{ hour: 7, count: 5, amount: 1500 }]);
  assert.deepEqual(out.daily, [{ day: "2026-11-13", count: 7, amount: 3408 }]);
  assert.equal(change(0, 0), null);
});

test("wiring: pass-through before every route, the guard trusts only the server-set store, lock lets the owner read", () => {
  const app = src("app.js");
  const pass = app.indexOf('require("./middlewares/partnerPassthrough").partnerPassthrough');
  const firstRoute = app.indexOf('app.use("/api/user"');
  assert.ok(pass > 0 && pass < firstRoute, "the pass-through runs before the routes");
  assert.match(app, /app\.use\("\/api\/partners", require\("\.\/routes\/partnerRoute"\)\)/);
  const guard = src("middlewares/tokenVerification.js");
  assert.match(guard, /if \(req\.partnerActingUser\) \{/);
  assert.match(guard, /return enforceAccountLock\(req, res, \(\) => enforcePlan\(req, res, next\)\);\n    \}/, "lock and plan still apply");
  assert.match(src("middlewares/accountLock.js"), /if \(req\.user\?\.viaPartners && req\.method === "GET"\) return next\(\);/);
  const pt = src("middlewares/partnerPassthrough.js");
  assert.match(pt, /const owner = await ownerForLink\(link\);/);
  assert.match(pt, /if \(!allowed\(req\.method, path\)\) return next\(createHttpError\(404/);
  // Sign-in and linking use the POS's own credential check, and only an Owner.
  const routes = src("routes/partnerRoute.js");
  assert.match(routes, /const user = await verifyStoreCredentials\(body \|\| \{\}\);/);
  assert.match(routes, /if \(!isOwnerLogin\(user\)\) \{/);
  assert.match(routes, /already linked to another Partners account/);
  assert.match(routes, /This is your only store/);
  // Its own cookie on knotkitchen.com/partners, signed with its own key.
  const svc = src("services/partners.js");
  assert.match(svc, /const COOKIE_PATH = "\/partners";/);
  assert.match(svc, /const secret = \(\) => `\$\{config\.accessTokenSecret\}:partners`;/);
  assert.match(svc, /if \(claims\?\.typ !== "partner"/);
});

test("Caddy serves the Partners app and forwards only /api/partners to the API", () => {
  const caddy = fs.readFileSync(path.join(__dirname, "..", "..", "deploy", "Caddyfile"), "utf8");
  assert.match(caddy, /handle \/partners\/api\/\* \{\n\t\turi replace \/partners\/api\/ \/api\/partners\/ 1\n\t\treverse_proxy pos-api:8000/);
  assert.doesNotMatch(caddy, /handle_path \/partners/, "handle_path is not ordered with handle by path length");
  assert.match(caddy, /handle \/partners\/\* \{\n\t\treverse_proxy pos-web:80/);
  const docker = fs.readFileSync(path.join(__dirname, "..", "..", "pos-frontend", "Dockerfile"), "utf8");
  assert.match(docker, /RUN npm run build && npm run build:partners/);
});
