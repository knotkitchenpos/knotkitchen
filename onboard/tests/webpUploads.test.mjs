import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

test("PNG uploads are converted to WebP in the browser, except the eSigned copy", () => {
  // "Any PNG pic uploaded in onboarding should be converted to WebP automatically."
  const handle = html.slice(html.indexOf("async function handleFile"), html.indexOf("/* ============ STEP RENDERERS"));
  assert.match(handle, /if\(key !== 'esigned'\) file = await pngToWebp\(file\);/);
  // Converted before the size check, so a PNG that fits once converted is accepted.
  assert.ok(handle.indexOf("pngToWebp(file)") < handle.indexOf("MAX_FILE_MB*1024*1024"));

  const helper = html.slice(html.indexOf("async function pngToWebp"), html.indexOf("function fmtBytes"));
  assert.match(helper, /file\.type !== 'image\/png'/, "only PNGs");
  assert.match(helper, /c\.toBlob\(res, 'image\/webp', 0\.92\)/);
  // A browser that cannot encode WebP (Safari) keeps the original PNG.
  assert.match(helper, /if\(!blob \|\| blob\.type !== 'image\/webp'\) return file;/);
  // Renamed, because the server takes the saved extension from the name.
  assert.match(helper, /file\.name\.replace\(\/\\.png\$\/i, ''\) \+ '\.webp'/);
});
