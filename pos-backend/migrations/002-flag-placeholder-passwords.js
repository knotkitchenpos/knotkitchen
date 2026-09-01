/**
 * 002 — backfill User.passwordPlaceholder.
 *
 * Context: the CSD "Open POS" support handoff auto-bootstraps an Owner row
 * for a store nobody has signed into yet, giving it a random 32-byte password
 * and mustChangePassword=true. Because `password` is required:true on the
 * model, /store/status read that row as "this store already has a password"
 * and showed the restaurant manager a login form for a password that had
 * never been set. The fix marks such rows passwordPlaceholder=true.
 *
 * Rows created BEFORE that field existed need the same mark. The bootstrap is
 * the only code path that has ever set mustChangePassword=true, so it is an
 * exact identifier for them.
 *
 * Idempotent — safe to re-run.
 */
const mongoose = require("mongoose");
const config = require("../config/config");

const run = async () => {
  const User = require("../models/userModel");

  await mongoose.connect(config.databaseURI);

  const res = await User.updateMany(
    { mustChangePassword: true, passwordPlaceholder: { $ne: true } },
    { $set: { passwordPlaceholder: true } }
  );

  // Everyone else has, by definition, a password a person chose.
  const rest = await User.updateMany(
    { passwordPlaceholder: { $exists: false } },
    { $set: { passwordPlaceholder: false } }
  );

  console.log(
    `Migration complete. ${res.modifiedCount} placeholder account(s) flagged, ` +
      `${rest.modifiedCount} existing account(s) defaulted to false.`
  );
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
