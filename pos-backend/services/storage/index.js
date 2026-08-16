/**
 * Storage abstraction (§5).
 *
 * The rest of the codebase only ever talks to this module — never to a vendor
 * SDK directly. Swapping Cloudinary for S3/R2/Supabase means adding one driver
 * file and changing MEDIA_STORAGE_PROVIDER; no controller changes.
 *
 * Driver contract:
 *   upload({ buffer, fileName, mimeType, storeId, folder }) ->
 *       { storageKey, url, thumbnailUrl, provider }
 *   remove(storageKey) -> Promise<void>
 *
 * The default "local" driver writes to pos-backend/uploads and is served
 * statically, so the media library works with zero external configuration in
 * development.
 */
const config = require("../../config/config");

let cachedDriver = null;

const loadDriver = () => {
  if (cachedDriver) return cachedDriver;

  const provider = (config.mediaProvider || "local").toLowerCase();

  switch (provider) {
    case "cloudinary":
      cachedDriver = require("./cloudinaryProvider");
      break;
    case "s3":
    case "r2":
      // Cloudflare R2 is S3-API compatible, so it uses the same driver with a
      // custom endpoint.
      cachedDriver = require("./s3Provider");
      break;
    case "local":
    default:
      cachedDriver = require("./localProvider");
      break;
  }

  return cachedDriver;
};

const getProviderName = () => (config.mediaProvider || "local").toLowerCase();

const upload = (params) => loadDriver().upload(params);
const remove = (storageKey) => loadDriver().remove(storageKey);

module.exports = { upload, remove, getProviderName, loadDriver };
