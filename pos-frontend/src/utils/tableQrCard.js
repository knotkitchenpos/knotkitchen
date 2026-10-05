/**
 * The printable table QR card, drawn as one image.
 *
 * Laid out like the owner's Canva card: cream paper with soft sage washes in
 * the corners and gold line work, a double gold frame, then top to bottom
 * the logo, the restaurant's name, the QR in its own gold frame, and the
 * table's name.
 *
 * Drawn at print resolution: A6 (105 x 148 mm) at 300 dpi. The QR is drawn
 * from its vector outline at a whole number of pixels per module, so every
 * module edge falls on a pixel edge: pure black and white, nothing to blur.
 * The old card stretched the 176 px on-screen preview to three times its
 * size, which is what made printed cards blurry.
 *
 * The same image is the on-screen preview, the downloaded PNG and what Print
 * sends, so all three always match.
 */

export const CARD = { width: 1240, height: 1754 }; // A6 at 300 dpi

const CREAM = "#F8F4EA";
const INK = "#4A4A3F";
const SOFT_INK = "#6B6A5C";
const GOLD = "#B89B5E";
// Georgia on computers, Noto Serif on Android: no font has to load first.
const SERIF = '"Cormorant Garamond", Georgia, "Times New Roman", "Noto Serif", serif';

const font = (size, { weight = 400, italic = false } = {}) => `${italic ? "italic " : ""}${weight} ${size}px ${SERIF}`;

/** Letter-spaced text centred on cx; canvas letterSpacing is too new for older tablets. */
const spaced = (g, text, cx, y, spacing) => {
  const chars = [...text];
  const widths = chars.map((c) => g.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let x = cx - total / 2;
  g.textAlign = "left";
  chars.forEach((c, i) => {
    g.fillText(c, x, y);
    x += widths[i] + spacing;
  });
  g.textAlign = "center";
  return total;
};

/** Split a name into at most two lines that fit `max` at the current font. */
export const fitLines = (text, max, measure) => {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  if (measure(words.join(" ")) <= max) return [words.join(" ")];
  let best = null;
  for (let i = 1; i < words.length; i += 1) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const worst = Math.max(measure(a), measure(b));
    if (!best || worst < best.worst) best = { lines: [a, b], worst };
  }
  return best && best.worst <= max ? best.lines : null;
};

/** A soft watercolour wash: overlapping translucent blots. */
const wash = (g, x, y, r) => {
  const blots = [
    [0, 0, 1],
    [0.35, -0.2, 0.7],
    [-0.3, 0.25, 0.75],
    [0.15, 0.4, 0.6],
    [-0.4, -0.35, 0.55],
  ];
  for (const [dx, dy, s] of blots) {
    const cx = x + dx * r;
    const cy = y + dy * r;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r * s);
    grad.addColorStop(0, "rgba(138, 156, 124, 0.32)");
    grad.addColorStop(0.6, "rgba(160, 175, 146, 0.16)");
    grad.addColorStop(1, "rgba(160, 175, 146, 0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, r * s, 0, Math.PI * 2);
    g.fill();
  }
};

/** An almond leaf from (0,0) pointing along +x, with its midrib. */
const leaf = (g, len) => {
  g.beginPath();
  g.moveTo(0, 0);
  g.quadraticCurveTo(len * 0.5, -len * 0.3, len, 0);
  g.quadraticCurveTo(len * 0.5, len * 0.3, 0, 0);
  g.stroke();
  g.beginPath();
  g.moveTo(len * 0.12, 0);
  g.lineTo(len * 0.8, 0);
  g.stroke();
};

/** A gold sprig: a gently curved stem with leaves growing from it, alternating sides. */
const sprig = (g, x, y, length, angle, leaves, bend = 1) => {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.strokeStyle = GOLD;
  g.lineWidth = 2.5;
  const point = (t) => [length * t, -length * 0.1 * bend * 4 * t * (1 - t)];
  g.beginPath();
  g.moveTo(0, 0);
  g.quadraticCurveTo(length * 0.5, -length * 0.2 * bend, length, 0);
  g.stroke();
  const size = length / 6;
  for (let i = 1; i <= leaves; i += 1) {
    const t = i / (leaves + 1);
    const [lx, ly] = point(t);
    g.save();
    g.translate(lx, ly);
    g.rotate((i % 2 ? -1 : 1) * 0.75);
    leaf(g, size * (1 - t * 0.35));
    g.restore();
  }
  // A leaf at the tip.
  g.save();
  g.translate(length, 0);
  leaf(g, size * 0.6);
  g.restore();
  g.restore();
};

/** A small diamond. */
const diamond = (g, x, y, r) => {
  g.beginPath();
  g.moveTo(x, y - r);
  g.lineTo(x + r, y);
  g.lineTo(x, y + r);
  g.lineTo(x - r, y);
  g.closePath();
  g.fill();
};

/** Gold rule with a diamond in the middle. */
const divider = (g, cx, y, half) => {
  g.strokeStyle = GOLD;
  g.fillStyle = GOLD;
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(cx - half, y);
  g.lineTo(cx - 22, y);
  g.moveTo(cx + 22, y);
  g.lineTo(cx + half, y);
  g.stroke();
  diamond(g, cx, y, 9);
};

/**
 * The QR's outline from a rendered <QRCodeSVG>: its module grid size and the
 * path of the dark modules, in module units.
 */
