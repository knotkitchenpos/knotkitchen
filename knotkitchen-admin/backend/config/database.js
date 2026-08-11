const mongoose = require("mongoose");
const config = require("./config");

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(config.databaseURI, {});
    console.log(`✅ Admin Portal connected to MongoDB: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.error(`❌ MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;