const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const sessionSchema = new mongoose.Schema(
  {
    refreshToken: { type: String, required: true },
    deviceInfo: { type: String, default: "" },
    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    expiresAt: { type: Date, required: true },
    isRevoked: { type: Boolean, default: false },
    lastActiveAt: { type: Date, default: Date.now },
  },
  { _id: true, timestamps: true }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },

    address: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      validate: {
        validator: function (v) {
          return !v || /\S+@\S+\.\S+/.test(v);
        },
        message: "Email must be in valid format!",
      },
    },

    // Phone uniqueness is enforced PER STORE by the compound index below —
    // not globally — because the same person can own or work at more than
    // one KnotKitchen store and each of those tenants keeps its own copy.
    phone: {
      type: String,
      required: true,
      validate: {
        validator: function (v) {
          return /\d{10}/.test(v);
        },
        message: "Phone number must be a 10-digit number!",
      },
    },

    password: {
      type: String,
      required: true,
    },

    role: {
      type: String,
      default: "Owner",
      enum: ["Owner", "Admin", "Manager", "Chef", "Waiter", "Cashier", "Staff"],
    },

    // ===== Email Verification =====
    emailVerified: { type: Boolean, default: false },
    emailVerificationToken: String,
    emailVerificationTokenExpires: Date,

    // ===== MFA - Ready (TOTP secret stored, enabled flag) =====
    mfa: {
      enabled: { type: Boolean, default: false },
      secret: String,
      backupCodes: [String],
    },

    // ===== Password Reset =====
    resetPasswordToken: String,
    resetPasswordTokenExpires: Date,

    // ===== Session Management =====
    sessions: [sessionSchema],

    // ===== RBAC / Organization =====
    storeId: { type: String },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "ProductId" },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
    managerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    permissions: { type: [String], default: [] },

    // ===== Account state =====
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    lastLoginAt: { type: Date },
    loginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date },

    // Set when an admin (CSD) force-resets a store's password to a temp
    // value, or when the seeded first-time password came from a place the
    // owner should not keep using. UI routes the user to a mandatory
    // password-change screen on next login and refuses to proceed until
    // they set their own.
    mustChangePassword: { type: Boolean, default: false },

    // True while the stored password hash is a random value NOBODY holds —
    // i.e. the row was materialised by the system (CSD "Open POS" bootstrap)
    // rather than by a human choosing a password. `password` is
    // `required: true`, so its mere presence proves nothing; this flag is the
    // only honest answer to "has this store's password actually been set?".
    // A placeholder account cannot sign in: /store/login sends it to
    // first-time setup instead of looping on "Invalid credentials".
    // Cleared by /store/setup-password and /change-password.
    passwordPlaceholder: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Hash password before save
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Remove sensitive fields when serializing
userSchema.methods.toSafeJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.sessions;
  delete obj.emailVerificationToken;
  delete obj.resetPasswordToken;
  if (obj.mfa) {
    delete obj.mfa.secret;
    delete obj.mfa.backupCodes;
  }
  return obj;
};

// Per-tenant phone uniqueness. Two different stores may each have a user
// with the same phone (owner or shared staff), but within one storeId the
// phone is the login handle and must appear at most once.
//
// LIVE users only. Deleting a staff member soft-deletes the row, and the
// index used to keep counting it — so the number stayed occupied forever and
// re-adding the same person failed with a duplicate-key error surfaced as
// "A record with that Store ID already exists". Excluding deleted rows
// releases the number while the row stays for the audit trail.
//
// `$eq: false` rather than `$ne: true`: partialFilterExpression does not
// support $ne. That means a row with no `isDeleted` field at all is not
// indexed, so migration 004 backfills the field before this index is built.
userSchema.index(
  { storeId: 1, phone: 1 },
  {
    unique: true,
    partialFilterExpression: {
      storeId: { $type: "string" },
      phone: { $type: "string" },
      isDeleted: { $eq: false },
    },
    name: "storeId_1_phone_1_live_unique",
  }
);

module.exports = mongoose.model("User", userSchema);