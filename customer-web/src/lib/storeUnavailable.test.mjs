import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isStoreUnavailable } from "./storeUnavailable.js";

test("a locked, closed or website-off store reads as unavailable, not as an error", () => {
  assert.equal(isStoreUnavailable({ status: 403, code: "STORE_UNAVAILABLE" }), true);
  assert.equal(isStoreUnavailable({ status: 409, code: "ORDERING_PAUSED" }), true);
  // The bootstrap's 404 keeps the reason's message.
  assert.equal(
    isStoreUnavailable({ status: 404, message: "This restaurant's online store is temporarily unavailable. Please try again later." }),
    true,
  );
});

test("an unknown restaurant or a network failure is not 'unavailable'", () => {
  assert.equal(isStoreUnavailable(null), false);
  assert.equal(isStoreUnavailable({ status: 404, message: "We couldn't find this restaurant." }), false);
  assert.equal(isStoreUnavailable({ status: 0, message: "We couldn't load this restaurant's menu." }), false);
});
