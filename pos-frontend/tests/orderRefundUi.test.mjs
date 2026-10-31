import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A part of a gateway payment can go back without cancelling the order
// (owner, 2026-10-31: "for total 20rs paid I can return 5rs").
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const orders = fs.readFileSync(path.join(__dirname, "..", "src/pages/Orders.jsx"), "utf8");

test("a gateway-paid order that is not cancelled offers Refund, up to what is left", () => {
  assert.match(orders, /\{!isCancelled\(selected\.orderStatus\) && selected\.paymentKind === "gateway" && selected\.paid && \(/);
  assert.match(orders, /\{Number\(selected\.refundedTotal\) > 0 \? "Refund more" : "Refund"\} \(up to \{money\(selected\.refundableAmount\)\}\)/);
  // The same reason/amount modal as a cancelled order's refund, and the same manager rule.
  assert.match(orders, /disabled=\{voidMutation\.isPending \|\| !isManager\(user\)\}\s*onClick=\{\(\) => askReason\("refund", selected\)\}\s*title=\{isManager\(user\) \? "Send part or all of the payment back/);
});
