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
