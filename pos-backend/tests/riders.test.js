const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const riders = require("../services/riders");

const SRC = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("PINs: 4 to 6 digits, never a repeated digit or a plain run", () => {
  assert.equal(riders.pinProblem("4827"), "");
  assert.equal(riders.pinProblem("482759"), "");
  assert.match(riders.pinProblem("123"), /4 to 6/);
  assert.match(riders.pinProblem("1234567"), /4 to 6/);
  assert.match(riders.pinProblem("12a4"), /4 to 6/);
  assert.match(riders.pinProblem("0000"), /repeated/);
  assert.match(riders.pinProblem("1234"), /run/);
  assert.match(riders.pinProblem("9876"), /run/);
});

test("phone numbers: a 10-digit Indian mobile, from how people type it", () => {
  assert.equal(riders.cleanPhone("98765 43210"), "9876543210");
  assert.equal(riders.cleanPhone("+91 98765-43210"), "9876543210");
  assert.equal(riders.cleanPhone("09876543210"), "9876543210");
  assert.equal(riders.cleanPhone("1234567890"), "");
  assert.equal(riders.cleanPhone({ $ne: null }), "");
  assert.equal(riders.maskPhone("9876543210"), "98XXXXXX10");
});

test("a store's one-time code works once, for its purpose, until it expires", () => {
  const rider = { _id: "64b000000000000000000001" };
  const code = riders.issueCode(rider, "reset");
  assert.match(code, /^\d{6}$/);
  assert.notEqual(rider.codeHash, code, "only the hash is kept");
  assert.equal(riders.codeMatches(rider, "reset", code), true);
  assert.equal(riders.codeMatches(rider, "invite", code), false, "a reset code is not an invitation");
  assert.equal(riders.codeMatches(rider, "reset", "000000" === code ? "111111" : "000000"), false);
  rider.codeExpiresAt = new Date(Date.now() - 1000);
  assert.equal(riders.codeMatches(rider, "reset", code), false, "expired");
  riders.clearCode(rider);
  assert.equal(riders.codeMatches(rider, "reset", code), false);
});

const order = (over = {}) => ({
  _id: "64b0000000000000000000aa",
  orderNumber: "10482",
  orderStatus: "Ready",
  createdAt: new Date(),
  customerDetails: { name: "John Smith", phone: "9876543210" },
  deliveryAddress: { line1: "12 Park Street", line2: "Flat 3", city: "Kolkata", postalCode: "700016", lat: 22.55, lng: 88.35, distanceKm: 3.24 },
  items: [{ name: "Biryani", quantity: 2, addons: [], modifierSelections: [] }, { name: "Gone", quantity: 1, status: "cancelled" }],
  bills: { subtotal: 800, tax: 40, deliveryFee: 30, totalWithTax: 845, discount: 25 },
  payments: [{ method: "online", status: "paid", amount: 845 }],
  paymentMethod: "online",
  delivery: { riderId: "64b000000000000000000001", riderName: "Rahul Kumar", status: "accepted" },
  ...over,
});

test("a live delivery shows the rider the customer's phone, address and a Maps link", () => {
  const v = riders.deliveryView(order());
  assert.equal(v.stage, "accepted");
  assert.equal(v.customer.phone, "9876543210");
  assert.equal(v.customer.phoneMasked, "98XXXXXX10");
  assert.match(v.address.navUrl, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=22\.55%2C88\.35/);
  assert.equal(v.address.text, "Flat 3, 12 Park Street, Kolkata, 700016");
  assert.equal(v.distanceKm, 3.2);
  assert.deepEqual(v.items.map((i) => i.name), ["Biryani"], "struck-off lines are not delivered");
  assert.equal(v.foodReady, true);
});

test("after delivery the rider keeps the area and a masked phone only", () => {
  const v = riders.deliveryView(order({ orderStatus: "Delivered", delivery: { riderId: "x", status: "delivered" } }));
  assert.equal(v.stage, "delivered");
  assert.equal(v.customer.phone, undefined);
  assert.equal(v.customer.phoneMasked, "98XXXXXX10");
  assert.equal(v.address.navUrl, undefined);
  assert.equal(v.address.line1, undefined);
  assert.equal(v.address.text, "Kolkata 700016");
});

test("a cancelled order reads as cancelled to the rider, whatever the delivery said", () => {
  const v = riders.deliveryView(order({ orderStatus: "Cancelled" }));
  assert.equal(v.stage, "cancelled");
  assert.equal(v.customer.phone, undefined);
});

test("cash to collect: none when paid online, the full bill when not", () => {
  assert.equal(riders.deliveryView(order()).collect, 0);
  const cash = riders.deliveryView(order({ payments: [{ method: "cash", status: "pending", amount: 845 }], paymentMethod: "cash" }));
  assert.equal(cash.collect, 845);
  assert.equal(cash.paidOnline, false);
});

test("the customer sees the rider's first name and stage, never their phone", () => {
  assert.deepEqual(riders.customerRiderView(order({ delivery: { riderId: "x", riderName: "Rahul Kumar", status: "on_the_way" } })), { name: "Rahul", stage: "on_the_way" });
  assert.equal(riders.customerRiderView(order({ delivery: { riderId: null, status: "" } })), null);
  assert.equal(riders.customerRiderView(order({ delivery: { riderId: "x", status: "cancelled" } })), null);
});

