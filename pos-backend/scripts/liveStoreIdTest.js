/**
 * liveStoreIdTest.js
 * Boots the POS API in-process and hits the real /store/validate-id route.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const express = require("express");
const cookieParser = require("cookie-parser");
const config = require("../config/config");

(async () => {
  await mongoose.connect(config.databaseURI);
  console.log(`Connected to: ${mongoose.connection.name}\n`);

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/user", require("../routes/userRoute"));
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ success: false, message: err.message });
  });

  const server = app.listen(0);
  const port = server.address().port;

  const activeIds = (
    await mongoose.connection.db.collection("stores").find({ isDeleted: { $ne: true } }).toArray()
  ).map((s) => s.storeId);

  const testIds = [...activeIds, "111111"];

  for (const storeId of testIds) {
    const res = await fetch(`http://127.0.0.1:${port}/api/user/store/validate-id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId }),
    });
    const body = await res.json();
    const label = res.ok ? "PASS" : "FAIL";
    console.log(`[${label}] ${storeId} -> ${res.status} ${body.message}${body.data ? ` (${body.data.storeName})` : ""}`);
  }

  server.close();
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
