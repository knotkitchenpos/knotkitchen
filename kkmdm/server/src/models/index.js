/**
 * KKMDM data model. One file so the whole schema reads in one place;
 * docs/ARCHITECTURE.md §4 describes each collection.
 */
const mongoose = require("mongoose");
const { Schema } = mongoose;
const Id = Schema.Types.ObjectId;
const opts = { timestamps: true };

// ---------------- Organisation ----------------

const Company = mongoose.model("Company", new Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  // Reserved for a future reseller/franchise layer above companies.
  parentCompanyId: { type: Id, ref: "Company" },
}, opts));

const Store = mongoose.model("Store", new Schema({
  companyId: { type: Id, ref: "Company", required: true, index: true },
  name: { type: String, required: true },
  // Mapping to KnotKitchen's own restaurant records (store sync).
  kkStoreId: { type: String, index: true, sparse: true, unique: true },
  kkRestaurantId: { type: String },
  kkStatus: { type: String },
  timezone: { type: String, default: "Asia/Kolkata" },
  // Local time, HH:MM. App updates, reboots and OS updates wait for this.
  maintenanceWindow: {
    start: { type: String, default: "03:00" },
    end: { type: String, default: "06:00" },
  },
  businessHours: {
    open: { type: String, default: "09:00" },
    close: { type: String, default: "23:59" },
  },
  // Version pinning: packageName -> AppVersion id.
  appPins: [{ packageName: String, versionId: { type: Id, ref: "AppVersion" } }],
  syncedAt: Date,
  archived: { type: Boolean, default: false },
}, opts));

const Group = mongoose.model("Group", new Schema({
  companyId: { type: Id, ref: "Company", required: true },
  storeId: { type: Id, ref: "Store", index: true },
  name: { type: String, required: true },
  description: String,
}, opts));

// ---------------- Policies ----------------

const Policy = mongoose.model("Policy", new Schema({
  companyId: { type: Id, ref: "Company", required: true },
  name: { type: String, required: true },
  description: String,
  // Bumped on every edit; devices report the version they applied.
  version: { type: Number, default: 1 },
  // Partial settings: only the keys set here override the parent level.
  settings: { type: Schema.Types.Mixed, default: {} },
}, opts));

const PolicyAssignment = mongoose.model("PolicyAssignment", new Schema({
  policyId: { type: Id, ref: "Policy", required: true },
  scope: { type: String, enum: ["company", "store", "group", "device"], required: true },
  targetId: { type: Id, required: true },
}, opts).index({ scope: 1, targetId: 1 }, { unique: true }));

// ---------------- Devices ----------------

