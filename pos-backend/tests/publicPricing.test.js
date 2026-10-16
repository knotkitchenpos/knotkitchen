const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("module");

const { PlatformBillingConfig } = require("../models/platformBillingModel");
const appConfig = require("../config/config");

/**
 * knotkitchen.com's pricing comes from the CSD catalogue (GET /api/public/pricing),
 * and devices carry a picture uploaded in CSD Billing. Owner request 2026-10-16.
 */

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const IMG = (id = "0f8fad5b-d9cb-469f-a165-70867728950e") => `${appConfig.mediaPublicBaseUrl}/platform/devices/${id}.webp`;

const withFakes = async (fakes, modulePath, run) => {
  const orig = Module._load;
  Module._load = function load(r) {
    if (Object.prototype.hasOwnProperty.call(fakes, r)) return fakes[r];
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve(modulePath)];
  try {
    return await run(require(modulePath));
  } finally {
    Module._load = orig;
    delete require.cache[require.resolve(modulePath)];
  }
};

const call = async (handler, req = {}) => {
  const out = { headers: {} };
  const res = {
    set(k, v) { out.headers[k] = v; return res; },
    status(c) { out.status = c; return res; },
    json(b) { out.body = b; return res; },
  };
  await handler(req, res, (err) => { out.error = err; });
  return out;
};

const catalogue = () => new PlatformBillingConfig({
  addons: [
    { code: "GMB", name: "GMB Management", description: "Profile upkeep", pricePaise: 10000, sortOrder: 3 },
    { code: "WEBSITE", name: "Website", description: "Your own site", pricePaise: 360000, periodDays: 365, feature: "website", sortOrder: 2 },
    { code: "KDS", name: "Kitchen display", pricePaise: 15000, isActive: false, sortOrder: 1 },
    // Retired by code: never listed, whatever its switch says.
    { code: "TABLE_QR", name: "QR Table Ordering", pricePaise: 20000, isActive: true, sortOrder: 0 },
  ],
  printers: [
    { code: "TABLET", name: "Tablet", description: "10-inch Android tablet", pricePaise: 1000000, imageUrl: IMG() },
    { code: "PRINTER_2IN", name: "2-inch Bluetooth printer", pricePaise: 170000, isActive: false },
    { code: "PRINTER_3IN_LAN", name: "3-inch LAN printer", pricePaise: 390050 },
  ],
});

test("the public pricing is the catalogue: plans, on-sale add-ons and devices, the charges", () => {
  const { publicPricing } = require("../controllers/publicPricingController");
  const got = publicPricing(catalogue());
  assert.deepEqual(got, {
    currency: "INR",
    periodDays: 30,
    plans: [
      { code: "POS", name: "POS", price: 499, firstRechargeMin: 3000, topUpMin: 1000 },
      { code: "BILLING", name: "Billing", price: 199, firstRechargeMin: 3000, topUpMin: 1500 },
    ],
    addons: [
      { code: "WEBSITE", name: "Website", description: "Your own site", price: 3600, periodDays: 365 },
      { code: "GMB", name: "GMB Management", description: "Profile upkeep", price: 100, periodDays: 30 },
    ],
    devices: [
      { code: "TABLET", name: "Tablet", description: "10-inch Android tablet", price: 10000, imageUrl: IMG() },
      { code: "PRINTER_3IN_LAN", name: "3-inch LAN printer", description: "", price: 3900.5, imageUrl: "" },
    ],
    charges: { website: 3, qr: 1, knotEats: 9, ebill: 0.25 },
    taxable: { website: true, qr: true, knotEats: true, ebill: true },
  });
  // CSD sets a charge to "Not taxable": the site drops its "+ GST".
  const config = catalogue();
  config.ebillCharge.taxable = false;
  assert.deepEqual(publicPricing(config).taxable, { website: true, qr: true, knotEats: true, ebill: false });
});

test("never a store's negotiated price: the endpoint does not read per-store overrides", () => {
  const src = SRC("controllers/publicPricingController.js");
  assert.doesNotMatch(src, /require\([^)]*csdStoreCharges/i);
  assert.doesNotMatch(src, /\b(getOverride|priceFor)\b|restaurantId/);
  // Nothing in the payload names a store either.
  const body = JSON.stringify(require("../controllers/publicPricingController").publicPricing(catalogue()));
  assert.doesNotMatch(body, /planPrices|restaurant|storeId|gstin/i);
});

