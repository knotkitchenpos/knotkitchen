const mongoose = require("mongoose");

/**
 * CSD / Admin panel staff (csd.knotkitchen.online).
 *
 * Deliberately separate from `User` (restaurant staff working a POS terminal)
 * and from knotkitchen-admin's `Admin` (email/password superadmin). These are
 * KnotKitchen's OWN employees doing customer-support and operations work
 * across every tenant, so they authenticate by phone + OTP and are scoped by
 * role rather than by restaurantId.
 *
 * Security model: this collection is an ALLOW-LIST. A phone number that has no
 * active row here cannot even request an OTP — see csdAuthController.sendOtp.
 * The only exception is the predefined admin phones in config.csdAdminPhones,
 * which self-provision a row on first successful login.
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

    // Login identity. Stored as bare 10 digits so lookups are exact — every
    // write path normalises through otpService.normalizePhone first.
    phone: {
      type: String,
      required: true,
      unique: true,
      validate: {
        validator: (v) => /^\d{10}$/.test(v),
        message: "Phone must be a 10-digit number",
      },
    },

    personalEmail: { type: String, default: "", lowercase: true, trim: true },
    officialEmail: { type: String, default: "", lowercase: true, trim: true },

    // "admin" unlocks Dashboard, Store Onboarding, Staff Management, Settings
    // and Reports. "staff" is the CSD support role.
    role: { type: String, enum: ["admin", "staff"], default: "staff", index: true },

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

/** Never leak loginHistory or raw mongo internals to the browser by default. */
csdStaffSchema.methods.toSafeJSON = function () {
  return {
    id: String(this._id),
    staffId: this.staffId,
    fullName: this.fullName,
    phone: this.phone,
    personalEmail: this.personalEmail,
    officialEmail: this.officialEmail,
    role: this.role,
    status: this.status,
    permissions: this.permissions,
    dateJoined: this.dateJoined,
    lastLoginAt: this.lastLoginAt,
  };
};

/**
 * Allocate the next sequential staff id (KK-ST-001, KK-ST-002, ...).
 *
 * Sorts lexically on a zero-padded field, which is only correct while the
 * numeric part stays the same width — padStart(3) keeps that true to 999 and
 * the width grows naturally after that (KK-ST-1000 > KK-ST-999 lexically).
 * The unique index on staffId is the real guard: concurrent creates collide
 * there and the caller retries.
 */
csdStaffSchema.statics.nextStaffId = async function () {
  const last = await this.findOne({}, { staffId: 1 }).sort({ staffId: -1 }).lean();
  const n = last ? parseInt(String(last.staffId).replace(/\D/g, ""), 10) + 1 : 1;
  return `KK-ST-${String(n).padStart(3, "0")}`;
};

module.exports = mongoose.model("CsdStaff", csdStaffSchema);
