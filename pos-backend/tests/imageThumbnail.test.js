const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { imageThumbnail } = require("../middlewares/imageThumbnail");

// A 1254px product photo shown at ~150px blanked the POS grid on a low-end
// tablet. `?w=320` must hand back a small copy, and nothing outside /uploads.
const run = (mw, reqPath, w) =>
  new Promise((resolve) => {
    const res = {
      type() { return this; },
      sendFile(file) { resolve({ file }); },
    };
    mw({ path: reqPath, query: w === undefined ? {} : { w: String(w) } }, res, () => resolve({ next: true }));
  });

test("?w=320 serves a 320px copy, made once and kept next to the original", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-"));
  fs.mkdirSync(path.join(root, "s1", "products"), { recursive: true });
  const src = path.join(root, "s1", "products", "a.webp");
  await sharp({ create: { width: 1254, height: 1000, channels: 3, background: "#f80" } }).webp().toFile(src);
  const mw = imageThumbnail(root);

  const first = await run(mw, "/s1/products/a.webp", 320);
  assert.equal(first.file, `${src}.w320.webp`);
  const meta = await sharp(first.file).metadata();
  assert.equal(meta.width, 320);
  assert.equal(meta.height, 255);

  const mtime = fs.statSync(first.file).mtimeMs;
  await run(mw, "/s1/products/a.webp", 320);
  assert.equal(fs.statSync(first.file).mtimeMs, mtime, "reused, not remade");
});

test("anything else falls through to the original", async () => {
  const mw = imageThumbnail(fs.mkdtempSync(path.join(os.tmpdir(), "uploads-")));
  assert.deepEqual(await run(mw, "/s1/products/a.webp"), { next: true }, "no width");
  assert.deepEqual(await run(mw, "/s1/products/a.webp", 999), { next: true }, "width not on the list");
  assert.deepEqual(await run(mw, "/s1/doc.pdf", 320), { next: true }, "not an image");
  assert.deepEqual(await run(mw, "/s1/products/missing.webp", 320), { next: true }, "missing file: the 404 is the original's");
});

test("a path outside the uploads folder is never read", async () => {
  const mw = imageThumbnail(fs.mkdtempSync(path.join(os.tmpdir(), "uploads-")));
  for (const p of ["/../../etc/x.png", "/%2e%2e/%2e%2e/x.png", "/.hidden/x.png", "/%E0%A4%A.png"]) {
    assert.deepEqual(await run(mw, p, 320), { next: true }, p);
  }
});
