/**
 * A renamed restaurant's website title and description follow the new name
 * (services/websitePublicInfo.siteText), unless someone wrote their own.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { siteText } = require("../services/websitePublicInfo");

test("the generated title and description take today's name", () => {
  const branding = {
    siteTitle: "Demo Pizza Kitchen — Order Online",
    siteDescription: "Order delicious food online from Demo Pizza Kitchen. Fast pickup and delivery.",
  };
  assert.deepEqual(siteText(branding, "Spice Route Kitchen"), {
    siteTitle: "Spice Route Kitchen — Order Online",
    siteDescription: "Order delicious food online from Spice Route Kitchen. Fast pickup and delivery.",
  });
});

test("text the owner or CSD wrote is kept", () => {
  const branding = { siteTitle: "Best biryani in Park Street", siteDescription: "Since 1985." };
  assert.deepEqual(siteText(branding, "Spice Route Kitchen"), { siteTitle: "Best biryani in Park Street", siteDescription: "Since 1985." });
});

test("no name or no branding changes nothing", () => {
  assert.deepEqual(siteText({ siteTitle: "A — Order Online" }, ""), { siteTitle: "A — Order Online", siteDescription: "" });
  assert.deepEqual(siteText(undefined, "B"), { siteTitle: "", siteDescription: "" });
});

test("the website address uses the store's subdomain, even when none was saved", () => {
  const { execFileSync } = require("node:child_process");
  const path = require("node:path");
  // config/config.js is frozen and read once, so each setup runs in its own process.
  const urls = (env) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          "-e",
          `const { buildStorefrontUrl: u } = require(${JSON.stringify(path.join(__dirname, "..", "services", "websiteProvisioningService"))});
           console.log(JSON.stringify([u({ slug: "686659", subdomain: "686659.knotkitchen.com" }), u({ slug: "686659", subdomain: "" }), u({ slug: "686659", customDomain: "pizza.in" })]));`,
        ],
        { env: { ...process.env, ...env }, encoding: "utf8" },
      )
        .trim()
        .split("\n")
        .pop(),
    );
  assert.deepEqual(urls({ STOREFRONT_ROOT_DOMAIN: "knotkitchen.com", STOREFRONT_BASE_URL: "https://csd.knotkitchen.com" }), [
    "https://686659.knotkitchen.com",
    "https://686659.knotkitchen.com", // not csd.knotkitchen.com/store/686659
    "https://pizza.in",
  ]);
  // A local setup with no root domain keeps the path form.
  assert.equal(urls({ STOREFRONT_ROOT_DOMAIN: "", STOREFRONT_BASE_URL: "http://localhost:5173" })[1], "http://localhost:5173/store/686659");
});
