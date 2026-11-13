const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { stripIds, copyableItem } = require("../services/menuTools");

test("a copied dish gets fresh ids, keeps its photo by address, loses the source store's media and stock links", () => {
  const item = {
    _id: "a1",
    name: "Gulab Jamun",
    price: 89,
    category: "Desserts",
    imageId: "m1",
    imageUrl: "https://api.example/uploads/x.webp",
    stockOffBy: ["i1"],
    variants: [{ _id: "v1", name: "2 pc", price: 89 }],
    modifierGroups: [{ _id: "g1", name: "Extra", options: [{ _id: "o1", name: "Rabri", price: 30 }] }],
    createdAt: new Date("2026-01-01"),
  };
  const c = copyableItem(item, "Sweets");
  assert.equal(c._id, undefined);
  assert.equal(c.variants[0]._id, undefined);
  assert.equal(c.modifierGroups[0].options[0]._id, undefined, "nested ids too");
  assert.equal(c.modifierGroups[0].options[0].name, "Rabri");
  assert.equal(c.imageId, undefined);
  assert.equal(c.stockOffBy, undefined);
  assert.equal(c.imageUrl, item.imageUrl);
  assert.equal(c.category, "Sweets", "it belongs to the target's category");
  assert.ok(c.createdAt instanceof Date, "dates stay dates");
  assert.deepEqual(stripIds([{ _id: 1, a: { id: 2, b: 3 } }]), [{ a: { b: 3 } }]);
});

test("copy merges and never replaces; prices change drafts only; every store is checked as linked", () => {
  const svc = fs.readFileSync(path.join(__dirname, "..", "services", "menuTools.js"), "utf8");
  assert.match(svc, /if \(have\.has\(key\(item\.name\)\)\) \{\n\s+result\.dishesSkipped \+= 1;/);
  assert.doesNotMatch(svc, /deleteOne|deleteMany|\.remove\(/, "nothing in a target is removed");
  assert.doesNotMatch(svc, /systemSnapshot|websiteSnapshot/, "only the draft: publishing is the store's step");
  const routes = fs.readFileSync(path.join(__dirname, "..", "routes", "partnerRoute.js"), "utf8");
  assert.match(routes, /const source = await ownerForLink\(await linkFor\(req\.partner, from\)\);/);
  assert.match(routes, /const target = await ownerForLink\(await linkFor\(req\.partner, storeId\)\);/);
  assert.match(routes, /const owner = await ownerForLink\(await linkFor\(req\.partner, storeId\)\);\n\s+const changed = await setPrices/);
});