export const qrFromSvg = (svg) => {
  const size = Number(String(svg?.getAttribute?.("viewBox") || "").split(/\s+/)[2]);
  const paths = svg?.querySelectorAll?.("path") || [];
  const d = paths.length ? paths[paths.length - 1].getAttribute("d") : "";
  return size > 0 && d ? { size, d } : null;
};

/** The QR in `room` px, at the largest whole number of pixels per module. */
const drawQr = (g, qr, cx, top, room) => {
  const k = Math.max(1, Math.floor(room / qr.size));
  const side = k * qr.size;
  const x = Math.round(cx - side / 2);
  const y = Math.round(top + (room - side) / 2);
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  g.fillStyle = "#000000";
  g.fill(new Path2D(qr.d));
  g.restore();
};

/**
 * Draw the card. `qr` is the QR outline from qrFromSvg (or null);
 * `logo` an already-loaded image or null.
 */
export const drawTableQrCard = ({ canvas, logo = null, restaurantName = "", tableName = "", qr = null }) => {
  const { width: W, height: H } = CARD;
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d");
  const cx = W / 2;
  g.textAlign = "center";
  g.textBaseline = "alphabetic";

  // Paper, washes, line work.
  g.fillStyle = CREAM;
  g.fillRect(0, 0, W, H);
  wash(g, 120, 140, 330);
  wash(g, W - 90, 260, 260);
  wash(g, W - 140, H - 230, 380);
  wash(g, 90, H - 120, 220);
  // Line work in the margins only, clear of the text and the QR.
  sprig(g, 84, H - 250, 470, -1.2, 6);
  sprig(g, 92, H - 118, 210, -0.25, 3, -1);
  sprig(g, W - 92, 520, 360, 1.75, 5, -1);
  sprig(g, W - 84, H - 290, 300, Math.PI + 1.05, 4);

  // Double gold frame, with a diamond at each corner.
  g.strokeStyle = GOLD;
  g.lineWidth = 4;
  g.strokeRect(48, 48, W - 96, H - 96);
  g.lineWidth = 1.5;
  g.strokeRect(64, 64, W - 128, H - 128);
  g.fillStyle = GOLD;
  for (const [x, y] of [[56, 56], [W - 56, 56], [56, H - 56], [W - 56, H - 56]]) diamond(g, x, y, 12);

  // 1. Logo.
  let y = 150;
  if (logo && logo.width && logo.height) {
    const h = 190;
    const w = Math.min(460, (logo.width / logo.height) * h);
    const lh = (w / logo.width) * logo.height;
    g.drawImage(logo, cx - w / 2, y, w, lh);
    y += lh + 70;
  } else {
    y += 40;
  }

  // 2. Restaurant name: large spaced capitals, on two lines or smaller if it is long.
  const name = String(restaurantName || "").trim().toUpperCase();
  if (name) {
    let size = 104;
    let lines = null;
    for (; size >= 54; size -= 6) {
      g.font = font(size, { weight: 500 });
      const sp = size * 0.12;
      lines = fitLines(name, W - 300, (t) => g.measureText(t).width + sp * (t.length - 1));
      if (lines) break;
    }
    g.fillStyle = INK;
    for (const line of lines || [name]) {
      y += size;
      spaced(g, line, cx, y, size * 0.12);
      y += size * 0.22;
    }
    y += 36;
  }
  divider(g, cx, y, 150);
  y += 70;
  g.fillStyle = SOFT_INK;
  g.font = font(40, { italic: true });
  g.fillText("Digital Menu & Guest Experience", cx, y);
  y += 70;

  // The bottom block is pinned to the foot of the card; the QR takes the
  // room between, so a logo and a two-line name never push text off the end.
  const footer = H - 120;
  const rule = footer - 78;
  const tableY = rule - 80;
  const captionY = tableY - 96;
  const room = captionY - 90 - (y + 30); // ornament gaps above and below the frame
  const box = Math.max(420, Math.min(600, room));
  const top = y + 30 + Math.max(0, (room - box) / 2);

  // 3. QR, in a double gold frame with an ornament above and below.
  g.fillStyle = GOLD;
  diamond(g, cx, top - 22, 10);
  g.strokeStyle = GOLD;
  g.lineWidth = 4;
  g.strokeRect(cx - box / 2, top, box, box);
  g.lineWidth = 1.5;
  g.strokeRect(cx - box / 2 + 16, top + 16, box - 32, box - 32);
  g.fillStyle = "#FFFFFF";
  g.fillRect(cx - box / 2 + 30, top + 30, box - 60, box - 60);
  if (qr) {
    drawQr(g, qr, cx, top + 40, box - 80);
  } else {
    g.fillStyle = SOFT_INK;
    g.font = font(36, { italic: true });
    g.fillText("QR unavailable", cx, top + box / 2);
  }
  g.fillStyle = GOLD;
  diamond(g, cx, top + box + 22, 10);

  g.fillStyle = SOFT_INK;
  g.font = font(40);
  g.fillText("Scan to view & order our full menu.", cx, captionY);

  // 4. Table name.
  const table = String(tableName || "").trim().toUpperCase();
  if (table) {
    let size = 72;
    g.font = font(size, { weight: 600 });
    while (size > 40 && g.measureText(table).width + size * 0.15 * (table.length - 1) > W - 340) {
      size -= 4;
      g.font = font(size, { weight: 600 });
    }
    g.fillStyle = INK;
    spaced(g, table, cx, tableY, size * 0.15);
  }
  divider(g, cx, rule, 210);

  g.fillStyle = SOFT_INK;
  g.font = font(32, { italic: true });
  g.fillText("Powered By KnotKitchen", cx, footer);
  return canvas;
};
