const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { readEntry, WORDING, TEMPLATE } = require("../controllers/waitlistController");
const { flat } = require("../services/waTemplates");

const src = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

/** Owner, 2026-11-17: a waitlist for busy hours. */
test("a waitlist entry needs a name and a sane party size; the phone is optional but real", () => {
  assert.throws(() => readEntry({ name: " ", partySize: 2 }), /guest's name/);
  assert.throws(() => readEntry({ name: "A", partySize: 0 }), /between 1 and 99/);
  assert.throws(() => readEntry({ name: "A", partySize: 2, phone: "12345" }), /10-digit/);
  assert.deepEqual(readEntry({ name: " Asha ", partySize: "4", phone: "+91 98765 43210", note: " window " }), { name: "Asha", phone: "9876543210", partySize: 4, note: "window" });
  assert.equal(readEntry({ name: "A", partySize: 2 }).phone, "");
});

test("the table-ready WhatsApp takes 3 values, never empty or multi-line", () => {
  assert.equal(TEMPLATE, "kk_table_ready");
  assert.equal((WORDING.match(/\{\{\d\}\}/g) || []).length, 3);
  assert.equal(flat(""), "-");
  assert.equal(flat("a\n\tb     c"), "a b c");
});

test("wiring: POS plan only, live on every till, and nothing is sent unless the template is approved", () => {
  assert.match(src("app.js"), /app\.use\("\/api\/waitlist", require\("\.\/routes\/waitlistRoute"\)\);/);
  assert.doesNotMatch(src("middlewares/planGate.js"), /\/api\/waitlist/, "default-deny keeps it off the Billing plan");
  assert.match(src("controllers/waitlistController.js"), /emitToRestaurant\(String\(restaurantId\), "waitlist:changed", \{\}\)/);
  assert.match(src("services/waTemplates.js"), /if \(!status\.ready\) return \{ sent: false, reason: status\.reason \};/);
});
