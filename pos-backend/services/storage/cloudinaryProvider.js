const config = require("../../config/config");

/**
 * Cloudinary driver.
 *
 * The SDK is an OPTIONAL dependency: it is required lazily so the project
 * installs and runs without it unless MEDIA_STORAGE_PROVIDER=cloudinary.
 *   npm install cloudinary
 *
 * Cloudinary gives us CDN delivery + on-the-fly transformations, so the
 * thumbnail is a derived URL rather than a second upload (§23).
 */
let cloudinary = null;

const getClient = () => {
  if (cloudinary) return cloudinary;
  try {
    // eslint-disable-next-line global-require
    cloudinary = require("cloudinary").v2;
  } catch (err) {
    throw new Error(
      "MEDIA_STORAGE_PROVIDER=cloudinary but the 'cloudinary' package is not installed. Run: npm install cloudinary"
    );
  }
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
    secure: true,
  });
  return cloudinary;
};

const upload = ({ buffer, mimeType, storeId, folder }) =>
  new Promise((resolve, reject) => {
    const client = getClient();
    // Every asset is namespaced under the store, matching DB-level isolation.
    const targetFolder = `knotkitchen/${storeId}/${folder || "general"}`;

    const stream = client.uploader.upload_stream(
      {
        folder: targetFolder,
        resource_type: "image",
        // Strip EXIF/metadata and normalise format — safe image processing (§24).
        transformation: [{ quality: "auto", fetch_format: "auto" }],
      },
      (error, result) => {
        if (error) return reject(error);

        const thumbnailUrl = client.url(result.public_id, {
          secure: true,
          transformation: [
            { width: 400, height: 400, crop: "fill", quality: "auto", fetch_format: "auto" },
          ],
        });

        return resolve({
          storageKey: result.public_id,
          url: result.secure_url,
          thumbnailUrl,
          provider: "cloudinary",
          width: result.width,
          height: result.height,
        });
      }
    );

    stream.end(buffer);
  });

const remove = async (storageKey) => {
  if (!storageKey) return;
  const client = getClient();
  await client.uploader.destroy(storageKey, { resource_type: "image" });
};

module.exports = { upload, remove };
