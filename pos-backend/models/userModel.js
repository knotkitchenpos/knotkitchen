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

    phone: {
      type: String,
      required: true,
      unique: true,
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
  delete obj.mfa.secret;
  delete obj.mfa.backupCodes;
  return obj;
};

module.exports = mongoose.model("User", userSchema);