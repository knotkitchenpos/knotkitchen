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

const toWebp = async (input, { maxSide = MAX_SIDE, targetBytes = TARGET_BYTES } = {}) => {
  const sharp = require("sharp");
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

module.exports = { toWebp, TARGET_BYTES, MAX_SIDE };
