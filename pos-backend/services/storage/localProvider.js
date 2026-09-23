const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const config = require("../../config/config");

/**
 * Local filesystem storage driver.
 *
 * Files are written to <uploadsDir>/<storeId>/<folder>/<uuid>.<ext>. The
 * per-store directory prefix mirrors the logical tenant isolation enforced in
 * the database, so a misconfigured static server still cannot mix stores.
 *
 * The only storage driver: media lives on the backend's own disk and is
 * served from /uploads (app.js).
 */

const UPLOADS_DIR = config.uploadsDir;

const EXT_BY_MIME = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

const buildKey = ({ storeId, folder, mimeType }) => {
  const ext = EXT_BY_MIME[mimeType] || "bin";
  const unique = crypto.randomUUID();
  // storeId/folder are validated upstream, but re-sanitize here to make path
  // traversal structurally impossible regardless of caller.
  const safeStore = String(storeId).replace(/[^a-zA-Z0-9_-]/g, "");
  const safeFolder = String(folder || "general").replace(/[^a-zA-Z0-9_-]/g, "");
  return `${safeStore}/${safeFolder}/${unique}.${ext}`;
};

const upload = async ({ buffer, mimeType, storeId, folder }) => {
  const storageKey = buildKey({ storeId, folder, mimeType });
  const absolutePath = path.join(UPLOADS_DIR, storageKey);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer);

  const url = `${config.mediaPublicBaseUrl}/${storageKey}`;

  return {
    storageKey,
    url,
    // The local driver has no transformation pipeline, so the thumbnail is the
    // same object. Cloud drivers return a genuinely resized derivative.
    thumbnailUrl: url,
    provider: "local",
  };
};

const remove = async (storageKey) => {
  if (!storageKey) return;
  // Reject anything that could escape the uploads root.
  const absolutePath = path.resolve(UPLOADS_DIR, storageKey);
  if (!absolutePath.startsWith(path.resolve(UPLOADS_DIR))) return;
  await fs.unlink(absolutePath).catch(() => {});
};

module.exports = { upload, remove };
