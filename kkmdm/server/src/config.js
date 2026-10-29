const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const env = process.env;
const isProduction = env.NODE_ENV === "production";

const storageDir = env.KKMDM_STORAGE_DIR || path.join(__dirname, "..", "storage");

/**
 * Production secrets not given in the environment are generated once and kept
 * in storage/secrets.json (0600), on the same volume as the APK repository, so
 * a deploy needs no hand-edited .env and a restart keeps sessions and the
 * technician-OTP key. A value in the environment always wins.
 */
function persisted(name, make) {
  const file = path.join(storageDir, "secrets.json");
  let all = {};
  try {
    all = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* first boot */
  }
  if (!all[name]) {
    all[name] = make();
    fs.mkdirSync(storageDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(all, null, 2), { mode: 0o600 });
  }
  return all[name];
}

// Development gets an ephemeral one so a leaked checkout never carries a valid signing key.
function secret(name, bytes = 48) {
  const v = env[name];
  if (v && v.length >= 32) return v;
  if (v) throw new Error(`${name} must be >= 32 chars`);
  if (isProduction) return persisted(name, () => crypto.randomBytes(bytes).toString("base64"));
  return crypto.randomBytes(bytes).toString("base64");
}

function encryptionKey() {
  const v = env.DATA_ENCRYPTION_KEY || (isProduction ? persisted("DATA_ENCRYPTION_KEY", () => crypto.randomBytes(32).toString("base64")) : "");
  if (v) {
    const k = Buffer.from(v, "base64");
    if (k.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes, base64");
    return k;
  }
  // Stable in development so technician OTPs survive a restart.
  return crypto.createHash("sha256").update("kkmdm-dev-only-key").digest();
}

const config = {
  isProduction,
  port: Number(env.PORT) || 8100,
  mongoUri: env.MONGODB_URI || "mongodb://127.0.0.1:27018/kkmdm?replicaSet=rs0",
  // Production shares the POS cluster's connection string; this keeps KKMDM in its own database.
  mongoDbName: env.KKMDM_DB_NAME || undefined,
  knotkitchenMongoUri: env.KNOTKITCHEN_MONGODB_URI || "",
  adminJwtSecret: secret("ADMIN_JWT_SECRET"),
  dataKey: encryptionKey(),
  publicUrl: (env.PUBLIC_URL || "http://localhost:8100").replace(/\/$/, ""),
  agentApkUrl: env.AGENT_APK_URL || "",
  agentSignatureChecksum: env.AGENT_SIGNATURE_CHECKSUM || "",
  agentPackage: "com.knotkitchen.mdm",
  agentAdminComponent: "com.knotkitchen.mdm/.AdminReceiver",
  posPackage: "com.knotkitchen.pos",
  storageDir,
  // The built dashboard (dashboard/dist), served at / in the container.
  dashboardDir: env.DASHBOARD_DIR || "",
  superAdminEmail: env.SUPERADMIN_EMAIL || "admin@knotkitchen.com",
  superAdminPassword: env.SUPERADMIN_PASSWORD || "",
  dashboardOrigins: (env.DASHBOARD_ORIGINS || "http://localhost:5177").split(",").map((s) => s.trim()).filter(Boolean),
  alertWebhookUrl: env.ALERT_WEBHOOK_URL || "",
  // Hosts the Applications "import from URL" may download from.
  importHosts: (env.KKMDM_IMPORT_HOSTS || "github.com").split(",").map((s) => s.trim()).filter(Boolean),
  adminSessionMinutes: 60,
  reauthWindowMinutes: 5,
  enrollTokenDefaultTtlHours: 24,
  heartbeatSeconds: 60,
  offlineAfterSeconds: 180,
};

module.exports = config;
