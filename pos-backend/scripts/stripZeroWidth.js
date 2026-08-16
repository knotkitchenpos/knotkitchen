/**
 * stripZeroWidth.js
 *
 * Removes invisible zero-width characters (ZWSP/ZWNJ/ZWJ/BOM etc.) from a
 * source file. These are invisible in an editor but silently break things
 * like Tailwind class names.
 *
 * Usage: node scripts/stripZeroWidth.js <file> [...files]
 */

const fs = require("fs");
const path = require("path");

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Usage: node scripts/stripZeroWidth.js <file> [...files]");
  process.exit(1);
}

const ZERO_WIDTH = /[\u200B\u200C\u200D\u200E\u200F\uFEFF\u2060]/g;

let total = 0;
files.forEach((file) => {
  const target = path.resolve(file);
  const source = fs.readFileSync(target, "utf8");
  const matches = source.match(ZERO_WIDTH);
  const count = matches ? matches.length : 0;

  if (count === 0) {
    console.log(`clean: ${file}`);
    return;
  }

  fs.writeFileSync(target, source.replace(ZERO_WIDTH, ""));
  total += count;
  console.log(`cleaned: ${file} (removed ${count})`);
});

console.log(`\nDone. Removed ${total} invisible character(s).`);
