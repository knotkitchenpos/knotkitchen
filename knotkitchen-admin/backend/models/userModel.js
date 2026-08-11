const mongoose = require("mongoose");

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
    name: { type: String, required: true },
    address: { type: String, required: true },
    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      validate: { validator: (v) => !v || /\S+@\S+\.\S+/.test(v), message: "Invalid email!" },
    },
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: "Owner", enum: ["Owner", "Admin", "Manager", "Chef", "Waiter", "Cashier", "Staff"] },
    emailVerified: { type: Boolean, default: false },
    emailVerificationToken: String,
    emailVerificationTokenExpires: Date,
    mfa: { enabled: { type: Boolean, default: false }, secret: String, backupCodes: [String] },
    resetPasswordToken: String,
    resetPasswordTokenExpires: Date,
    sessions: [sessionSchema],
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
    managerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    permissions: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    lastLoginAt: { type: Date },
    loginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date },
  },
  { timestamps: true }
);

userSchema.methods.toSafeJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.sessions;
  if (obj.mfa) { delete obj.mfa.secret; delete obj.mfa.backupCodes; }
  return obj;
};

module.exports = mongoose.models.User || mongoose.model("User", userSchema);