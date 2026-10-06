import test from "node:test";
import assert from "node:assert/strict";
import reducer, { mobileDigits, setSessionId, updateTable } from "../src/redux/slices/customerSlice.js";

const init = () => reducer(undefined, { type: "@@init" });

test("REGRESSION: picking another table drops the last table's order", () => {
  // Tables > Add Item on GF-1, then seat GF-2: Finish used to add GF-2's items to GF-1.
  let s = init();
  s = reducer(s, updateTable({ table: { tableId: "gf1", tableNo: "GF-1", activeSessionId: "S1" } }));
  s = reducer(s, setSessionId("S1"));
  assert.equal(s.sessionId, "S1");
  s = reducer(s, updateTable({ table: { tableId: "gf2", tableNo: 3, displayId: "GF-2", capacity: 4 }, guests: 2 }));
  assert.equal(s.sessionId, "");
  assert.equal(s.table.displayId, "GF-2", "the cart names the table as the floor does");
  assert.equal(s.guests, 2, "the head count given when seating is kept");

  // A table that is running an order brings that order.
  s = reducer(s, updateTable({ table: { tableId: "gf3", session: { _id: "S3" } } }));
  assert.equal(s.sessionId, "S3");
});

test("a pasted mobile keeps its own 10 digits", () => {
  assert.equal(mobileDigits("919830012345"), "9830012345");
  assert.equal(mobileDigits("+91 98300 12345"), "9830012345");
  assert.equal(mobileDigits("098300 12345"), "9830012345");
  assert.equal(mobileDigits("98300"), "98300");
  assert.equal(mobileDigits("abc"), "");
});
