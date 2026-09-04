/**
 * Ordering a product that has a modifier group attached.
 *
 * calculateUnitPrice returned its modifiers as bare strings (["Extra Cheese"]),
 * but every schema that stores them -- TableSession.items.modifiers and
 * Order.items.modifiers -- declares [{ name: String, price: Number }].
 * Mongoose therefore threw "Cast to embedded failed" the moment the session
 * was saved, so ANY table or QR order containing a selected modifier failed,
 * while products without groups went through fine.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const priceService = require("../services/price");
const TableSession = require("../models/tableSessionModel");
const Order = require("../models/orderModel");

const oid = () => new mongoose.Types.ObjectId();

const itemWithGroup = ({ required = true, maxSelections = 5 } = {}) => {
  const optionId = oid();
  const groupId = oid();
  return {
    item: {
      _id: oid(),
      name: "Nutella Brownie",
      price: 129,
      modifierGroups: [
        {
          _id: groupId,
          name: "Sauce",
          required,
          maxSelections,
          options: [
            { _id: optionId, name: "Tomato Sauce", price: 5, isAvailable: true },
            { _id: oid(), name: "Mint Sauce", price: 7, isAvailable: true },
          ],
        },
      ],
    },
    groupId,
    optionId,
  };
};

test("REGRESSION: modifiers come back as { name, price }, not strings", () => {
  const { item, groupId, optionId } = itemWithGroup();

  const { unitPrice, modifiers } = priceService.calculateUnitPrice({
    item,
    modifierSelections: [
      { groupId: String(groupId), groupName: "Sauce", optionId: String(optionId), optionName: "Tomato Sauce", quantity: 1 },
    ],
  });

  assert.equal(unitPrice, 134, "base 129 + 5 sauce");
  assert.equal(modifiers.length, 1);
  assert.equal(typeof modifiers[0], "object", "a bare string cannot be cast into the subdocument");
  assert.deepEqual(modifiers[0], { name: "Tomato Sauce", price: 5 });
});

test("REGRESSION: a session with modifiers actually validates", () => {
  const { item, groupId, optionId } = itemWithGroup();
  const { unitPrice, modifiers } = priceService.calculateUnitPrice({
    item,
    modifierSelections: [{ groupId: String(groupId), optionId: String(optionId), quantity: 1 }],
  });

  const session = new TableSession({
    sessionCode: "T-1",
    restaurantId: oid(),
    tableId: oid(),
    items: [{ menuItemId: item._id, name: item.name, quantity: 1, price: unitPrice, total: unitPrice, modifiers }],
  });

  const err = session.validateSync();
  assert.equal(err, undefined, err && err.message);
  // The old shape was not merely mis-typed: it was silently emptied.
  assert.equal(session.items[0].modifiers.length, 1);
  assert.equal(session.items[0].modifiers[0].name, "Tomato Sauce");
  assert.equal(session.items[0].modifiers[0].price, 5);
});

test("REGRESSION: the kitchen order validates with the same shape", () => {
  const { item, groupId, optionId } = itemWithGroup();
  const { unitPrice, modifiers } = priceService.calculateUnitPrice({
    item,
    modifierSelections: [{ groupId: String(groupId), optionId: String(optionId), quantity: 1 }],
  });

  const order = new Order({
    orderNumber: "ORD-1",
    restaurantId: oid(),
    customerDetails: { name: "Guest", phone: "", guests: 1 },
    items: [{ name: item.name, quantity: 1, price: unitPrice, total: unitPrice, modifiers }],
    bills: { total: unitPrice, tax: 0, totalWithTax: unitPrice },
  });

  const err = order.validateSync();
  const modifierErrors = err ? Object.keys(err.errors).filter((k) => k.includes("modifiers")) : [];
  assert.deepEqual(modifierErrors, [], "modifiers must cast cleanly");
  assert.equal(order.items[0].modifiers[0].name, "Tomato Sauce");
});

test("a quantity of 2 bills and lists the option twice", () => {
  const { item, groupId, optionId } = itemWithGroup();
  const { unitPrice, modifiers } = priceService.calculateUnitPrice({
    item,
    modifierSelections: [{ groupId: String(groupId), optionId: String(optionId), quantity: 2 }],
  });
  assert.equal(unitPrice, 139, "base 129 + 5 x2");
  assert.equal(modifiers.length, 2);
  assert.deepEqual(modifiers, [
    { name: "Tomato Sauce", price: 5 },
    { name: "Tomato Sauce", price: 5 },
  ]);
});

test("a product with no groups still yields an empty list", () => {
  const { unitPrice, modifiers } = priceService.calculateUnitPrice({
    item: { _id: oid(), name: "Plain Tea", price: 20 },
    modifierSelections: [],
  });
  assert.equal(unitPrice, 20);
  assert.deepEqual(modifiers, []);
});

test("a required group with nothing chosen is still rejected", () => {
  const { item } = itemWithGroup({ required: true });
  assert.throws(
    () => priceService.calculateUnitPrice({ item, modifierSelections: [] }),
    /Please select "Sauce"/,
  );
});
