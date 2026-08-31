const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

/**
 * CSD / Admin panel staff (csd.knotkitchen.online).
 *
 * Deliberately separate from `User` (restaurant staff working a POS terminal):
 * these are KnotKitchen's OWN employees doing customer-support and operations
 * work across every tenant. They authenticate by EMAIL + PASSWORD and are
 * scoped by role rather than by restaurantId.
 *
 * Auth history (2026-08-30): originally phone + OTP, gated by a hardcoded
 * `CSD_ADMIN_PHONES` allow-list. That went via Fast2SMS, which introduced a
 * hard external dependency for logging into your own admin panel — so a
 * provider outage or account-verification block (real, took us out today)
 * locked every operator out. Switched to email + password, seeded from the
 * SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD env vars, so first-run bootstrap
 * needs nothing beyond the .env file that already existed for the onboard
 * super-admin that this replaces.
 *
 * Security model: password is stored bcrypt-hashed with a pre-save hook and
 * has `select: false`, so it never appears in queries or JSON unless a caller
 * explicitly asks for it. toSafeJSON() below is what the API returns.
 */

const loginEventSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { _id: false }
);

const csdStaffSchema = new mongoose.Schema(
  {
    // Human-facing identifier shown in the UI, e.g. "KK-ST-001".
    staffId: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      match: [/^KK-ST-\d{3,}$/, "Staff ID must look like KK-ST-001"],
    },

    fullName: { type: String, required: true, trim: true },

    // Login identity.
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email address"],
    },

    // Bcrypt hash. select:false keeps it out of every read by default; auth
    // paths that need it use `.select("+password")` explicitly.
    password: { type: String, required: true, select: false },

    // Optional legacy phone. Sparse-unique — deliberately no `default`, so a
    // staff record without a phone omits the field entirely and the sparse
    // index skips the doc. A `default: null` would write null explicitly,
    // and MongoDB's sparse indexes still cover explicit nulls: every second
    // no-phone staff would then collide on phone_1 with code 11000.
    phone: {
      type: String,
      sparse: true,
      unique: true,
      validate: {
        validator: (v) => v == null || v === "" || /^\d{10}$/.test(v),
        message: "Phone must be a 10-digit number",
      },
    },

    personalEmail: { type: String, default: "", lowercase: true, trim: true },
    officialEmail: { type: String, default: "", lowercase: true, trim: true },

    // "admin" unlocks Dashboard, Store Onboarding, Staff Management, Settings
    // and Reports. "staff" is the CSD support role.
    role: { type: String, enum: ["admin", "staff"], default: "staff", index: true },

    // The bootstrap super-admin. Its password can be reset via env
    // (RESET_SUPERADMIN_PASSWORD=true) and Staff Management refuses to
    // demote or disable it, so the platform can never be locked out with
    // zero administrators.
    isPredefined: { type: Boolean, default: false },

    // `disabled` blocks login without destroying the audit trail that
    // references this staff member. Rows are never hard-deleted.
    status: { type: String, enum: ["active", "disabled"], default: "active", index: true },

    // Reserved for finer-grained gating inside the staff role (Phase 4).
    // Role remains the primary authorisation check.
    permissions: { type: [String], default: [] },

    dateJoined: { type: Date, default: Date.now },
    lastLoginAt: { type: Date },

    // Capped on write to the most recent 50 entries — this is a convenience
    // view for Staff Management, not the audit log of record (that's AuditLog).
    loginHistory: { type: [loginEventSchema], default: [] },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "CsdStaff" },
  },
  { timestamps: true }
);

csdStaffSchema.index({ fullName: 1 });

/**
 * Hash the password on any write that modified it. Mirrors the pattern the
 * onboard `Admin` model used, so the migration from that system does not
 * change hashing parameters.
 */
csdStaffSchema.pre("save", async function hashPassword(next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

/** Constant-time compare via bcrypt. */
csdStaffSchema.methods.comparePassword = function comparePassword(candidate) {
  if (typeof candidate !== "string" || !this.password) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.password);
};

/** Never leak password or loginHistory to the browser by default. */
csdStaffSchema.methods.toSafeJSON = function () {
  return {
    id: String(this._id),
    staffId: this.staffId,
    fullName: this.fullName,
    email: this.email,
    phone: this.phone || "",
    personalEmail: this.personalEmail,
    officialEmail: this.officialEmail,
    role: this.role,
    isPredefined: this.isPredefined === true,
    status: this.status,
    permissions: this.permissions,
    dateJoined: this.dateJoined,
    lastLoginAt: this.lastLoginAt,
  };
};

/**
 * Allocate the next sequential staff id (KK-ST-001, KK-ST-002, ...).
 * See the width note in the previous revision — padStart(3) is correct to
 * 999 and lexical order still holds beyond that.
 */
csdStaffSchema.statics.nextStaffId = async function () {
  const last = await this.findOne({}, { staffId: 1 }).sort({ staffId: -1 }).lean();
  const n = last ? parseInt(String(last.staffId).replace(/\D/g, ""), 10) + 1 : 1;
  return `KK-ST-${String(n).padStart(3, "0")}`;
};

module.exports = mongoose.model("CsdStaff", csdStaffSchema);
