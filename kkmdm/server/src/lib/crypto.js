const crypto = require("crypto");
const config = require("../config");

/** URL-safe random token; 32 bytes = 256 bits, well over the 128-bit floor. */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** Only hashes of tokens and device secrets are stored. */
function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** AES-256-GCM for secrets that must be read back (technician OTP seeds). */
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", config.dataKey, iv);
  const data = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

function decrypt(blob) {
  const [iv, tag, data] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", config.dataKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

// ---- RFC 4226/6238 one-time codes (admin 2FA and technician OTP) ----

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
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
}

function base32Decode(str) {
  const clean = str.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("bad base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secretBuf, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", secretBuf).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h.readUInt32BE(off) & 0x7fffffff) % 10 ** digits).toString();
  return code.padStart(digits, "0");
}

function totp(secretB32, { step = 30, at = Date.now(), digits = 6 } = {}) {
  return hotp(base32Decode(secretB32), Math.floor(at / 1000 / step), digits);
}

/** Accepts the current step and one either side for clock drift. */
function verifyTotp(secretB32, code, { step = 30, window = 1 } = {}) {
  if (!/^\d{6}$/.test(String(code || ""))) return false;
  const now = Date.now();
  for (let w = -window; w <= window; w++) {
    if (totp(secretB32, { step, at: now + w * step * 1000 }) === String(code)) return true;
  }
  return false;
}

function newTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

module.exports = {
  randomToken, sha256, safeEqualHex, encrypt, decrypt,
  base32Encode, base32Decode, hotp, totp, verifyTotp, newTotpSecret,
};
