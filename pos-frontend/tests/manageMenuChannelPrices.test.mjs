import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";

// D1: Manage Menu offers the three channel prices every surface bills.
const read = (p) => fs.readFileSync(new URL(`../src/components/dashboard/${p}`, import.meta.url), "utf8");
const files = {
  drawer: read("manageMenu/ProductDrawer.jsx"),
  view: read("manageMenu/ViewProductModal.jsx"),
  list: read("ManageMenu.jsx"),
};

test("Manage Menu no longer reads or offers the website-only prices", () => {
  for (const [name, src] of Object.entries(files)) {
    assert.doesNotMatch(src, /website(Collection|Delivery|Table)/, name);
    assert.ok(!src.includes("Web Collection"), name);
  }
});

test("the product editor labels the three channel prices", () => {
  for (const label of [">Collection<", ">Delivery<", ">Table<"]) assert.ok(files.drawer.includes(label), label);
});

test("the product row shows the range the channels bill (0 or missing bills item.price)", () => {
  const block = files.list.slice(files.list.indexOf("const displayPrice"), files.list.indexOf("const ManageMenu"));
  const displayPrice = new Function(`${block}\nreturn displayPrice;`)();
  const item = (channelPrices) => ({ price: 4, samePrice: false, channelPrices });
  assert.equal(displayPrice(item({ posCollection: 4, posDelivery: 4, posTable: 6 })), "₹4 – ₹6");
  assert.equal(displayPrice(item({ posCollection: 5, posDelivery: 0, posTable: 6, websiteTable: 99 })), "₹4 – ₹6");
  assert.equal(displayPrice(item({})), "₹4");
  assert.equal(displayPrice({ price: 4, samePrice: true, channelPrices: { posTable: 6 } }), "₹4");
});