const deviceSchema = new Schema({
  companyId: { type: Id, ref: "Company", required: true, index: true },
  storeId: { type: Id, ref: "Store", index: true },
  groupId: { type: Id, ref: "Group", index: true },
  name: { type: String, required: true },
  lifecycle: {
    type: String,
    enum: ["in_stock", "enrolled", "active", "in_repair", "retired"],
    default: "enrolled",
    index: true,
  },
  // Hardware facts reported by the agent.
  serial: { type: String, index: true },
  imei: String,
  hardwareId: { type: String, index: true },
  manufacturer: String,
  model: String,
  androidVersion: String,
  sdkInt: Number,
  securityPatch: String,
  attestation: { verified: Boolean, detail: String },
  gms: Boolean,
  agentVersion: String,
  agentVersionCode: Number,
  posVersion: String,
  posVersionCode: Number,
  // Liveness. "online" is set by the WebSocket hub and the offline sweeper.
  online: { type: Boolean, default: false, index: true },
  lastSeenAt: { type: Date, index: true },
  enrolledAt: Date,
  readyAt: Date,
  // Latest heartbeat snapshot; history lives in the telemetry collection.
  telemetry: {
    battery: Number,
    charging: Boolean,
    plugged: String,
    storageFreeMb: Number,
    storageTotalMb: Number,
    ramFreeMb: Number,
    ramTotalMb: Number,
    networkType: String,
    ssid: String,
    signal: Number,
    ip: String,
    internetReachable: Boolean,
    uptimeSec: Number,
    lastBootReason: String,
    volume: Number,
    brightness: Number,
    at: Date,
  },
  kiosk: {
    state: { type: String, enum: ["unknown", "locked", "unlocked", "technician", "lost", "error"], default: "unknown" },
    error: String,
    crashCount: Number,
    technicianUntil: Date,
  },
  policy: {
    policyId: { type: Id, ref: "Policy" },
    expectedHash: String,
    appliedHash: String,
    appliedAt: Date,
    compliant: { type: Boolean, default: false },
    errors: [String],
  },
  apps: [{ packageName: String, versionCode: Number, versionName: String, _id: false }],
  inventory: {
    assetTag: String,
    purchaseDate: Date,
    warrantyUntil: Date,
    notes: String,
  },
  pilot: { type: Boolean, default: false, index: true },
  lostMode: { enabled: Boolean, message: String, phone: String, since: Date },
  location: { lat: Number, lng: Number, accuracy: Number, at: Date },
  // Technician escape seed, AES-GCM encrypted (lib/crypto.encrypt).
  techSecretEnc: String,
  // Set by an admin; the next sync hands the device a fresh credential.
  rotateCredential: { type: Boolean, default: false },
  fcmToken: String,
  retiredAt: Date,
}, opts);
deviceSchema.index({ companyId: 1, lifecycle: 1, online: 1 });
deviceSchema.index({ name: "text", serial: "text", model: "text" });
const Device = mongoose.model("Device", deviceSchema);

const DeviceCredential = mongoose.model("DeviceCredential", new Schema({
  deviceId: { type: Id, ref: "Device", required: true, index: true },
  secretHash: { type: String, required: true, unique: true },
  lastUsedAt: Date,
  revokedAt: Date,
  revokedReason: String,
}, opts));

const DeviceEvent = mongoose.model("DeviceEvent", new Schema({
  deviceId: { type: Id, ref: "Device", required: true },
  at: { type: Date, default: Date.now },
  type: { type: String, required: true },
  message: String,
  data: Schema.Types.Mixed,
}).index({ deviceId: 1, at: -1 }));

const DeviceLog = mongoose.model("DeviceLog", new Schema({
  deviceId: { type: Id, ref: "Device", required: true, index: true },
  commandId: String,
  kind: { type: String, enum: ["agent", "logcat", "bugreport", "crash"], required: true },
  file: String,
  size: Number,
  summary: String,
}, opts));

// ---------------- Enrollment ----------------

const EnrollmentToken = mongoose.model("EnrollmentToken", new Schema({
  tokenHash: { type: String, required: true, unique: true },
  // First chars of the raw token so admins can tell tokens apart.
  hint: String,
  companyId: { type: Id, ref: "Company", required: true },
  storeId: { type: Id, ref: "Store", required: true },
  groupId: { type: Id, ref: "Group" },
  policyId: { type: Id, ref: "Policy" },
  deviceName: String,
  mode: { type: String, enum: ["single", "batch"], default: "single" },
  maxUses: { type: Number, default: 1 },
  uses: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true, index: true },
  revokedAt: Date,
  createdBy: { type: Id, ref: "AdminUser" },
  wifiSsid: String,
  note: String,
}, opts));

const EnrollmentAttempt = mongoose.model("EnrollmentAttempt", new Schema({
  tokenId: { type: Id, ref: "EnrollmentToken", index: true },
  at: { type: Date, default: Date.now },
  success: Boolean,
  reason: String,
  ip: String,
  deviceFacts: Schema.Types.Mixed,
  deviceId: { type: Id, ref: "Device" },
}));

// ---------------- Applications ----------------

