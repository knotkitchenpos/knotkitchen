import latin from "../assets/fonts/geist-latin.woff2";
import latinExt from "../assets/fonts/geist-latin-ext.woff2";
import { RECEIPT_FONT_NAME } from "./receiptLayout.js";

/**
 * The font receipts, KOTs and reports print in, shipped with the POS.
 *
 * They are drawn on a canvas, and a canvas only has the device's fonts.
 * Android has no Arial or Helvetica, so the layout's "sans-serif" came out in
 * the tablet's system font -- a handwriting theme on some tablets -- and every
 * device printed differently. Geist (SIL OFL, the knotkitchen.com font) is
 * loaded before anything is drawn. Split like Google Fonts: the latin-ext half
 * carries the ₹ sign. Scripts it does not cover (Hindi, Bengali) still fall
 * back to the device's own font.
 */
const FACES = [
  {
    url: latin,
    unicodeRange:
      "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
  },
  {
    url: latinExt,
    unicodeRange:
      "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
  },
];

// A print is never held up for long: a font that has not arrived by then (no
// network the very first time) prints with the fallback, and the next print
// tries again.
const WAIT_MS = 4000;

let loading = null;

const load = () => {
  if (loading) return loading;
  const added = [];
  loading = Promise.all(
    FACES.map(({ url, unicodeRange }) => {
      const face = new FontFace(RECEIPT_FONT_NAME, `url(${url}) format("woff2")`, { weight: "400 700", unicodeRange });
      document.fonts.add(face);
      added.push(face);
      return face.load();
    }),
  ).then(
    () => true,
    () => {
      added.forEach((face) => document.fonts.delete(face));
      loading = null;
      return false;
    },
  );
  return loading;
};

/** Resolves once the receipt font can be drawn (true), or false if it could not be loaded in time. */
export const ensureReceiptFont = () => {
  if (typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) {
    return Promise.resolve(false);
  }
  return Promise.race([load(), new Promise((resolve) => setTimeout(() => resolve(false), WAIT_MS))]);
};
