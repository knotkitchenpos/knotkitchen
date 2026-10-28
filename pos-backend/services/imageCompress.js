/**
 * Item photos are stored as WebP of about 200 KB at most, whatever was
 * uploaded (JPG, PNG, GIF, AVIF or a heavy WebP): big enough for the product
 * popup, small enough for a tablet to load a whole menu of them.
 *
 * Quality steps down first; if even the lowest one is too big, the longest
 * side shrinks and it tries again.
 */
const MAX_SIDE = 1600;
const TARGET_BYTES = 200 * 1024;
const QUALITIES = [82, 72, 62, 52];

/**
 * Every upload is stored this way, only ever the WebP: the original is never
 * written. Per media-library folder:
 *   products, categories  200 KB, as above
 *   logo, general         lossless first: a logo or a receipt QR code keeps
 *                         its sharp edges, text and transparency, and these
 *                         are small; lossy only if lossless is too big
 *   cover, gallery, offers 400 KB: shown large on the website
 */
const FOLDER_OPTIONS = {
  logo: { lossless: true },
  general: { lossless: true },
  cover: { targetBytes: 400 * 1024 },
  gallery: { targetBytes: 400 * 1024 },
  offers: { targetBytes: 400 * 1024 },
};
const optionsForFolder = (folder) => FOLDER_OPTIONS[folder] || {};

const toWebp = async (input, { maxSide = MAX_SIDE, targetBytes = TARGET_BYTES, lossless = false } = {}) => {
  const sharp = require("sharp");
  if (lossless) {
    const out = await sharp(input)
      .rotate()
      .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
      .webp({ lossless: true })
      .toBuffer({ resolveWithObject: true });
    if (out.data.length <= targetBytes) {
      return { buffer: out.data, width: out.info.width, height: out.info.height, mimeType: "image/webp" };
    }
  }
  let side = maxSide;
  let last;
  for (let round = 0; round < 5; round += 1) {
    for (const quality of QUALITIES) {
      last = await sharp(input)
        .rotate()
        .resize({ width: side, height: side, fit: "inside", withoutEnlargement: true })
        .webp({ quality })
        .toBuffer({ resolveWithObject: true });
      if (last.data.length <= targetBytes) break;
    }
    if (last.data.length <= targetBytes) break;
    side = Math.round(side * 0.75);
  }
  return { buffer: last.data, width: last.info.width, height: last.info.height, mimeType: "image/webp" };
};

module.exports = { toWebp, optionsForFolder, TARGET_BYTES, MAX_SIDE };
