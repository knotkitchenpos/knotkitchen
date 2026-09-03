/**
 * Staff sign-in and the deleted-phone release.
 *
 * Two defects, both of which made Manage Staff unusable in practice:
 *
 *  1. Staff were created with bcrypt(phone + "KnotKitchenPass") assigned to
 *     `password`, which the pre-save hook then hashed AGAIN. The result was
 *     neither guessable nor knowable, so a new staff member could never sign
 *     in at all. They now get an unusable random value flagged as a
 *     placeholder, and choose their own password on first sign-in.
 *
 *  2. Deleting a staff member soft-deletes the row, but the unique index on
 *     (storeId, phone) counted deleted rows, so the number stayed occupied
 *     and re-adding the same person failed with a duplicate-key error.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const User = require("../models/userModel");

test("REGRESSION: phone uniqueness applies to LIVE users only", () => {
  // With deleted rows still indexed, a released number could never be reused.
  const [, options] = User.schema.indexes().find(([keys]) => keys.storeId && keys.phone);
  assert.equal(options.unique, true);
  assert.deepEqual(
    options.partialFilterExpression.isDeleted,
    { $eq: false },
    "deleted rows must be excluded from the unique index",
  );
});

test("the index uses $eq, because partial filters cannot express $ne", () => {
  // If this is ever written as { $ne: true } Mongo rejects the index outright
  // and the collection silently loses its uniqueness guarantee.
  const [, options] = User.schema.indexes().find(([keys]) => keys.storeId && keys.phone);
  const filter = options.partialFilterExpression;
  assert.ok(!JSON.stringify(filter).includes("$ne"), "partialFilterExpression must not use $ne");
});

test("a new staff account carries the placeholder flag", () => {
  // This is what routes /store/login to Create Password instead of failing
  // the person on a password that does not exist.
  const staff = new User({
    name: "Test Staff",
    address: "Staff Address",
    phone: "9876543210",
    password: "irrelevant-random",
    role: "Staff",
    storeId: "123456",
    passwordPlaceholder: true,
  });
  assert.equal(staff.passwordPlaceholder, true);
});

test("passwordPlaceholder defaults to false for everyone else", () => {
  const owner = new User({
    name: "Owner",
    address: "A",
    phone: "9000000000",
    password: "chosen-by-a-human",
    role: "Owner",
    storeId: "123456",
  });
  assert.equal(owner.passwordPlaceholder, false);
});

test("REGRESSION: hashing a password twice makes it unusable", async () => {
  // Staff creation assigned bcrypt(phone + "KnotKitchenPass") to `password`,
  // and the pre-save hook hashed that AGAIN. This is why the result matched
  // nothing anyone could ever type.
  const bcrypt = require("bcrypt");
  const plain = "plain-text-password";

  const hashedOnce = await bcrypt.hash(plain, 4);
  assert.equal(await bcrypt.compare(plain, hashedOnce), true, "one hash verifies");

  const hashedTwice = await bcrypt.hash(hashedOnce, 4);
  assert.equal(await bcrypt.compare(plain, hashedTwice), false, "two hashes never verify");
});
