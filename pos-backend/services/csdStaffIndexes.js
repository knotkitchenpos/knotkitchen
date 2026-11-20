/**
 * CSD staff email became optional (owner, 2026-11-20): staff sign in with
 * their phone, and new accounts are created without an email. The original
 * `email_1` index is unique but NOT sparse, so it counts a missing email as a
 * value and the second account without one would be refused as a duplicate.
 *
 * At boot, swap it for the sparse one the schema now declares. Raw driver
 * calls, idempotent, and a no-op once the index is sparse. The collection is
 * a handful of rows, so the rebuild is instant.
 */
const mongoose = require("mongoose");

const ensureStaffEmailIndex = async () => {
  const col = mongoose.connection.collection("csdstaffs");
  let indexes;
  try {
    indexes = await col.indexes();
  } catch (err) {
    if (err?.codeName === "NamespaceNotFound") return { changed: false }; // fresh database: Mongoose builds the right one
    throw err;
  }
  const current = indexes.find((i) => i.name === "email_1");
  if (current && current.unique && current.sparse) return { changed: false };
  if (current) await col.dropIndex("email_1");
  await col.createIndex({ email: 1 }, { unique: true, sparse: true, name: "email_1" });
  return { changed: true };
};

module.exports = { ensureStaffEmailIndex };