test("GET /api/public/pricing is public, rate limited and cached a minute; a CSD save clears the cache", async () => {
  const route = SRC("routes/publicStoreRoute.js");
  assert.match(route, /router\.get\("\/pricing", pricingLimiter, getPublicPricing\)/);
  assert.match(SRC("controllers/csdBillingConfigController.js"), /await config\.save\(\);\s*\/\/[^\n]*\n\s*clearPricingCache\(\);/);

  let reads = 0;
  const config = catalogue();
  await withFakes(
    { "../services/pricing": { ...require("../services/pricing"), getPlatformConfig: async () => (reads += 1, config) } },
    "../controllers/publicPricingController",
    async (ctrl) => {
      const first = await call(ctrl.getPublicPricing);
      assert.equal(first.status, 200);
      assert.equal(first.headers["Cache-Control"], "public, max-age=60");
      assert.equal(first.body.data.plans[0].price, 499);
      config.basePlan.pricePaise = 59900;
      assert.equal((await call(ctrl.getPublicPricing)).body.data.plans[0].price, 499, "served from the cache");
      assert.equal(reads, 1);
      ctrl.clearPricingCache();
      assert.equal((await call(ctrl.getPublicPricing)).body.data.plans[0].price, 599, "re-read after a save");
      assert.equal(reads, 2);
    },
  );
});

