const mongoose = require("mongoose");
const config = require("../config/config");

const run = async () => {
  const Table = require("../models/tableModel");
  const TableSession = require("../models/tableSessionModel");

  await mongoose.connect(config.databaseURI);

  const activeSessions = await TableSession.find({
    status: { $in: ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"] },
    isDeleted: { $ne: true },
  });

  let updated = 0;
  for (const session of activeSessions) {
    await Table.updateOne(
      { _id: session.tableId, isDeleted: { $ne: true } },
      { $set: { currentOccupancy: session.customerCount || 0, status: "occupied" } }
    );
    updated++;
  }

  const activeTableIds = activeSessions.map((s) => s.tableId);
  await Table.updateMany(
    {
      status: "occupied",
      _id: { $nin: activeTableIds },
      isDeleted: { $ne: true },
    },
    { $set: { currentOccupancy: 0, status: "available", currentOrderId: null } }
  );

  await Table.syncIndexes();
  await TableSession.syncIndexes();

  console.log(`Migration complete. ${updated} tables synced.`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(`Migration failed: ${err.message}`);
  process.exit(1);
});