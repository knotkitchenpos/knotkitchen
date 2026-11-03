#!/usr/bin/env node
/**
 * Recover a KKMDM admin account from the server's own terminal: a lost phone
 * (two-factor sign-in is required in production), a lockout, or a forgotten
 * password. Without this, losing the only Super Admin's phone would lock
 * everyone out of KKMDM (security recheck, 2026-11-03).
 *
 *   docker compose -f deploy/docker-compose.yml exec kkmdm node src/reset-admin.js <email>
 *
 * It turns 2FA off (set up again at the next sign-in), unlocks the account,
 * re-enables it, signs it out on every device, and sets a new password typed
 * at a hidden prompt, twice. The password never appears on screen, in shell
 * history, in a command line or a log; there is no way to pass it as an
 * argument, on purpose. Only someone with access to the server can run it.
 */
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const config = require("./config");
const { AdminUser } = require("./models");
const { checkPassword } = require("./routes/auth");

/** Read one line from the terminal without echoing it. */
function hidden(prompt) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return reject(new Error("Run this in a terminal (docker compose exec ...), so the password can be typed hidden."));
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          return resolve(value);
        }
        if (ch === "\u0003") { stdin.setRawMode(false); stdout.write("\n"); process.exit(130); } // Ctrl+C
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

/** Clear 2FA, lockout and every session; set the new password's hash. Returns the admin's email. */
async function recover(email, password) {
  const weak = checkPassword(password);
  if (weak) throw new Error(weak);
  const admin = await AdminUser.findOne({ email: String(email).trim().toLowerCase() });
  if (!admin) {
    const all = await AdminUser.find({}, { email: 1 }).lean();
    throw new Error(`No admin "${email}". Admins: ${all.map((a) => a.email).join(", ") || "none"}`);
  }
  admin.passwordHash = await bcrypt.hash(password, 12);
  admin.totpEnabled = false;
  admin.totpSecretEnc = undefined;
  admin.failedLogins = 0;
  admin.lockedUntil = undefined;
  admin.disabled = false;
  admin.sessionVersion += 1;
  admin.sessions = [];
  await admin.save();
  return admin.email;
}

async function main() {
  const email = process.argv[2];
  if (!email) throw new Error("Usage: node src/reset-admin.js <email>");
  const first = await hidden(`New password for ${email}: `);
  const second = await hidden("Type it again: ");
  if (first !== second) throw new Error("The two passwords do not match.");
  await mongoose.connect(config.mongoUri, config.mongoDbName ? { dbName: config.mongoDbName } : {});
  try {
    const done = await recover(email, first);
    console.log(`${done}: new password set, two-factor sign-in off (set it up again at the next sign-in), unlocked, signed out everywhere.`);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { recover };
