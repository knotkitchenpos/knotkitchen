const crypto = require("crypto");
const config = require("../../config/config");

/**
 * S3-compatible driver — works with AWS S3, Cloudflare R2 and Supabase Storage's
 * S3 endpoint (all speak the same API; only the endpoint/credentials differ).
 *
 * The SDK is an OPTIONAL dependency, required lazily:
 *   npm install @aws-sdk/client-s3
 */
let client = null;
let PutObjectCommand = null;
let DeleteObjectCommand = null;

const getClient = () => {
  if (client) return client;
  let sdk;
  try {
    // eslint-disable-next-line global-require
    sdk = require("@aws-sdk/client-s3");
  } catch (err) {
    throw new Error(
      "MEDIA_STORAGE_PROVIDER=s3|r2 but '@aws-sdk/client-s3' is not installed. Run: npm install @aws-sdk/client-s3"
    );
  }

  ({ PutObjectCommand, DeleteObjectCommand } = sdk);

  client = new sdk.S3Client({
    region: config.s3.region,
    // R2/Supabase/MinIO need an explicit endpoint; AWS S3 leaves it undefined.
    ...(config.s3.endpoint ? { endpoint: config.s3.endpoint, forcePathStyle: true } : {}),
    credentials: {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
    },
  });
  return client;
};

const EXT_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

const upload = async ({ buffer, mimeType, storeId, folder }) => {
  const s3 = getClient();
  const ext = EXT_BY_MIME[mimeType] || "bin";
  const storageKey = `knotkitchen/${storeId}/${folder || "general"}/${crypto.randomUUID()}.${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: storageKey,
      Body: buffer,
      ContentType: mimeType,
      // Long-lived cache: keys are content-unique (uuid), so they never change.
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  const base = config.s3.publicBaseUrl || `https://${config.s3.bucket}.s3.${config.s3.region}.amazonaws.com`;
  const url = `${base}/${storageKey}`;

  return {
    storageKey,
    url,
    // Plain object storage has no transformation pipeline. Put a CDN/image
    // resizer (CloudFront + Lambda@Edge, Cloudflare Images) in front and set
    // MEDIA_THUMBNAIL_SUFFIX, or switch to the Cloudinary driver.
    thumbnailUrl: url,
    provider: config.mediaProvider,
  };
};

const remove = async (storageKey) => {
  if (!storageKey) return;
  const s3 = getClient();
  await s3.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: storageKey }));
};

module.exports = { upload, remove };