const App = mongoose.model("App", new Schema({
  packageName: { type: String, required: true, unique: true },
  name: String,
  role: { type: String, enum: ["agent", "pos", "companion", "other"], default: "other" },
  // The signing cert seen first. A later upload with a different cert is
  // refused: Android would refuse the update anyway.
  signingCertSha256: String,
  // The fleet's stable version: what devices outside a rollout get.
  currentVersionId: { type: Id, ref: "AppVersion" },
}, opts));

const AppVersion = mongoose.model("AppVersion", new Schema({
  appId: { type: Id, ref: "App", required: true, index: true },
  packageName: { type: String, required: true },
  versionCode: { type: Number, required: true },
  versionName: String,
  label: String,
  minSdk: Number,
  targetSdk: Number,
  sha256: { type: String, required: true },
  size: Number,
  signingCertSha256: String,
  signatureScheme: String,
  file: { type: String, required: true },
  uploadedBy: { type: Id, ref: "AdminUser" },
}, opts).index({ packageName: 1, versionCode: 1 }, { unique: true }));

const Rollout = mongoose.model("Rollout", new Schema({
  appId: { type: Id, ref: "App", required: true },
  packageName: String,
  versionId: { type: Id, ref: "AppVersion", required: true },
  previousVersionId: { type: Id, ref: "AppVersion" },
  // pilot -> percent -> all
  stage: { type: String, enum: ["pilot", "percent", "all"], default: "pilot" },
  percent: { type: Number, default: 0 },
  status: { type: String, enum: ["running", "paused", "completed", "rolled_back"], default: "running", index: true },
  storeIds: [{ type: Id, ref: "Store" }],
  // Install now, or wait for each store's maintenance window.
  respectMaintenanceWindow: { type: Boolean, default: true },
  createdBy: { type: Id, ref: "AdminUser" },
  history: [{ at: Date, action: String, by: String, _id: false }],
}, opts));

// ---------------- Commands ----------------

const COMMAND_STATUSES = ["queued", "sent", "delivered", "executing", "succeeded", "failed", "expired", "cancelled"];

const commandSchema = new Schema({
  // Idempotency key the device dedupes on.
  cmdId: { type: String, required: true, unique: true },
  deviceId: { type: Id, ref: "Device", required: true },
  type: { type: String, required: true },
  params: { type: Schema.Types.Mixed, default: {} },
  status: { type: String, enum: COMMAND_STATUSES, default: "queued" },
  expiresAt: { type: Date, required: true },
  // Held until the store's maintenance window unless forced.
  holdForMaintenance: { type: Boolean, default: false },
  bulkId: { type: Id, ref: "BulkJob", index: true },
  rolloutId: { type: Id, ref: "Rollout", index: true },
  createdBy: { type: Id, ref: "AdminUser" },
  createdByEmail: String,
  result: Schema.Types.Mixed,
  error: String,
  history: [{ status: String, at: Date, _id: false }],
}, opts);
commandSchema.index({ deviceId: 1, status: 1, createdAt: 1 });
commandSchema.index({ status: 1, expiresAt: 1 });
const Command = mongoose.model("Command", commandSchema);

const BulkJob = mongoose.model("BulkJob", new Schema({
  type: String,
  params: Schema.Types.Mixed,
  target: Schema.Types.Mixed,
  total: Number,
  createdBy: { type: Id, ref: "AdminUser" },
  createdByEmail: String,
}, opts));

// ---------------- Telemetry (time series, 90-day retention) ----------------

const Telemetry = mongoose.model("Telemetry", new Schema({
  ts: { type: Date, required: true },
  deviceId: { type: Id, required: true },
  battery: Number,
  charging: Boolean,
  storageFreeMb: Number,
  ramFreeMb: Number,
  networkType: String,
  signal: Number,
  internetReachable: Boolean,
  kiosk: String,
}, {
  timeseries: { timeField: "ts", metaField: "deviceId", granularity: "minutes" },
  expireAfterSeconds: 90 * 24 * 3600,
}));

