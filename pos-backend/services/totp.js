const crypto = require("crypto");

/**
 * Authenticator-app codes (TOTP, RFC 6238: HMAC-SHA1, 6 digits, 30 s), for
 * CSD two-factor sign-in (security audit, 2026-11-03). Google Authenticator,
 * Microsoft Authenticator, Authy and the like all read the otpauth:// link.
 * Built on node:crypto so no dependency holds the second factor.
 */

const STEP_S = 30;
const DIGITS = 6;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const toBase32 = (buf) => {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
};

const fromBase32 = (str) => {
  const clean = String(str || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

/** A new random secret, base32 as authenticator apps take it. */
const newSecret = () => toBase32(crypto.randomBytes(20));

/** The code for time step `step` (seconds since 1970 / 30). */
const codeAt = (secret, step) => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac("sha1", fromBase32(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const n = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(n).padStart(DIGITS, "0");
};

const stepNow = (now = Date.now()) => Math.floor(now / 1000 / STEP_S);

/**
 * The time step `code` belongs to, allowing one step either side for a phone
 * clock a little off; null when it is not a current code. Callers keep the
 * last step used so the same code cannot be used twice.
 */
const matchStep = (secret, code, { now = Date.now(), window = 1 } = {}) => {
  const given = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(given) || !secret) return null;
  const s = stepNow(now);
  for (let d = -window; d <= window; d += 1) {
    const want = Buffer.from(codeAt(secret, s + d));
    if (crypto.timingSafeEqual(want, Buffer.from(given))) return s + d;
  }
  return null;
};

/** The otpauth:// link an authenticator app scans: "KnotKitchen CSD (name@knotkitchen.com)". */
const otpauthUrl = (secret, account, issuer = "KnotKitchen CSD") =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_S}`;

module.exports = { newSecret, codeAt, matchStep, stepNow, otpauthUrl, toBase32, fromBase32 };
