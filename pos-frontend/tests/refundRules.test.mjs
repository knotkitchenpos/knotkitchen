import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = (p) => fs.readFileSync(path.join(here, "..", p), "utf8");

test("the Refund button exists only on a cancelled order, and only in the states the backend allows", () => {
  const page = SRC("src/pages/Orders.jsx");
  const block = page.slice(page.indexOf("{isCancelled(selected.orderStatus) ? ("), page.indexOf("<I.x s={16} /> Cancel"));
  assert.match(block, /selected\.refundStatus === REFUND_STATUS\.REFUNDED/);
  assert.match(block, /selected\.refundStatus === REFUND_STATUS\.REFUND_PENDING/);
  assert.match(block, /askReason\("refund", selected\)/);
  assert.equal((page.match(/askReason\("refund"/g) || []).length, 1, "one way in, inside the cancelled branch");
  assert.match(block, /Refund Pending/);
  assert.match(block, /Retry Refund/);
  // A cancelled cash or counter-UPI order renders nothing: NOT_APPLICABLE falls through to null.
  assert.match(block, /\) : null/);
  assert.ok(!/isSettled\(selected\.orderStatus\) \? \(\s*<button[^]*?Refund/.test(page), "no refund on an active order");
});

test("a paid order can be cancelled; the money is handled afterwards, not by the cancel", () => {
  const page = SRC("src/pages/Orders.jsx");
  assert.match(page, /disabled=\{isRefunded\(selected\.orderStatus\) \|\| voidMutation\.isPending\}/);
});

test("the owner sends an amount (all or part of what is left); no reason on a refund", () => {
  const api = SRC("src/https/index.js");
  assert.match(api, /export const refundOrder = \(\{ orderId, amount \}\) => axiosWrapper\.post\(`\/api\/order\/\$\{orderId\}\/refund`, \{ amount \}\)/);
  assert.match(api, /export const syncRefund = \(orderId\) => axiosWrapper\.post\(`\/api\/order\/\$\{orderId\}\/refund\/sync`\)/);
  const modal = SRC("src/components/orders/ReasonModal.jsx");
  assert.match(modal, /type="number"/, "an amount field");
  assert.match(modal, /amount <= left \+ 0\.005/, "never more than what is left");
  assert.match(modal, /onConfirm\(refund \? \{ amount \} : \{ reason \}\)/);
  assert.match(modal, /order\?\.refundableAmount/);
  const page = SRC("src/pages/Orders.jsx");
  assert.match(page, /disabled=\{voidMutation\.isPending \|\| !isOwner\(user\)\}/, "owner only");
  assert.match(modal, /through Cashfree/);
});

test("the payment kind and refund state shown come from the backend", () => {
  const page = SRC("src/pages/Orders.jsx");
  assert.match(page, /selected\.paymentKindLabel/);
  assert.match(page, /REFUND_STATUS_LABELS\[selected\.refundStatus\]/);
  const consts = SRC("src/constants/orderStatus.js");
  for (const s of ["NOT_APPLICABLE", "NOT_REFUNDED", "REFUND_PENDING", "REFUNDED", "REFUND_FAILED"]) {
    assert.match(consts, new RegExp(`${s}: "${s}"`));
  }
});

test("REGRESSION: a till whose socket was refused signs back in and reconnects", () => {
  // socket.io does not retry a handshake the server's auth middleware refused,
  // and the socket signs in with the 15-minute access cookie. Without this a
  // till went deaf after any API restart: no new-order card, no waiter call.
  const src = fs.readFileSync(new URL("../src/socket.js", import.meta.url), "utf8");
  assert.match(src, /socket\.on\("connect_error"/);
  assert.match(src, /if \(!current\.active\) reviveAfterRefusal\(current\)/);
  assert.match(src, /axiosWrapper\.post\("\/api\/user\/refresh"/);
  assert.match(src, /s\.connect\(\)/);
  assert.match(src, /visibilitychange/);
});

test("REGRESSION: the Added Items card follows what another till decided", () => {
  // Cancelled on the laptop, still ringing on the phone: the card was a frozen
  // copy of the diner's request and listened for nothing else.
  const src = fs.readFileSync(new URL("../src/components/dashboard/AddedItemsPopup.jsx", import.meta.url), "utf8");
  assert.match(src, /socket\.on\("onlineOrder:status", onOrderChanged\)/);
  assert.match(src, /\.filter\(\(i\) => i\.status === "pending"\)/);
  assert.match(src, /prev\.filter\(\(p\) => p\.orderId !== orderId\)/, "nothing left pending: the card goes");
  assert.match(src, /socket\.on\("connect", resyncAll\)/);
  const page = fs.readFileSync(new URL("../src/pages/OrderOnline.jsx", import.meta.url), "utf8");
  assert.match(page, /paymentInfo\.needsPhone \?/);
});
