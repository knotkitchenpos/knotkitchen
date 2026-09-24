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

test("item and category uploads go through the WebP conversion; other folders keep the original", () => {
  const ctrl = fs.readFileSync(path.join(__dirname, "..", "controllers", "mediaController.js"), "utf8");
  assert.match(ctrl, /if \(folder === "products" \|\| folder === "categories"\) \{\s*image = await require\("\.\.\/services\/imageCompress"\)\.toWebp\(req\.uploadedFile\.buffer\);/);
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
