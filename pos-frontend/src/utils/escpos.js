/**
 * ESC/POS bytes for a receipt bitmap.
 *
 * Every mainstream thermal printer (Epson, Xprinter, TVS, Rongta, the
 * unbranded 58 mm Bluetooth ones) accepts `GS v 0` raster images, so the
 * receipt is sent as one picture rather than in the printer's own fonts.
 */

/**
 * RGBA pixels to one bit per pixel, 1 = black, packed MSB-first per row.
 *
 * Dark text on white stays crisp under a plain threshold, which is what the
 * receipt is almost entirely made of.
 */
export const toMonochrome = (rgba, width, height, threshold = 180) => {
  const rowBytes = Math.ceil(width / 8);
  const bits = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const alpha = rgba[i + 3] / 255;
      // Transparent pixels are paper.
      const lum = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * alpha + 255 * (1 - alpha);
      if (lum < threshold) bits[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return bits;
};

/**
 * Floyd-Steinberg to pure black and white, in place, for photos (the logo).
 * A threshold turns a coloured logo into a solid blob.
 */
export const ditherInPlace = (rgba, width, height) => {
  const gray = new Float32Array(width * height);
  for (let p = 0; p < gray.length; p += 1) {
    const i = p * 4;
    const alpha = rgba[i + 3] / 255;
    gray[p] = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * alpha + 255 * (1 - alpha);
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const value = gray[p] < 128 ? 0 : 255;
      const err = gray[p] - value;
      gray[p] = value;
      if (x + 1 < width) gray[p + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) gray[p + width - 1] += (err * 3) / 16;
        gray[p + width] += (err * 5) / 16;
        if (x + 1 < width) gray[p + width + 1] += err / 16;
      }
    }
  }
  for (let p = 0; p < gray.length; p += 1) {
    const i = p * 4;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = gray[p];
    rgba[i + 3] = 255;
  }
  return rgba;
};

// Bands keep each command inside the smallest printer buffers.
const BAND_ROWS = 120;

// Calibration knob: how far a printer with no cutter feeds after a print so
// the last line clears its tear bar (8 dots = 1 mm at 203 dpi).
export const TEAR_FEED_DOTS = 104; // 13 mm

const blankRow = (bits, rowBytes, y) => {
  for (let i = y * rowBytes, end = i + rowBytes; i < end; i += 1) if (bits[i]) return false;
  return true;
};

/**
 * The full print job: initialise, the image, then GS V B 0 only: the printer
 * feeds to its own cutter and cuts. The 4-line feed that used to come first
 * added ~17 mm of blank paper to every 3-inch receipt, on top of the feed to
 * the cutter.
 *
 * Only the ink is sent. A 3-inch receipt is ~70 KB as a full bitmap, and a
 * BLE printer that takes 20 bytes per acknowledged write needed 3-5 minutes
 * for it. Blank rows (the gaps between lines) become an ESC J paper feed of
 * that many dots, and each band is cut at its right-most inked byte, the rest
 * of the row being white.
 *
 * `tearFeed`: dots to feed after the last line on a printer with no cutter
 * (the 2-inch portables), which ignores the cut and would leave the end of
 * the receipt inside, behind its tear bar.
 */
export const rasterJob = (bits, width, height, { tearFeed = 0 } = {}) => {
  const rowBytes = Math.ceil(width / 8);
  const chunks = [Uint8Array.of(0x1b, 0x40)]; // ESC @
  let blank = 0;
  for (let top = 0; top < height; ) {
    if (blankRow(bits, rowBytes, top)) {
      blank += 1;
      top += 1;
      continue;
    }
    for (; blank > 0; blank -= Math.min(blank, 255)) chunks.push(Uint8Array.of(0x1b, 0x4a, Math.min(blank, 255))); // ESC J n
    let rows = 1;
    while (rows < BAND_ROWS && top + rows < height && !blankRow(bits, rowBytes, top + rows)) rows += 1;
    let used = 1;
    for (let r = 0; r < rows; r += 1) {
      const start = (top + r) * rowBytes;
      for (let b = rowBytes - 1; b >= used; b -= 1) {
        if (bits[start + b]) {
          used = b + 1;
          break;
        }
      }
    }
    const band = new Uint8Array(used * rows);
    for (let r = 0; r < rows; r += 1) band.set(bits.subarray((top + r) * rowBytes, (top + r) * rowBytes + used), r * used);
    chunks.push(Uint8Array.of(0x1d, 0x76, 0x30, 0x00, used & 0xff, used >> 8, rows & 0xff, rows >> 8), band); // GS v 0
    top += rows;
  }
  // Blank rows left at the bottom are dropped: the cut feeds the paper out,
  // and a printer with no cutter gets its tear feed instead.
  for (let feed = tearFeed; feed > 0; feed -= Math.min(feed, 255)) chunks.push(Uint8Array.of(0x1b, 0x4a, Math.min(feed, 255)));
  chunks.push(Uint8Array.of(0x1d, 0x56, 0x42, 0x00)); // GS V B 0: feed to the cutter, partial cut
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
};
