const { test } = require("node:test");
const assert = require("node:assert/strict");

const RESTAURANT_A = "507f1f77bcf86cd799439011";
const RESTAURANT_B = "507f1f77bcf86cd799439022";
const STORE_A = "123456";
const STORE_B = "654321";

test("Website Module 8: Multi-store content isolation — Restaurant A content never leaks to Restaurant B", async () => {
  const settingsA = {
    _id: "ws-A",
    storeId: STORE_A,
    restaurantId: RESTAURANT_A,
    slug: "royal-palace",
    enabled: true,
    displayName: "Royal Palace",
    branding: { siteTitle: "Royal Palace", aboutText: "Authentic Mughlai & North Indian" },
    contact: { phone: "+91 9876543210", addressLine1: "123 MG Road", city: "Mumbai" },
  };

  const settingsB = {
    _id: "ws-B",
    storeId: STORE_B,
    restaurantId: RESTAURANT_B,
    slug: "spice-hub",
    enabled: true,
    displayName: "Spice Hub",
    branding: { siteTitle: "Spice Hub", aboutText: "South Indian Speciality" },
    contact: { phone: "+91 9123456789", addressLine1: "456 Brigade Road", city: "Bengaluru" },
  };

  const storefrontResolverMock = {
    resolveStorefront: async ({ identifier }) => {
      if (identifier === "royal-palace" || identifier === STORE_A) {
        return { ok: true, settings: settingsA, store: { storeId: STORE_A }, restaurant: { name: "Royal Palace" } };
      }
      if (identifier === "spice-hub" || identifier === STORE_B) {
        return { ok: true, settings: settingsB, store: { storeId: STORE_B }, restaurant: { name: "Spice Hub" } };
      }
      return { ok: false, status: 404 };
    },
  };

  const MenuMock = { find: () => ({ sort: () => [] }) };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../services/storefrontResolver") return storefrontResolverMock;
    if (r === "../models/menuModel") return MenuMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/storefrontController")];
  const { getStorefront } = require("../controllers/storefrontController");

  // Query Store A
  let resA = null;
  const resObjectA = {
    set: () => resObjectA,
    status: () => resObjectA,
    json: (p) => {
      resA = p;
    },
  };

  // Query Store B
  let resB = null;
  const resObjectB = {
    set: () => resObjectB,
    status: () => resObjectB,
    json: (p) => {
      resB = p;
    },
  };

  try {
    await getStorefront({ params: { slug: "royal-palace" }, headers: {} }, resObjectA, () => {});
    await getStorefront({ params: { slug: "spice-hub" }, headers: {} }, resObjectB, () => {});
  } finally {
    Module._load = orig;
  }

  assert.ok(resA);
  assert.ok(resB);

  // Store A isolation checks
  assert.equal(resA.data.store.name, "Royal Palace");
  assert.equal(resA.data.contact.phone, "+91 9876543210");
  assert.equal(resA.data.branding.aboutText, "Authentic Mughlai & North Indian");

  // Store B isolation checks
  assert.equal(resB.data.store.name, "Spice Hub");
  assert.equal(resB.data.contact.phone, "+91 9123456789");
  assert.equal(resB.data.branding.aboutText, "South Indian Speciality");

  // Zero leakage between stores
  assert.notEqual(resA.data.contact.phone, resB.data.contact.phone);
  assert.notEqual(resA.data.branding.aboutText, resB.data.branding.aboutText);
});
