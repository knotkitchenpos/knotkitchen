const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Table = require("../models/tableModel");
const { validateCapacity } = require("../controllers/tableSessionController");

/**
 * N007. Merging 3 guests into a 4-seater that has 2 wrote occupancy 5/4. Every
 * later add re-saved that table and failed its validation, so the merged table
 * could take no more dishes. The party holds both tables' seats.
 */
test("a merged party (5 on a 4-seater, 8 seats held) still takes dishes", async () => {
  const table = Table.hydrate({ _id: new mongoose.Types.ObjectId(), tableNumber: 2, capacity: 4, currentOccupancy: 5 });
  table.currentOrderId = new mongoose.Types.ObjectId(); // what an add writes before table.save()
  await table.validate();
  assert.equal(validateCapacity(table, 5, { capacity: 8 }), 5);
  assert.throws(() => validateCapacity(table, 9, { capacity: 8 }), /maximum capacity of 8/);
});
