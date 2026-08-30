const mongoose = require("mongoose");
const config = require("./config");

const connectDB = async () => {
  try {
    // Bounded explicitly — see the note in pos-backend/config/database.js.
    // The admin portal is low-traffic (a handful of staff), so it needs far
    // fewer connections than the POS API and must not sit on the driver's
    // default of 100 against a shared cluster.
    const conn = await mongoose.connect(config.databaseURI, {
      maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) || 10,
    });
    console.log(`✅ Admin Portal connected to MongoDB: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.error(`❌ MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;