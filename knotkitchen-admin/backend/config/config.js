require("dotenv").config();

const config = Object.freeze({
  port: process.env.PORT || 4000,
  databaseURI: process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/knotkitchen",
  nodeEnv: process.env.NODE_ENV || "development",
  adminSecret: process.env.ADMIN_JWT_SECRET || "knotkitchen-remote-admin-secret",
  adminTokenExpiry: process.env.ADMIN_TOKEN_EXPIRY || "2h",

  // Seed super admin account (created on first run)
  seedAdminEmail: process.env.ADMIN_EMAIL || "admin@knotkitchen.io",
  seedAdminPassword: process.env.ADMIN_PASSWORD || "admin123",
});

module.exports = config;