// Daily roll-up kept after raw telemetry expires.
const TelemetryDaily = mongoose.model("TelemetryDaily", new Schema({
  deviceId: { type: Id, required: true },
  day: { type: String, required: true },
  samples: Number,
  batteryMin: Number,
  batteryAvg: Number,
  offlineSamples: Number,
}).index({ deviceId: 1, day: 1 }, { unique: true }));

// ---------------- Alerts ----------------

const ALERT_TYPES = ["offline", "kiosk_exited", "crash_loop", "low_storage", "low_battery", "not_charging", "policy_noncompliant", "enrollment_failed"];

const AlertRule = mongoose.model("AlertRule", new Schema({
  companyId: { type: Id, ref: "Company", required: true },
  // Empty = every store of the company.
  storeId: { type: Id, ref: "Store" },
  type: { type: String, enum: ALERT_TYPES, required: true },
  enabled: { type: Boolean, default: true },
  // offline: minutes; low_storage: MB; low_battery: %; not_charging: minutes.
  threshold: Number,
  businessHoursOnly: { type: Boolean, default: false },
  channels: {
    email: [String],
    webhook: String,
  },
}, opts));

const Alert = mongoose.model("Alert", new Schema({
  ruleId: { type: Id, ref: "AlertRule" },
  deviceId: { type: Id, ref: "Device", index: true },
  storeId: { type: Id, ref: "Store" },
  type: { type: String, enum: ALERT_TYPES },
  severity: { type: String, enum: ["info", "warning", "critical"], default: "warning" },
  message: String,
  status: { type: String, enum: ["open", "acknowledged", "resolved"], default: "open", index: true },
  openedAt: { type: Date, default: Date.now },
  acknowledgedBy: String,
  resolvedAt: Date,
  notified: [String],
}, opts));

// ---------------- Admins and audit ----------------

const AdminUser = mongoose.model("AdminUser", new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: String,
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["super_admin", "admin", "support", "store_user"], required: true },
  companyId: { type: Id, ref: "Company" },
  // Store users only see these stores.
  storeIds: [{ type: Id, ref: "Store" }],
  totpSecretEnc: String,
  totpEnabled: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  failedLogins: { type: Number, default: 0 },
  lockedUntil: Date,
  lastLoginAt: Date,
  lastLoginIp: String,
  // Bumped to invalidate every session of the user.
  sessionVersion: { type: Number, default: 1 },
  ssoSubject: String,
}, opts));

const Role = mongoose.model("Role", new Schema({
  key: { type: String, required: true, unique: true },
  name: String,
  permissions: [String],
}));

// Hash-chained: every row carries the hash of the previous one, so an edited
// or deleted row breaks the chain (GET /admin/audit/verify).
const AuditLog = mongoose.model("AuditLog", new Schema({
  seq: { type: Number, required: true, unique: true },
  at: { type: Date, default: Date.now, index: true },
  actorId: { type: Id, ref: "AdminUser" },
  actorEmail: String,
  actorRole: String,
  action: { type: String, required: true, index: true },
  targetType: String,
  targetId: String,
  details: Schema.Types.Mixed,
  ip: String,
  prevHash: String,
  hash: String,
  // Keep empty objects in details: the stored row must be exactly what was hashed.
}, { minimize: false }));

const Counter = mongoose.model("Counter", new Schema({ _id: String, seq: Number }));

module.exports = {
  Company, Store, Group, Policy, PolicyAssignment,
  Device, DeviceCredential, DeviceEvent, DeviceLog,
  EnrollmentToken, EnrollmentAttempt,
  App, AppVersion, Rollout,
  Command, BulkJob, COMMAND_STATUSES,
  Telemetry, TelemetryDaily,
  AlertRule, Alert, ALERT_TYPES,
  AdminUser, Role, AuditLog, Counter,
};
