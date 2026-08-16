/**
 * Image validation & introspection (§24).
 *
 * Never trust the client-supplied `Content-Type` or file extension — an
 * attacker can label a PHP/HTML payload as image/png. We sniff the actual
 * magic bytes of the buffer and reject anything that is not a real raster
 * image from the allow-list.
 *
 * Dimensions are parsed from the file headers directly, which avoids pulling in
 * a native dependency (sharp/canvas) just to read width/height.
 */

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const MIN_FILE_BYTES = 64;

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

/** Detect the true mime type from the file's magic bytes. */
const sniffMimeType = (buf) => {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return "image/png";
  }

  // GIF: "GIF87a" / "GIF89a"
  if (buf.slice(0, 6).toString("ascii") === "GIF87a" || buf.slice(0, 6).toString("ascii") === "GIF89a") {
    return "image/gif";
  }

  // RIFF....WEBP
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }

  // ISO-BMFF: ....ftypavif / ftypavis
  if (buf.slice(4, 8).toString("ascii") === "ftyp") {
    const brand = buf.slice(8, 12).toString("ascii");
    if (brand === "avif" || brand === "avis") return "image/avif";
  }

  return null;
};

/** Read intrinsic width/height from the image header. Returns {width,height}. */
const readDimensions = (buf, mimeType) => {
  try {
    if (mimeType === "image/png") {
      // IHDR width/height are big-endian uint32 at offsets 16 and 20.
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }

    if (mimeType === "image/gif") {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }

    if (mimeType === "image/jpeg") {
      // Walk the JPEG segment chain until a Start-Of-Frame marker.
      let offset = 2;
      while (offset < buf.length - 9) {
        if (buf[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buf[offset + 1];
        // SOF0-SOF15, excluding DHT(C4), JPG(C8) and DAC(CC).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
        }
        offset += 2 + buf.readUInt16BE(offset + 2);
      }
      return { width: 0, height: 0 };
    }

    if (mimeType === "image/webp") {
      const format = buf.slice(12, 16).toString("ascii");
      if (format === "VP8 ") {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
      if (format === "VP8L") {
        const bits = buf.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (format === "VP8X") {
        const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
        const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
        return { width, height };
      }
    }
  } catch (err) {
    // A malformed header must not crash the upload path.
  }
  return { width: 0, height: 0 };
};

/** Strip directory components and dangerous characters from a file name. */
const sanitizeFileName = (name) => {
  const base = String(name || "upload")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
  return base || "upload";
};

/**
 * Full validation pipeline.
 * @returns {{ok:true, mimeType, width, height, fileName}} or {{ok:false, error}}
 */
const validateImage = ({ buffer, fileName }) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < MIN_FILE_BYTES) {
    return { ok: false, error: "Uploaded file is empty or corrupt." };
  }
  if (buffer.length > MAX_FILE_BYTES) {
    return { ok: false, error: "Image must be 5MB or smaller." };
  }

  const mimeType = sniffMimeType(buffer);
  if (!mimeType || !ALLOWED_MIME.has(mimeType)) {
    return {
      ok: false,
      error: "Unsupported file type. Please upload a JPG, PNG, WEBP, GIF or AVIF image.",
    };
  }

  // SVG is intentionally NOT allowed: it can carry embedded <script> and is a
  // stored-XSS vector when served from our own origin.

  const { width, height } = readDimensions(buffer, mimeType);
  if (width > 10000 || height > 10000) {
    return { ok: false, error: "Image dimensions are too large (max 10000px)." };
  }

  return { ok: true, mimeType, width, height, fileName: sanitizeFileName(fileName) };
};

module.exports = {
  validateImage,
  sniffMimeType,
  readDimensions,
  sanitizeFileName,
  MAX_FILE_BYTES,
  ALLOWED_MIME,
};