test("CSD device rows: description and picture are kept when left out, and only our own upload URL is taken", () => {
  const { readCatalog } = require("../controllers/csdBillingConfigController");
  const current = [{ code: "TABLET", name: "Tablet", pricePaise: 1000000, description: "10-inch", imageUrl: IMG() }];
  const read = (rows, cur = current) => {
    const errors = {};
    return { items: readCatalog(rows, "printers", errors, new Set(), { current: cur }), errors };
  };

  // A CSD page from before pictures existed sends neither field.
  const old = read([{ code: "TABLET", name: "Tablet", price: 10000 }]);
  assert.deepEqual(old.errors, {});
  assert.deepEqual([old.items[0].description, old.items[0].imageUrl], ["10-inch", IMG()]);

  const fresh = IMG("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
  const swapped = read([{ code: "TABLET", name: "Tablet", price: 10000, description: ` ${"x".repeat(400)} `, imageUrl: fresh }]);
  assert.deepEqual(swapped.errors, {});
  assert.equal(swapped.items[0].imageUrl, fresh);
  assert.equal(swapped.items[0].description.length, 300);

  assert.equal(read([{ code: "TABLET", name: "Tablet", price: 10000, imageUrl: "" }]).items[0].imageUrl, "", "removed");

  for (const bad of [
    "https://evil.example/x.webp",
    "javascript:alert(1)",
    `${appConfig.mediaPublicBaseUrl}/148379/products/0f8fad5b-d9cb-469f-a165-70867728950e.webp`,
    `${appConfig.mediaPublicBaseUrl}/platform/devices/../../x.webp`,
    `${IMG()}?x=1`,
  ]) {
    const got = read([{ code: "TABLET", name: "Tablet", price: 10000, imageUrl: bad }]);
    assert.match(got.errors["printers.0.imageUrl"] || "", /Upload the picture here/, bad);
  }
  // A picture saved earlier stays valid as it is (the media host may have moved since).
  const legacy = "https://cdn.old.example/tablet.webp";
  assert.deepEqual(read([{ code: "TABLET", name: "Tablet", price: 10000, imageUrl: legacy }], [{ ...current[0], imageUrl: legacy }]).errors, {});
});

test("CSD present() shows each device's description and picture", () => {
  const { present } = require("../controllers/csdBillingConfigController");
  const shown = present(catalogue()).printers[0];
  assert.deepEqual([shown.description, shown.imageUrl], ["10-inch Android tablet", IMG()]);
});

test("a CSD save keeps the device picture and clears the public cache", async () => {
  const config = catalogue();
  let saves = 0;
  let cleared = 0;
  config.save = async () => { saves += 1; return config; };
  await withFakes(
    {
      "../services/pricing": { getPlatformConfig: async () => config },
      "../services/csdAuditService": { csdAudit: async () => {} },
      "./publicPricingController": { clearPricingCache: () => { cleared += 1; } },
    },
    "../controllers/csdBillingConfigController",
    async (ctrl) => {
      const rows = ctrl.present(config).printers.map(({ code, name, price, isActive }) => ({ code, name, price, isActive }));
      const out = await call(ctrl.updateBillingConfig, { body: { printers: rows }, csdStaff: {} });
      assert.equal(out.status, 200, JSON.stringify(out.error?.fieldErrors));
      assert.equal(config.printers[0].imageUrl, IMG());
      assert.deepEqual([saves, cleared], [1, 1]);
    },
  );
});

test("device picture upload: CSD admins only, checked, compressed to WebP, stored under platform/devices", async () => {
  const route = SRC("routes/csdRoute.js");
  assert.match(route, /router\.post\("\/billing\/device-image", requireCsdAdmin, deviceImageLimiter, singleImageUpload, uploadDeviceImage\)/);
  // After router.use(requireCsdAuth): signed in, then admin.
  assert.ok(route.indexOf("router.use(requireCsdAuth)") < route.indexOf('"/billing/device-image"'));
  const ctrlSrc = SRC("controllers/csdBillingConfigController.js");
  assert.doesNotMatch(ctrlSrc, /csdDocumentStorage|MediaAsset/, "not the private document store, not a store's library");

  const stored = [];
  const storage = {
    upload: async (a) => (stored.push(a), { url: `${appConfig.mediaPublicBaseUrl}/${a.storeId}/${a.folder}/0f8fad5b-d9cb-469f-a165-70867728950e.webp` }),
  };
  await withFakes({ "../services/storage/localProvider": storage }, "../controllers/csdBillingConfigController", async (ctrl) => {
    // A cross-site form carries the CSD cookie (SameSite=None) but cannot set X-CSD.
    const small = await require("sharp")({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).jpeg().toBuffer();
    const forged = await call(ctrl.uploadDeviceImage, { headers: {}, uploadedFile: { buffer: small, fileName: "x.jpg" } });
    assert.equal(forged.error.status, 403);
    const H = { "x-csd": "1" };

    const none = await call(ctrl.uploadDeviceImage, { headers: H });
    assert.equal(none.error.status, 400);

    const notImage = await call(ctrl.uploadDeviceImage, { headers: H, uploadedFile: { buffer: Buffer.from("<svg onload=alert(1)>".padEnd(200, " ")), fileName: "x.svg" } });
    assert.equal(notImage.error.status, 400);
    assert.match(notImage.error.message, /Unsupported file type/);

    const huge = Buffer.alloc(5 * 1024 * 1024 + 1);
    huge.set([0xff, 0xd8, 0xff]);
    const tooBig = await call(ctrl.uploadDeviceImage, { headers: H, uploadedFile: { buffer: huge, fileName: "big.jpg" } });
    assert.equal(tooBig.error.status, 400);
    assert.match(tooBig.error.message, /5MB or smaller/);
    assert.equal(stored.length, 0, "nothing stored for a refused file");

    const photo = await require("sharp")({ create: { width: 2400, height: 1800, channels: 3, background: "#f4620a" } }).jpeg().toBuffer();
    const ok = await call(ctrl.uploadDeviceImage, { headers: H, uploadedFile: { buffer: photo, fileName: "tablet.jpg" } });
    assert.equal(ok.status, 201, ok.error?.message);
    assert.equal(ok.body.data.url, IMG());
    assert.equal(ctrl.isDeviceImageUrl(ok.body.data.url), true, "what it hands out is what a save accepts");
    assert.deepEqual([stored[0].storeId, stored[0].folder, stored[0].mimeType], ["platform", "devices", "image/webp"]);
    const meta = await require("sharp")(stored[0].buffer).metadata();
    assert.equal(meta.format, "webp");
    assert.ok(Math.max(meta.width, meta.height) <= 1600, "shrunk like item photos");
  });
});

test("CSD Billing: each device row uploads a picture and edits its description; Save sends them", () => {
  const CSD = (rel) => fs.readFileSync(path.join(__dirname, "..", "..", "csd-web", "src", rel), "utf8");
  const api = CSD("api/index.js");
  assert.match(api, /uploadDeviceImage: \(file\) => \{[\s\S]*?body\.append\("file", file\);[\s\S]*?api\.post\("\/billing\/device-image", body, \{[^}]*headers: \{ "X-CSD": "1" \}/);
  const page = CSD("pages/Billing.jsx");
  assert.match(page, /onChange\(\(await billingConfig\.uploadDeviceImage\(file\)\)\.url\)/);
  assert.match(page, /<DevicePicture[\s\S]*?error=\{fieldErrors\[`printers\.\$\{i\}\.imageUrl`\]\}[\s\S]*?onChange=\{\(imageUrl\) => setItem\("printers", i, \{ imageUrl \}\)\}/);
  assert.match(page, /setItem\("printers", i, \{ description: e\.target\.value \}\)/);
  assert.match(page, /addItem\("printers", \{ code: "", name: "", price: 0, isActive: true, description: "", imageUrl: "" \}\)/);
});
