/**
 * 005 - let staff created before the sign-in fix set a password.
 *
 * Until now addStaffMember stored bcrypt(phone + "KnotKitchenPass") in
 * `password`, and the pre-save hook hashed that string a SECOND time. The
 * result matched nothing anyone could type, so no staff member has ever been
 * able to sign in -- and, because the inner hash used a random salt, the
 * original value cannot be recovered.
 *
 * New staff are now flagged `passwordPlaceholder: true`, which routes them to
 * Create Password on first sign-in. Staff created earlier carry `false`, so
 * without this they would be locked out permanently: no usable password, and
 * no route to choosing one.
 *
 * This flips every LIVE role:"Staff" user to `passwordPlaceholder: true`.
 * That is safe rather than an account-takeover risk, because there was no way
 * for any of these accounts to have a password its owner knows -- the flow to
 * set one did not exist before this release, and sign-in never succeeded.
 * Owner/Admin/Manager accounts are untouched; only addStaffMember creates the
 * "Staff" role.
 *
 * Raw driver, no Mongoose model -- see 004 for why.
 *
 * Idempotent - safe to re-run.
 */
const mongoose = require("mongoose");
const config = require("../config/config");

const run = async () => {
  await mongoose.connect(config.databaseURI);
  const users = mongoose.connection.collection("users");

  const candidates = await users
    .find({ role: "Staff", isDeleted: { $ne: true }, passwordPlaceholder: { $ne: true } })
    .project({ storeId: 1, phone: 1, name: 1 })
    .toArray();

  if (candidates.length === 0) {
    console.log("No locked-out staff accounts found - nothing to do.");
    await mongoose.disconnect();
    return;
  }

  console.log(`Unlocking ${candidates.length} staff account(s):`);
  for (const s of candidates) {
    console.log(`   store ${s.storeId}  ${s.phone}  ${s.name || ""}`);
  }

  const result = await users.updateMany(
    { role: "Staff", isDeleted: { $ne: true }, passwordPlaceholder: { $ne: true } },
    { $set: { passwordPlaceholder: true } },
  );

  console.log(`\nUpdated ${result.modifiedCount} account(s).`);
  console.log("They will be asked to create a password on their next sign-in.");
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
