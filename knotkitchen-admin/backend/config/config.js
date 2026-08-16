require("dotenv").config();

const crypto = require("crypto");

const nodeEnv = process.env.NODE_ENV || "development";
const isProd = nodeEnv === "production";

/**
 * Same secret-loader contract as pos-backend/config/config.js.
 *
 * The old code shipped:
 *   ADMIN_JWT_SECRET fallback = "knotkitchen-remote-admin-secret"
 * That value was in the git repository, meaning anyone with source access
 * could forge an admin JWT and take over every restaurant. We now refuse to
 * boot in production without a strong secret, and use an ephemeral random
 * secret in development so the fallback never provides a working key.
 */
const requireSecret = (name, { minLength = 32 } = {}) => {
  const value = process.env[name];
  if (value && value.length >= minLength) return value;
  if (isProd) {
    // eslint-disable-next-line no-console
    console.error(
      `[FATAL] Admin backend requires ${name} (>= ${minLength} chars) in production. Refusing to start.`
    );
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.warn(`[SECURITY] Admin backend using an ephemeral ${name}; set it in .env to persist tokens.`);
  return crypto.randomBytes(48).toString("hex");
};

// The seed admin password guard rejects weak values in production so a fresh
// deployment cannot go live with "admin123".
const WEAK_ADMIN_PASSWORDS = new Set([
  "admin",
  "admin123",
  "password",
  "changeme",
  "123456",
  "letmein",
]);

const resolveSeedAdminPassword = () => {
  const supplied = (process.env.ADMIN_PASSWORD || "").trim();
  if (isProd) {
    if (!supplied || supplied.length < 12 || WEAK_ADMIN_PASSWORDS.has(supplied.toLowerCase())) {
      // eslint-disable-next-line no-console
      console.error(
        "[FATAL] Admin backend requires ADMIN_PASSWORD (>= 12 chars, not a common default) in production."
      );
      process.exit(1);
    }
    return supplied;
  }
  // Dev-only convenience default; still swapped out by the operator via .env.
  return supplied || "admin123";
};

const config = Object.freeze({
  port: process.env.PORT || 4000,
  databaseURI:
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    process.env.DATABASE_URL ||
    "mongodb://127.0.0.1:27017/pos-db",

  nodeEnv,
  isProduction: isProd,

  adminSecret: requireSecret("ADMIN_JWT_SECRET"),
  adminTokenExpiry: process.env.ADMIN_TOKEN_EXPIRY || "2h",

  seedAdminEmail: (process.env.ADMIN_EMAIL || "admin@knotkitchen.io").trim().toLowerCase(),
  seedAdminPassword: resolveSeedAdminPassword(),
});

module.exports = config;
