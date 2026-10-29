const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const env = process.env;
const isProduction = env.NODE_ENV === "production";

// Production refuses to boot without real secrets; development gets an
// ephemeral one so a leaked checkout never carries a valid signing key.
function secret(name, bytes = 48) {
  const v = env[name];
  if (v && v.length >= 32) return v;
  if (isProduction) throw new Error(`${name} must be set (>= 32 chars) in production`);
  return crypto.randomBytes(bytes).toString("base64");
}

function encryptionKey() {
  const v = env.DATA_ENCRYPTION_KEY;
  if (v) {
    const k = Buffer.from(v, "base64");
    if (k.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes, base64");
    return k;
  }
  if (isProduction) throw new Error("DATA_ENCRYPTION_KEY must be set in production");
  // Stable in development so technician OTPs survive a restart.
  return crypto.createHash("sha256").update("kkmdm-dev-only-key").digest();
}

const config = {
  isProduction,
  port: Number(env.PORT) || 8100,
  mongoUri: env.MONGODB_URI || "mongodb://127.0.0.1:27018/kkmdm?replicaSet=rs0",
  knotkitchenMongoUri: env.KNOTKITCHEN_MONGODB_URI || "",
  adminJwtSecret: secret("ADMIN_JWT_SECRET"),
  dataKey: encryptionKey(),
  publicUrl: (env.PUBLIC_URL || "http://localhost:8100").replace(/\/$/, ""),
  agentApkUrl: env.AGENT_APK_URL || "",
  agentSignatureChecksum: env.AGENT_SIGNATURE_CHECKSUM || "",
  agentPackage: "com.knotkitchen.mdm",
  agentAdminComponent: "com.knotkitchen.mdm/.AdminReceiver",
  posPackage: "com.knotkitchen.pos",
  storageDir: path.join(__dirname, "..", "storage"),
  superAdminEmail: env.SUPERADMIN_EMAIL || "admin@knotkitchen.com",
  superAdminPassword: env.SUPERADMIN_PASSWORD || "",
  dashboardOrigins: (env.DASHBOARD_ORIGINS || "http://localhost:5177").split(",").map((s) => s.trim()).filter(Boolean),
  alertWebhookUrl: env.ALERT_WEBHOOK_URL || "",
  adminSessionMinutes: 60,
  reauthWindowMinutes: 5,
  enrollTokenDefaultTtlHours: 24,
  heartbeatSeconds: 60,
  offlineAfterSeconds: 180,
};

module.exports = config;
