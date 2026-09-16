/**
 * The "cat printer" protocol: the private language of the cheap 57 mm mini
 * printers sold for stickers and notes (iPrint, Fun Print, Tiny Print; models
 * GB01/GB02/GB03, GT01, MX05..MX11, YT01, X5/X6, P1, and the SEZNIK and
 * other rebrands). They ignore ESC/POS entirely: a receipt sent that way is
 * "delivered" and nothing comes out.
 *
 * Reverse-engineered by others (rbaron/catprinter, NaitLee/Cat-Printer); this
 * is the subset a receipt needs. Every packet is
 *
 *   51 78 <cmd> 00 <len> 00 <payload…> <crc8 of payload> ff
 *
 * and the image goes one row at a time, 384 pixels wide, 1 = burn, packed
 * LSB-first -- the opposite bit order to ESC/POS.
 */

/** These printers are always 384 dots wide (57-58 mm paper). */
export const CAT_WIDTH = 384;

// CRC-8, polynomial 0x07, no reflection -- what the printers check.
const CRC = new Uint8Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let b = 0; b < 8; b += 1) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  CRC[i] = c;
}
export const crc8 = (bytes) => {
  let c = 0;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff];
  return c;
};

// Bit order swap for one byte: ESC/POS packs the leftmost pixel in bit 7.
const REVERSE = new Uint8Array(256);
for (let i = 0; i < 256; i += 1) {
  let r = 0;
  for (let b = 0; b < 8; b += 1) r |= ((i >> b) & 1) << (7 - b);
  REVERSE[i] = r;
}

export const packet = (cmd, payload) => {
  const p = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
  if (p.length > 0xff) throw new Error("cat printer packet too large");
  const out = new Uint8Array(8 + p.length);
  out.set([0x51, 0x78, cmd, 0x00, p.length, 0x00], 0);
  out.set(p, 6);
  out[6 + p.length] = crc8(p);
  out[7 + p.length] = 0xff;
  return out;
};

const GET_STATE = packet(0xa3, [0x00]);
const QUALITY_200DPI = packet(0xa4, [0x32]);
const APPLY_ENERGY = packet(0xbe, [0x01]);
const LATTICE_START = packet(0xa6, [0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c]);
const LATTICE_END = packet(0xa6, [0xaa, 0x55, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x17]);
const FEED_48 = packet(0xa1, [0x30, 0x00]); // 48 dots, little-endian

/**
 * The full job for a monochrome bitmap as toMonochrome() packs it (MSB-first,
 * 1 = black). Wider images are cropped to 384, narrower ones left-aligned.
 *
 * `energy` is how hard the head burns (0..0xffff). ponytail: one fixed value;
 * expose it in Settings if receipts come out faint or scorched.
 */
export const catJob = (bits, width, height, { energy = 0xffff } = {}) => {
  const srcRowBytes = Math.ceil(width / 8);
  const rowBytes = CAT_WIDTH / 8;
  const chunks = [
    GET_STATE,
    QUALITY_200DPI,
    packet(0xaf, [(energy >> 8) & 0xff, energy & 0xff]),
    APPLY_ENERGY,
    LATTICE_START,
  ];
  for (let y = 0; y < height; y += 1) {
    const row = new Uint8Array(rowBytes);
    for (let i = 0; i < Math.min(rowBytes, srcRowBytes); i += 1) row[i] = REVERSE[bits[y * srcRowBytes + i]];
    chunks.push(packet(0xa2, row));
  }
  // Feed past the tear edge, then the sequence the maker's app ends with.
  chunks.push(packet(0xbd, [0x19]), FEED_48, FEED_48, FEED_48, LATTICE_END, GET_STATE);
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
};

/** Printers whose Bluetooth name gives the family away. Others: choose it in Settings. */
export const looksLikeCatPrinter = (name = "") =>
  /^(GB0[1-3]|GT01|MX0[5-9]|MX1[01]|PD01|YT01|SC03|MXTP|X[56]|P1)(\b|[-_ ])/i.test(String(name).trim());
