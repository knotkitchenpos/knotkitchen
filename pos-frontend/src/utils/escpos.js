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

/**
 * The full print job: initialise, the image in bands, feed past the tear bar,
 * cut. Printers without a cutter ignore the cut.
 */
export const rasterJob = (bits, width, height) => {
  const rowBytes = Math.ceil(width / 8);
  const chunks = [Uint8Array.of(0x1b, 0x40)]; // ESC @
  for (let top = 0; top < height; top += BAND_ROWS) {
    const rows = Math.min(BAND_ROWS, height - top);
    chunks.push(
      Uint8Array.of(0x1d, 0x76, 0x30, 0x00, rowBytes & 0xff, rowBytes >> 8, rows & 0xff, rows >> 8), // GS v 0
      bits.subarray(top * rowBytes, (top + rows) * rowBytes),
    );
  }
  chunks.push(Uint8Array.of(0x1b, 0x64, 0x04)); // ESC d 4: feed 4 lines
  chunks.push(Uint8Array.of(0x1d, 0x56, 0x42, 0x00)); // GS V B 0: partial cut
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
};