test("SOURCE: every rider-facing route but sign-in needs the rider's session, and every step an active account", () => {
  const src = SRC("routes/riderRoute.js");
  const guard = src.indexOf("router.use(riders.requireRider)");
  assert.ok(guard > 0);
  for (const open of ['"/auth/signup"', '"/auth/login"', '"/auth/reset-pin"', '"/auth/logout"']) {
    assert.ok(src.indexOf(open) < guard, `${open} is before the guard`);
  }
  for (const p of ['"/me"', '"/availability"', '"/deliveries"', '"/push"']) assert.ok(src.indexOf(p) > guard, `${p} is behind the guard`);
  assert.match(src, /const act = \(fn, guard = riders\.requireActiveRider\) => \[\s*stepLimiter,\s*guard,/);
  // Only arrived and delivered let a suspended rider finish a ride already under way.
  assert.equal((src.match(/, finishingOnly\)\);/g) || []).length, 2);
  assert.match(src, /"\/deliveries\/:id\/arrived", \.\.\.act\(.*finishingOnly\)\);/);
  assert.match(src, /"\/deliveries\/:id\/delivered", \.\.\.act\(.*finishingOnly\)\);/);
  assert.match(src, /router\.post\("\/availability", riders\.requireActiveRider/);
});

test("SOURCE: a rider only reads their own store's orders that are theirs", () => {
  const src = SRC("services/riders.js");
  assert.match(src, /Order\.findOne\(\{ _id: orderId, storeId: rider\.storeId, "delivery\.riderId": rider\._id, isDeleted: \{ \$ne: true \} \}\)/);
  const routes = SRC("routes/riderRoute.js");
  assert.match(routes, /const base = \{ storeId: req\.rider\.storeId, "delivery\.riderId": req\.rider\._id/);
});

test("SOURCE: assign and every step are one conditional write, so two can never both win", () => {
  const src = SRC("services/riders.js");
  // Assign lands only while nobody is working on the order.
  // null: a skipped ("Assign later") order has a delivery with no status yet, and must still be assignable.
  assert.match(src, /"delivery\.status": \{ \$in: \[null, "", "assigned", "cancelled"\] \}/);
  // The auto-complete timer never closes an order a rider is still working on.
  assert.match(SRC("services/autoReadyService.js"), /"delivery\.status": \{ \$nin: require\("\.\.\/models\/riderModel"\)\.OPEN_DELIVERY_STATUSES \}/);
  // Each rider step names the rider and the stage it moves from.
  assert.match(src, /\{ _id: order\._id, "delivery\.riderId": rider\._id, "delivery\.status": \{ \$in: from \}/);
  // The till's rider list: an order's riderId is replaced, never pushed.
  assert.doesNotMatch(src, /\$push: \{ "delivery\.riderId"/);
});

test("SOURCE: the till's rider routes are its own store's, and managing riders needs a manager", () => {
  const src = SRC("routes/storeRiderRoute.js");
  assert.match(src, /router\.use\(isVerifiedUser\)/);
  const mgr = src.indexOf("router.use(requireManager)");
  assert.ok(mgr > src.indexOf('"/orders/:orderId/assign"'), "any till can assign");
  for (const p of ['"/:id/approve"', '"/:id/suspend"', '"/:id/deactivate"', '"/:id/reset-pin"', 'router.post("/", ']) {
    assert.ok(src.indexOf(p) > mgr, `${p} needs a manager`);
  }
  assert.match(src, /Rider\.findOne\(\{ _id: id, storeId, restaurantId: req\.user\.restaurantId \}\)/);
});

test("SOURCE: PINs are bcrypt hashes; the raw PIN is never stored", () => {
  const model = SRC("models/riderModel.js");
  assert.match(model, /pinHash: \{ type: String/);
  assert.doesNotMatch(model, /\bpin: \{/);
  assert.match(SRC("services/riders.js"), /const hashPin = \(pin\) => bcrypt\.hash\(String\(pin\), 10\)/);
});

test("SOURCE: rider sockets join only their own room", () => {
  const src = SRC("services/socket.js");
  assert.match(src, /if \(socket\.rider\) \{\s*socket\.join\(`rider:\$\{socket\.rider\.id\}`\);\s*return;\s*\}/);
});

const ROOT = (f) => fs.readFileSync(path.join(__dirname, "..", "..", f), "utf8");

test("DEPLOY: knotkitchen.com/rider serves the app, its API and its socket, same-origin", () => {
  const caddy = ROOT("deploy/Caddyfile");
  assert.match(caddy, /handle \/rider\/api\/\* \{\s*uri replace \/rider\/api\/ \/api\/rider\/ 1\s*reverse_proxy pos-api:8000/);
  assert.match(caddy, /handle \/rider\/socket\.io\/\* \{\s*uri replace \/rider\/socket\.io\/ \/socket\.io\/ 1\s*reverse_proxy pos-api:8000/);
  assert.match(caddy, /handle \/rider\/\* \{\s*reverse_proxy pos-web:80/);
  // The API one must come before the app one in the same site block.
  assert.ok(caddy.indexOf("handle /rider/api/*") < caddy.indexOf("handle /rider/* {"));
  const nginx = ROOT("pos-frontend/nginx.conf");
  assert.match(nginx, /location \/rider\/ \{\s*try_files \$uri \$uri\/ \/rider\/index\.html;/);
  assert.match(nginx, /location = \/rider\/rider-sw\.js \{\s*add_header Cache-Control "no-cache";/);
  assert.match(ROOT("pos-frontend/Dockerfile"), /npm run build:rider/);
  assert.match(ROOT(".github/workflows/ci.yml"), /run: npm run build:rider/);
});
