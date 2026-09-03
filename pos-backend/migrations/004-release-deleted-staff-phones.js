/**
 * 004 - release the phone numbers of deleted staff.
 *
 * Deleting a staff member soft-deletes the User row, but the unique index on
 * (storeId, phone) counted deleted rows too. The number therefore stayed
 * occupied forever, and re-adding the same person failed with a duplicate-key
 * error the API surfaced as "A record with that Store ID already exists".
 *
 * The index is now scoped to LIVE users via `isDeleted: { $eq: false }`.
 * partialFilterExpression does not support $ne, so a row with NO isDeleted
 * field is not indexed at all -- which would silently let two live users share
 * a number. This migration therefore:
 *
 *   1. backfills isDeleted:false on every row missing it, so nothing escapes
 *      the new index;
 *   2. reports any (storeId, phone) that is currently duplicated among LIVE
 *      users, because the unique index cannot be built while one exists;
 *   3. swaps the old index for the new one.
 *
 * Everything below goes through the RAW driver collection, never the Mongoose
 * model. Requiring the model would let Mongoose's autoIndex re-create whatever
 * index spec is compiled into the image this runs in -- which, on a container
 * built before this change, is precisely the old index we are dropping.
 *
 * Idempotent - safe to re-run.
 */
const mongoose = require("mongoose");
const config = require("../config/config");

const OLD_INDEX = "storeId_1_phone_1_unique";
const NEW_INDEX = "storeId_1_phone_1_live_unique";

const run = async () => {
  await mongoose.connect(config.databaseURI);
  const users = mongoose.connection.collection("users");

  // 1. Backfill, so every row is covered by the new partial filter.
  const backfilled = await users.updateMany(
    { isDeleted: { $exists: false } },
    { $set: { isDeleted: false } },
  );
  console.log(`Backfilled isDeleted:false on ${backfilled.modifiedCount} user(s).`);

  // 2. Refuse to build a unique index over data that already violates it.
  const dupes = await users
    .aggregate([
      { $match: { isDeleted: false, storeId: { $type: "string" }, phone: { $type: "string" } } },
      { $group: { _id: { storeId: "$storeId", phone: "$phone" }, n: { $sum: 1 }, ids: { $push: "$_id" } } },
      { $match: { n: { $gt: 1 } } },
    ])
    .toArray();

  if (dupes.length) {
    console.error(`\n! ${dupes.length} live (storeId, phone) pair(s) are duplicated:`);
    for (const d of dupes) {
      console.error(`   storeId ${d._id.storeId} phone ${d._id.phone} -> ${d.ids.length} users`);
    }
    console.error("\nResolve these before re-running; the unique index cannot be built over them.");
    await mongoose.disconnect();
    process.exit(1);
  }

  // 3. Swap the index.
  const names = (await users.indexes()).map((i) => i.name);

  if (names.includes(OLD_INDEX)) {
    await users.dropIndex(OLD_INDEX);
    console.log(`Dropped ${OLD_INDEX} (counted deleted rows).`);
  } else {
    console.log(`${OLD_INDEX} not present - nothing to drop.`);
  }

  if (!names.includes(NEW_INDEX)) {
    await users.createIndex(
      { storeId: 1, phone: 1 },
      {
        unique: true,
        partialFilterExpression: {
          storeId: { $type: "string" },
          phone: { $type: "string" },
          isDeleted: { $eq: false },
        },
        name: NEW_INDEX,
      },
    );
    console.log(`Created ${NEW_INDEX} (live users only).`);
  } else {
    console.log(`${NEW_INDEX} already present.`);
  }

  console.log("\nMigration complete. Deleted staff no longer hold their phone number.");
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
