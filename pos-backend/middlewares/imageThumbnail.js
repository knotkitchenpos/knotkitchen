const fs = require("fs");
const path = require("path");

/**
 * Smaller copies of uploaded photos: `/uploads/<file>.webp?w=320`.
 *
 * Product photos are uploaded as large as 1254px but shown at about 150px in
 * the POS grid. Decoding 72 of them at full size needed ~450 MB of image
 * memory, and a low-end tablet blanked the grid while scrolling. The copy is
 * made once, on the first request, and kept next to the original
 * (`<file>.w320.webp`). Anything else falls through to the original file.
 */
// 1280 for a website's hero photo.
const WIDTHS = new Set([160, 320, 640, 1280]);
const IMAGE = /\.(webp|png|jpe?g)$/i;

const imageThumbnail = (root) => {
  const base = path.resolve(root);
  return async (req, res, next) => {
    const w = Number(req.query.w);
    if (!WIDTHS.has(w) || !IMAGE.test(req.path) || /(^|\/)\./.test(req.path)) return next();

    let src;
    try {
      src = path.join(base, path.normalize(decodeURIComponent(req.path)));
    } catch {
      return next();
    }
    if (!src.startsWith(base + path.sep)) return next();

    const out = `${src}.w${w}.webp`;
    // Written to a temp name and renamed, so two first requests at once never
    // serve a half-written file.
    const tmp = `${out}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      if (!fs.existsSync(out)) {
        await require("sharp")(src)
          .rotate()
          .resize({ width: w, height: w, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(tmp);
        fs.renameSync(tmp, out);
      }
      // Keep the immutable Cache-Control set for /uploads.
      return res.type("image/webp").sendFile(out, { cacheControl: false });
    } catch {
      fs.rm(tmp, { force: true }, () => {});
      // Missing or unreadable file: the original (or its 404) answers.
      return next();
    }
  };
};

module.exports = { imageThumbnail, WIDTHS };
