import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

/**
 * What gets printed on a table card.
 *
 * The URL is host plus token. The token is durable; the host is deployment
 * config that moves. `table.qrCode` on the row is a copy of both, frozen at
 * the moment the QR was minted, so it is stale the first time the host
 * changes -- which is exactly what happened when the short `order.` host went
 * live and every table went on printing the POS hostname.
 */

test("REGRESSION: the print modal always asks the server for the URL", () => {
  const page = SRC("src/pages/Tables.jsx");

  // The shortcut that caused it: having a token locally was treated as having
  // the right URL locally. It is not -- only the token half was right.
  assert.ok(
    !/no need to hit the API/.test(page),
    "a cached URL cannot know the host changed",
  );
  assert.ok(
    !/if \(typeof qrModalTable\.qrToken === "string" && \/\^\[a-f0-9\]\{64\}\$\/i\.test\(qrModalTable\.qrToken\)\) \{\s*\n\s*return;/.test(page),
    "the early return must be gone, not merely reworded",
  );

  // And it must still be the server's answer that lands in state.
  assert.match(page, /getOrCreateTableQr\(qrModalTable\._id\)/);
  assert.match(page, /qrToken: qr\.token, qrCode: qr\.qrUrl/);
});

test("the QR image renders the URL the server returned", () => {
  const modal = SRC("src/components/tables/PrintTableQRModal.jsx");
  assert.match(modal, /const qrUrl = table\.qrCode \|\|/);
  assert.match(modal, /value=\{qrUrl\}/);
});
