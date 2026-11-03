const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { seal, open } = require("./secretBox");

/**
 * Single sign-on from CSD into KKMDM (owner, 2026-11-03: KKMDM is used from
 * inside CSD). CSD signs a one-minute assertion for the signed-in staff
 * member with its own private key (ES256); KKMDM checks it with the public
 * key published at GET /api/csd/kkmdm/sso-key (kkmdm/server/src/lib/csdSso.js).
 * KKMDM can verify but never mint one.
 *
 * The key pair is made on first use and kept in the `platformkeys`
 * collection, the private half sealed (services/secretBox).
 */

const KEY_NAME = "kkmdm-sso";
let cached = null; // { privateKey, publicKey }

const keys = async () => {
  if (cached) return cached;
  const col = mongoose.connection.db.collection("platformkeys");
  let row = await col.findOne({ name: KEY_NAME });
  if (!row) {
    const pair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const fresh = {
      name: KEY_NAME,
      publicKey: pair.publicKey.export({ type: "spki", format: "pem" }),
      privateKey: seal(pair.privateKey.export({ type: "pkcs8", format: "pem" })),
      createdAt: new Date(),
    };
    try {
      await col.insertOne(fresh);
      row = fresh;
    } catch {
      row = await col.findOne({ name: KEY_NAME }); // another process made it first
    }
  }
  cached = { privateKey: open(row.privateKey), publicKey: row.publicKey };
  return cached;
};

/** CSD's public key, as KKMDM fetches it. */
const publicKey = async () => (await keys()).publicKey;

/**
 * A one-minute, single-use assertion for this CSD staff member. `reauth`:
 * they have just confirmed their password and code, so KKMDM treats it as a
 * fresh sign-in for destructive actions.
 */
const assertionFor = async (staff, { reauth = false } = {}) => {
  const { privateKey } = await keys();
  return jwt.sign(
    { sub: String(staff._id), staffId: staff.staffId, name: staff.fullName, role: staff.role, reauth: reauth === true, jti: crypto.randomUUID() },
    privateKey,
    { algorithm: "ES256", audience: "kkmdm", issuer: "csd", expiresIn: 60 },
  );
};

/** Where CSD's screens reach KKMDM's API. */
const kkmdmUrl = () =>
  (process.env.KKMDM_PUBLIC_URL || (process.env.NODE_ENV === "production" ? "https://mdm.knotkitchen.com" : "http://localhost:8100")).replace(/\/$/, "");

module.exports = { publicKey, assertionFor, kkmdmUrl };
