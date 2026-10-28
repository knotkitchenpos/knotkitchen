const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("module");
const sharp = require("sharp");

const { toWebp, TARGET_BYTES } = require("../services/imageCompress");

test("any photo becomes WebP of about 200 KB at most, never bigger than 1600px", async () => {
  // Noise barely compresses: the worst case for the size limit.
  const png = await sharp({
    create: { width: 3000, height: 2000, channels: 3, background: "#888", noise: { type: "gaussian", mean: 128, sigma: 40 } },
  })
    .png()
    .toBuffer();
  const out = await toWebp(png);
  assert.equal(out.mimeType, "image/webp");
  assert.ok(out.buffer.length <= TARGET_BYTES, `${out.buffer.length} bytes`);
  assert.ok(Math.max(out.width, out.height) <= 1600);
  const meta = await sharp(out.buffer).metadata();
  assert.equal(meta.format, "webp");

  // A small photo is not blown up.
  const small = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#f80" } }).jpeg().toBuffer();
  const s = await toWebp(small);
  assert.deepEqual([s.width, s.height], [300, 200]);
});

test("REGRESSION: every upload is stored as WebP only, in every folder; the original is never written", () => {
  const ctrl = fs.readFileSync(path.join(__dirname, "..", "controllers", "mediaController.js"), "utf8");
  const upload = ctrl.slice(ctrl.indexOf("const uploadMedia"), ctrl.indexOf("const updateMedia"));
  assert.match(upload, /const image = await toWebp\(req\.uploadedFile\.buffer, optionsForFolder\(folder\)\);/);
  assert.match(upload, /const fileName = validation\.fileName\.replace\(\/\\\.\[a-z0-9\]\+\$\/i, ""\) \+ "\.webp";/);
  assert.doesNotMatch(upload, /folder === "products"/, "no folder is exempt");
  // What is stored is the converted buffer, not the upload.
  assert.match(upload, /storage\.upload\(\{\s*buffer: image\.buffer,/);
  assert.equal(upload.match(/storage\.upload\(/g).length, 1, "and nothing else is uploaded beside it");
});

test("a logo or receipt QR stays lossless and keeps its transparency", async () => {
  const { optionsForFolder } = require("../services/imageCompress");
  const logo = await sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 253, g: 83, b: 2, alpha: 0 } } })
    .composite([{ input: Buffer.from('<svg width="400" height="400"><circle cx="200" cy="200" r="150" fill="#FD5302"/></svg>') }])
    .png()
    .toBuffer();
  const out = await toWebp(logo, optionsForFolder("logo"));
  const meta = await sharp(out.buffer).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.hasAlpha, true, "transparent corners stay transparent");
  // Lossless: every pixel comes back exactly.
  const [a, b] = await Promise.all([sharp(logo).raw().toBuffer(), sharp(out.buffer).raw().toBuffer()]);
  assert.ok(a.equals(b));
  assert.deepEqual(optionsForFolder("general"), { lossless: true });
  assert.deepEqual(optionsForFolder("cover"), { targetBytes: 400 * 1024 });
  assert.deepEqual(optionsForFolder("products"), {}, "item photos keep the 200 KB rule");
});

test("a lossless image too big for the limit falls back to the lossy steps", async () => {
  const noisy = await sharp({
    create: { width: 1600, height: 1600, channels: 3, background: "#888", noise: { type: "gaussian", mean: 128, sigma: 40 } },
  })
    .png()
    .toBuffer();
  const out = await toWebp(noisy, { lossless: true });
  assert.ok(out.buffer.length <= TARGET_BYTES, `${out.buffer.length} bytes`);
});

test("SOURCE: the one-off conversion only touches files nothing points at, and reports unless told to apply", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "convertMediaToWebp.js"), "utf8");
  assert.match(src, /const APPLY = process\.argv\.includes\("--apply"\);/);
  assert.match(src, /if \(!APPLY\) \{/);
  assert.match(src, /const refs = referencedFrom\(row\.storageKey\);\s*if \(refs\.length\) \{\s*kept\.push/);
  // The original goes only after the row points at the WebP.
  assert.ok(src.indexOf("await MediaAsset.updateOne(") < src.indexOf("await removeWithCopies(abs);"));
  assert.match(src, /toWebp\(await fs\.readFile\(abs\), optionsForFolder\(row\.folder\)\)/, "converted exactly as an upload is now");
});

test("REGRESSION: a CSV import keeps the photo of every item whose name did not change", async () => {
  const saved = [];
  const existing = [
    { name: "Sandwiches", items: [{ name: "Paneer Tikka", imageUrl: "/uploads/1/products/paneer.webp", imageThumbnailUrl: "", image: "" }, { name: "Veg Club" }] },
    { name: "Drinks", items: [{ name: "Masala Chai", imageUrl: "/uploads/1/products/chai.webp" }] },
  ];
  function Menu(doc) {
    Object.assign(this, doc);
    this.save = async () => saved.push(doc);
  }
  Menu.find = () => ({ select: () => ({ lean: async () => existing }) });
  Menu.deleteMany = async () => ({ deletedCount: existing.length });

  const orig = Module._load;
  Module._load = function (request) {
    if (request === "../models/menuModel") return Menu;
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve("../controllers/csvMenuController")];
  let ctrl;
  try {
    ctrl = require("../controllers/csvMenuController");
  } finally {
    Module._load = orig;
  }

  const csvText = [
    "Category,Subcategory,Item Name,Description,Veg/Non-Veg,Price",
    "Sandwiches,,Paneer Tikka,,Veg,199", // unchanged: keeps its photo
    "Sandwiches,,Veg Club Deluxe,,Veg,149", // renamed: no photo
    "Beverages,,masala chai ,,Veg,20", // moved category, same name: keeps its photo
  ].join("\n");
  let body;
  await ctrl.confirmCsvImport(
    { body: { csvText }, user: { _id: "u1", restaurantId: "r1" } },
    { status: () => ({ json: (b) => (body = b) }) },
    (err) => {
      throw err;
    },
  );
  assert.equal(body.success, true);
  const items = Object.fromEntries(saved.flatMap((m) => m.items).map((i) => [i.name, i]));
  assert.equal(items["Paneer Tikka"].imageUrl, "/uploads/1/products/paneer.webp");
  assert.equal(items["Veg Club Deluxe"].imageUrl, undefined);
  assert.equal(items["masala chai"].imageUrl, "/uploads/1/products/chai.webp");
});
