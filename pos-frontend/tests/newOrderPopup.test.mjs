import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const BE = (rel) => fs.readFileSync(path.join(__dirname, "..", "..", "pos-backend", rel), "utf8");

const POPUP = SRC("src/components/dashboard/NewOrderPopup.jsx");

/**
 * The new-order alert.
 *
 * The backend emitted `onlineOrder:created` for every customer-placed order,
 * but the only listener filtered on `source === "QR"` and dropped everything
 * else. A website order reached the till silently and was noticed whenever
 * somebody next reloaded the Orders page.
 */

test("REGRESSION: website orders raise the alert, not only QR", () => {
  assert.match(POPUP, /const ALERTING_SOURCES = new Set\(\["QR", "WEBSITE"\]\);/);
  assert.match(POPUP, /if \(!ALERTING_SOURCES\.has\(source\)\) return;/);

  // The old listener. If this shape comes back, website orders go silent again.
  assert.ok(
    !/!== "QR"\) return;/.test(POPUP),
    "a single-source filter is the bug this replaced",
  );
});

test("a POS order does not alert the person who typed it", () => {
  const set = POPUP.slice(POPUP.indexOf("ALERTING_SOURCES"), POPUP.indexOf("const SOURCE_LABEL"));
  assert.ok(!/"POS"/.test(set), "staff keystrokes are not a notification");
});

test("REGRESSION: the popup is the ONLY listener for created orders", () => {
  // Two components listening to the same event is how one order produced two
  // cards. QRTableOrderPopup was replaced, not left alongside this.
  assert.ok(
    !fs.existsSync(path.join(__dirname, "..", "src/components/dashboard/QRTableOrderPopup.jsx")),
    "the old popup must be gone, not merely unmounted",
  );
  assert.equal((SRC("src/App.jsx").match(/<NewOrderPopup \/>/g) || []).length, 1, "mounted exactly once");
  assert.ok(!/QRTableOrderPopup/.test(SRC("src/App.jsx")));
});

test("the same order twice does not stack two cards", () => {
  // Emits are retried, and a duplicated alert beeps twice for one customer.
  assert.match(POPUP, /if \(id && prev\.some\(\(p\) => String\(p\.orderId\) === id\)\) return prev;/);
});

test("it acts on the id the payload actually carries", () => {
  // emitOrderCreated sends `orderId`; reading `_id` found nothing and
  // silently dismissed the card without touching the order.
  assert.match(POPUP, /current\?\.orderId \|\| current\?\._id \|\| current\?\.id/);
  assert.match(BE("services/socket.js"), /orderId: String\(order\._id\),/);
});

test("the card floats and can be dragged out of the way", () => {
  // A modal backdrop stops the till working while a customer is at the
  // counter. This one floats and moves.
  assert.ok(!/fixed inset-0/.test(POPUP), "a full-screen backdrop blocks the till");
  assert.match(POPUP, /left-1\/2 top-1\/2/, "it opens in the middle");
  assert.match(POPUP, /translate\(-50%, -50%\) translate\(\$\{offset\.x\}px, \$\{offset\.y\}px\)/);

  // Pointer events, not mouse events: these are touchscreen tills. Capture
  // keeps the card following a finger that slides off it.
  for (const handler of ["onPointerDown", "onPointerMove", "onPointerUp", "onPointerCancel"]) {
    assert.match(POPUP, new RegExp(handler), `${handler} is required for touch dragging`);
  }
  assert.match(POPUP, /setPointerCapture\?\.\(e\.pointerId\)/);
  assert.match(POPUP, /touch-none/, "or the browser scrolls the page instead of dragging");
});

test("it keeps sounding until somebody decides", () => {
  assert.match(POPUP, /useAlertBeep\(queue\.length > 0\);/);
  // Dismissing without a decision would silence a waiting customer.
  assert.ok(!/onClick=\{dismiss\}/.test(POPUP), "there is no bare dismiss button");
  assert.match(POPUP, /decide\("cancel"\)/);
  assert.match(POPUP, /decide\("accept"\)/);
});

test("the backend really does emit for a website order", () => {
  // The listener is only half of it; this is the half that was already right.
  const storefront = BE("controllers/storefrontController.js");
  assert.match(storefront, /emitOrderCreated\(\{ restaurantId, outletId, storeId, order \}\);/);
  assert.match(BE("services/socket.js"), /emitEvent\("onlineOrder:created", payload, rooms\)/);
});
