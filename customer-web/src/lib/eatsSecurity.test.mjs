import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The Maps browser key reaches the page only from GET /api/eats/config at run
// time (contract §4.2): never committed, never baked in by a VITE_* variable.

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const self = fileURLToPath(import.meta.url);

const sources = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.(m?js|jsx|html|css)$/.test(e.name) && p !== self ? [p] : [];
  });
const files = [...sources(path.join(root, "src")), path.join(root, "index.html")];
const rel = (p) => path.relative(root, p).replace(/\\/g, "/");

test("no Google API key anywhere in the source", () => {
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /AIza[0-9A-Za-z_-]{35}/, rel(f));
});

test("only lib/googleMaps.js talks to the Maps host", () => {
  const host = "maps." + "googleapis.com";
  const using = files.filter((f) => fs.readFileSync(f, "utf8").includes(host)).map(rel);
  assert.deepEqual(using, ["src/lib/googleMaps.js"]);
});

test("no VITE_*MAPS* variable in the source or the env files", () => {
  const envs = fs.readdirSync(root).filter((n) => n.startsWith(".env")).map((n) => path.join(root, n));
  for (const f of [...files, ...envs]) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /VITE_\w*MAPS/i, rel(f));
});

test("REGRESSION (C2): Places suggestions carry Google's current attribution, not 'Powered by Google'", () => {
  const picker = fs.readFileSync(path.join(root, "src/eats/components/LocationPicker.jsx"), "utf8");
  assert.doesNotMatch(picker, />\s*Powered by Google\s*</);
  // The exact text, untranslated, at Google's minimum 12px in an allowed gray.
  assert.match(picker, /<p translate="no"[^>]*font: "400 12px Roboto, sans-serif", color: "#5E5E5E"[^>]*>\s*Google Maps\s*<\/p>/);
});
