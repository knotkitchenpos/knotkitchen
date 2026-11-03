/**
 * Which camera reads count as a scan (owner, 2026-11-03: "sometimes it reads
 * the wrong barcode and sometimes it scans too fast"). A camera decodes many
 * frames a second, and a blurred or half-seen frame can decode to the wrong
 * digits. So a read counts only when
 *   its check digit is right (EAN-13, EAN-8, UPC-A, UPC-E carry one; a misread
 *   almost always breaks it),
 *   the same code is read in consecutive frames (one stray frame is not enough),
 *   and the packet is new to the camera: one held in front of it counts once,
 *   and counts again only after it has left the picture for a moment.
 */

const digitsOk = (d) => {
  // Mod-10 with weights 3,1 from the right, the last digit being the check digit.
  let sum = 0;
  for (let i = d.length - 2, w = 3; i >= 0; i -= 1, w = w === 3 ? 1 : 3) sum += Number(d[i]) * w;
  return (10 - (sum % 10)) % 10 === Number(d[d.length - 1]);
};

/** UPC-E (8 digits, number system 0 or 1) written out as its UPC-A, check digit kept. */
const upcEtoA = (e) => {
  const [ns, d1, d2, d3, d4, d5, d6, check] = e.split("");
  let body;
  if (["0", "1", "2"].includes(d6)) body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  else if (d6 === "3") body = `${d1}${d2}${d3}00000${d4}${d5}`;
  else if (d6 === "4") body = `${d1}${d2}${d3}${d4}00000${d5}`;
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  return `${ns}${body}${check}`;
};

/**
 * Whether a read could be a real barcode. Retail codes (8, 12, 13 digits)
 * must have a right check digit; other codes (a store's own Code 128 label)
 * carry their check inside the symbol, which the reader has already checked.
 */
export const checkDigitOk = (code) => {
  const c = String(code || "");
  if (!/^\d+$/.test(c)) return c.length >= 4;
  if (c.length === 13 || c.length === 12 || c.length === 14) return digitsOk(c);
  if (c.length === 8) return digitsOk(c) || (/^[01]/.test(c) && digitsOk(upcEtoA(c)));
  return false; // a digit run of another length is a partial read
};

/**
 * A gate the camera feeds every frame: `feed(code | null, now)` returns the
 * code when it counts as a scan, else null. Feed null for a frame where
 * nothing was read, so the gate knows when a packet has left the picture.
 */
export const createScanGate = ({ confirm = 2, within = 900, leaveGap = 1000, cooldown = 700 } = {}) => {
  let candidate = "";
  let hits = 0;
  let candidateAt = 0;
  let accepted = "";   // the last code that counted
  let acceptedAt = -Infinity;
  let acceptedSeen = 0; // when that code was last in the picture
  return {
    feed(code, now = Date.now()) {
      // A frame with nothing read, or a misread: not a scan. Reads either side of
      // a missed frame still confirm each other, within `within` ms.
      if (!code || !checkDigitOk(code)) return null;
      // The packet just counted is still in front of the camera: it stays counted once.
      if (code === accepted) {
        if (now - acceptedSeen < leaveGap) {
          acceptedSeen = now;
          candidate = "";
          hits = 0;
          return null;
        }
        // It left the picture and is back: the next packet of the same product, a scan of its own.
        accepted = "";
      }
      if (code === candidate && now - candidateAt <= within) hits += 1;
      else { candidate = code; hits = 1; }
      candidateAt = now;
      if (hits < confirm || now - acceptedAt < cooldown) return null;
      accepted = code;
      acceptedAt = now;
      acceptedSeen = now;
      candidate = "";
      hits = 0;
      return code;
    },
  };
};
