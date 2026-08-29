const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

/**
 * Storage for restaurant compliance documents (GST certificates, FSSAI
 * licences, PAN/KYC, signed agreements).
 *
 * Deliberately NOT the shared media storage in services/storage/. That
 * abstraction exists to serve menu photos to the public web: app.js mounts
 * `/uploads` with express.static, no authentication and
 * `Cache-Control: public, immutable`, and the S3/Cloudinary drivers likewise
 * return publicly fetchable URLs. Putting a customer's PAN card through it
 * would expose their KYC at a guessable URL to anyone who asks.
 *
 * These files therefore live in their own directory that nothing serves
 * statically, and reach the browser only by streaming through an
 * authenticated CSD route.
 */

const DOCUMENTS_DIR =
  process.env.CSD_DOCUMENTS_DIR || path.join(__dirname, "..", "csd-documents");

/** 20 MB. Large enough for a scanned multi-page licence, small enough to bound disk. */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Accepted types. An allow-list, not a block-list: the point is to keep
 * anything a browser might execute (HTML, SVG with script, JS) out of a store
 * that CSD staff will later open in their own browser.
 */
const ALLOWED_MIME = new Map([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
]);

/**
 * Sniff the real type from the leading bytes rather than trusting a declared
 * content-type, which is attacker-controlled when the bytes come from another
 * system.
 */
const sniffMime = (buffer) => {
  if (!buffer || buffer.length < 12) return null;
  const b = buffer;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf"; // %PDF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.slice(0, 4).toString("ascii") === "RIFF" && b.slice(8, 12).toString("ascii") === "WEBP")
    return "image/webp";
  if (b.slice(4, 8).toString("ascii") === "ftyp" && b.slice(8, 12).toString("ascii").startsWith("hei"))
    return "image/heic";
  return null;
};

/** `<storeId>/<random>.<ext>` — random, so a key can never be guessed. */
const buildKey = (storeId, mime) =>
  `${storeId}/${crypto.randomBytes(16).toString("hex")}.${ALLOWED_MIME.get(mime)}`;

/** Resolve a key to a path, refusing anything that escapes the root. */
const resolveKey = (storageKey) => {
  const root = path.resolve(DOCUMENTS_DIR);
  const abs = path.resolve(root, storageKey);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error("Invalid document path.");
  }
  return abs;
};

/**
 * @returns {{ storageKey, mimeType, size, checksum }}
 * @throws  on an empty file, an oversized file, or a type not on the allow-list
 */
const save = async ({ buffer, storeId }) => {
  if (!buffer?.length) throw new Error("The file is empty.");
  if (buffer.length > MAX_BYTES) {
    throw new Error(`The file is larger than ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`);
  }

  const mimeType = sniffMime(buffer);
  if (!mimeType) {
    throw new Error("Only PDF, JPEG, PNG, WebP or HEIC files are accepted.");
  }

  const storageKey = buildKey(String(storeId), mimeType);
  const abs = resolveKey(storageKey);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  // 0600: readable only by the service account that wrote it.
  await fs.writeFile(abs, buffer, { mode: 0o600 });

  return {
    storageKey,
    mimeType,
    size: buffer.length,
    // Lets a later import detect it already holds an identical file.
    checksum: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
};

const read = async (storageKey) => fs.readFile(resolveKey(storageKey));

const remove = async (storageKey) => {
  if (!storageKey) return;
  await fs.unlink(resolveKey(storageKey)).catch(() => {});
};

module.exports = { save, read, remove, sniffMime, DOCUMENTS_DIR, MAX_BYTES, ALLOWED_MIME };
