import test from "node:test";
import assert from "node:assert/strict";
import { riderText } from "./riderText.js";

test("the rider line says who has the order and what they're doing", () => {
  assert.equal(riderText(null), "");
  assert.equal(riderText({ name: "Rahul", stage: "assigned" }), "Rahul will deliver your order");
  assert.equal(riderText({ name: "Rahul", stage: "on_the_way" }), "Rahul is on the way with your order");
  assert.equal(riderText({ name: "Rahul", stage: "arrived" }), "Rahul has arrived");
  assert.equal(riderText({ name: "Rahul", stage: "delivered" }), "Delivered by Rahul");
  assert.equal(riderText({ name: "Rahul", stage: "cancelled" }), "");
});
