const { test } = require("node:test");
const assert = require("node:assert/strict");

const Restaurant = require("../models/restaurantModel");
const { updatePosSettings } = require("../controllers/restaurantController");

/** Run updatePosSettings against an in-memory restaurant. */
const save = async (posSettings, body) => {
  const doc = { posSettings: { ...posSettings }, save: async () => doc };
  const original = Restaurant.findOne;
  Restaurant.findOne = async () => doc;
  try {
    let status = 200;
    let payload;
    let error;
    await updatePosSettings(
      { body, user: { restaurantId: "r1" } },
      { status: (s) => ((status = s), { json: (p) => (payload = p) }) },
      (err) => (error = err),
    );
    return { doc, status, payload, error };
  } finally {
    Restaurant.findOne = original;
  }
};

test("saving one receipt setting does not reset the others", async () => {
  const { doc } = await save(
    { autoEBill: true, customMessage: "Visit again", showQrCode: true, qrCodeImage: "https://cdn.example/qr.png", showLogo: false },
    { showWebsiteLink: true, websiteLink: "www.demo-restaurant.in" },
  );
  assert.equal(doc.posSettings.autoEBill, true);
  assert.equal(doc.posSettings.customMessage, "Visit again");
  assert.equal(doc.posSettings.showQrCode, true);
  assert.equal(doc.posSettings.showLogo, false);
  assert.equal(doc.posSettings.showWebsiteLink, true);
  assert.equal(doc.posSettings.websiteLink, "https://www.demo-restaurant.in");
});

test("the QR code cannot be switched on without an image, and only image URLs are kept", async () => {
  const noImage = await save({}, { showQrCode: true, qrCodeImage: "" });
  assert.equal(noImage.error.status, 400);

  const script = await save({}, { qrCodeImage: "javascript:alert(1)" });
  assert.equal(script.doc.posSettings.qrCodeImage, "");
});

test("a website link that is not an address is refused", async () => {
  const { error } = await save({}, { websiteLink: "not a link <b>" });
  assert.equal(error.status, 400);
});
