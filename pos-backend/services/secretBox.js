/**
 * Encryption at rest for stored gateway credentials.
 *
 * The fields are called `keySecretEncrypted` / `clientSecretEncrypted` and
 * held plain Base64. That is not encryption — it is an encoding with a public
 * algorithm and no key — so anyone with read access to the database had the
 * plaintext secret. The name has been lying since the field was added.
 *
 * That was survivable while nothing populated those fields. It stops being
 * survivable the moment a live payment secret goes in one.
 *
 * Format written:  v1:<iv>:<tag>:<ciphertext>   (each part Base64)
 * AES-256-GCM, random 12-byte IV per value, authentication tag kept.
 *
 * Backward compatible in BOTH directions, on purpose:
 *
 *   - `open()` accepts a legacy Base64 value and returns it decoded, so every
 *     credential already stored keeps working with no migration and no
 *     downtime. Re-saving one in Settings upgrades it in place.
 *
 *   - with no CREDENTIALS_SECRET configured, `seal()` falls back to the old
 *     Base64 encoding rather than throwing. A missing key must not take
 *     payments offline; it degrades to exactly the behaviour we had before.
 *     It says so, loudly, once per process.
 */

const crypto = require("crypto");
const config = require("../config/config");

const PREFIX = "v1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

let warned = false;

/**
 * A 32-byte key from whatever the operator configured.
 *
 * Hashed rather than used raw so any passphrase length works, and so a short
 * or low-entropy secret still produces a well-formed key — it does not make a
 * weak passphrase strong, but it does stop the cipher throwing at runtime in
 * front of a customer.
 */
const keyFor = () => {
  const raw = config.credentialsSecret;
  if (!raw) return null;
  return crypto.createHash("sha256").update(String(raw)).digest();
};

const warnOnce = () => {
  if (warned) return;
  warned = true;
  console.warn(
    "[secretBox] CREDENTIALS_SECRET is not set. Stored gateway secrets are " +
      "Base64-encoded, NOT encrypted. Set it to encrypt them at rest.",
  );
};

/** Encrypt for storage. Falls back to legacy Base64 when no key is set. */
const seal = (plaintext) => {
  const value = String(plaintext ?? "");
  if (!value) return "";

  const key = keyFor();
  if (!key) {
    warnOnce();
    return Buffer.from(value, "utf-8").toString("base64");
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(value, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [PREFIX, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
};

/**
 * Decrypt a stored value.
 *
 * Returns "" rather than throwing on anything it cannot open — a credential
 * that will not decrypt must read as "not configured" so the caller falls
 * through to the platform gateway, not as an exception in the middle of a
 * customer's checkout.
 */
const open = (stored) => {
  const value = String(stored ?? "");
  if (!value) return "";

  // Legacy: plain Base64, written before this module existed.
  if (!value.startsWith(`${PREFIX}:`)) {
    try {
      return Buffer.from(value, "base64").toString("utf-8");
    } catch {
      return "";
    }
  }

  try {
    const [, ivB64, tagB64, ctB64] = value.split(":");
    if (!ivB64 || !tagB64 || !ctB64) return "";
    const key = keyFor();
    if (!key) {
      // Encrypted with a key we no longer have. Silence here would look like
      // "no gateway configured" and be very hard to diagnose.
      console.warn("[secretBox] a stored secret is encrypted but CREDENTIALS_SECRET is not set.");
      return "";
    }
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64")),
      decipher.final(),
    ]).toString("utf-8");
  } catch {
    // Wrong key, or the value was tampered with — GCM's tag check catches
    // both. Either way there is no usable credential here.
    return "";
  }
};

/** Is this value actually encrypted, or still legacy Base64? */
const isSealed = (stored) => String(stored ?? "").startsWith(`${PREFIX}:`);

/** Whether encryption at rest is switched on at all. */
const isEnabled = () => Boolean(keyFor());

module.exports = { seal, open, isSealed, isEnabled, PREFIX };
