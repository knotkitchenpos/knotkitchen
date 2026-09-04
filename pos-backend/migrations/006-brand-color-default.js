/**
 * 006 - move stores off the purple branding default.
 *
 * Restaurant.branding.primaryColor was seeded "#5b45b0", and that value drives
 * the QR / table-ordering site's theme. Every existing store therefore rendered
 * purple regardless of the KnotKitchen brand. The schema default is now the
 * logo's orange (#FD5302); this moves the stores already created.
 *
 * ONLY rows still holding the old default are touched. A store whose owner has
 * deliberately chosen a colour keeps it -- this is a default correction, not a
 * reset of anyone's branding.
 *
 * Raw driver, no Mongoose model: the model in the running image is what defines
 * the default, and going through it would rewrite far more than this one field.
 *
 * Idempotent - safe to re-run.
 */
const mongoose = require("mongoose");
const config = require("../config/config");

const OLD_DEFAULT = "#5b45b0";
const BRAND = "#FD5302";

const run = async () => {
  await mongoose.connect(config.databaseURI);
  const restaurants = mongoose.connection.collection("restaurants");

  // Case-insensitive: the seed is lowercase but a hand edit could differ.
  const filter = { "branding.primaryColor": new RegExp(`^${OLD_DEFAULT}$`, "i") };

  const affected = await restaurants
    .find(filter)
    .project({ name: 1, storeId: 1, "branding.primaryColor": 1 })
    .toArray();

  if (affected.length === 0) {
    console.log("No store is still on the purple default - nothing to do.");
    await mongoose.disconnect();
    return;
  }

  console.log(`Re-theming ${affected.length} store(s) from ${OLD_DEFAULT} to ${BRAND}:`);
  for (const r of affected) console.log(`   ${r.storeId}  ${r.name}`);

  const result = await restaurants.updateMany(filter, {
    $set: { "branding.primaryColor": BRAND },
  });

  console.log(`\nUpdated ${result.modifiedCount} store(s).`);

  const left = await restaurants.countDocuments(filter);
  console.log(left === 0 ? "No purple defaults remain." : `WARNING: ${left} still on the old default.`);

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
