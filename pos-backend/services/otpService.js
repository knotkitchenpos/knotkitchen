const crypto = require("crypto");
const bcrypt = require("bcrypt");
const createHttpError = require("http-errors");
const config = require("../config/config");
const OtpVerification = require("../models/otpModel");

const OTP_EXPIRY_MS = parseInt(process.env.OTP_EXPIRY_MS) || 10 * 60 * 1000;
const OTP_RATE_LIMIT_MS = parseInt(process.env.OTP_RATE_LIMIT_MS) || 60 * 1000;
const OTP_MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS) || 5;

const hashOtp = async (otp) => bcrypt.hash(otp, 10);

/**
 * Generate a 6-digit OTP.
 *
 * Uses crypto.randomInt (uniform) so the code is unpredictable — the previous
 * Math.random() implementation was cryptographically weak (predictable output
 * from a shared PRNG state) which meant an attacker who observed a few OTPs
 * could bias future guesses.
 *
 * A fixed dev code is honoured only when BOTH the app is not in production and
 * ALLOW_DEV_OTP=true; see config.allowDevOtp. Production ALWAYS returns a
 * fresh unpredictable OTP.
 */
const generateOtp = () => {
  if (config.allowDevOtp && config.devOtpCode) {
    return String(config.devOtpCode);
  }
  return String(crypto.randomInt(100000, 1000000));
};

const normalizePhone = (phone) => String(phone || "").replace(/\D/g, "").slice(-10);

/**
 * Mask a phone number for logs / responses so an attacker inspecting responses
 * cannot enumerate registered owners.
 */
const maskPhone = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `${digits.slice(0, 2)}${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-2)}`;
};

const sendOtpSms = async (phone, otp) => {
  // Never dump the full OTP into logs (§22). Operators with access to shared
  // log stores could otherwise authenticate as any user.
  //
  // In development we deliberately show the OTP on stdout so the developer can
  // finish the login flow without an SMS provider being configured.
  if (!config.isProduction) {
    // eslint-disable-next-line no-console
    console.log(`[OTP:dev] ${maskPhone(phone)}: ${otp}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[OTP] Sent to ${maskPhone(phone)}`);
  }

  const apiKey = process.env.FAST2SMS_API_KEY;
  // The old code shipped a hardcoded Fast2SMS API key as a fallback. That is a
  // committed live credential and has been removed — the provider is now only
  // called when the operator explicitly configures one.
  if (!apiKey) return;

  try {
    const response = await fetch("https://www.fast2sms.com/dev/bulkV2", {
      method: "POST",
      headers: {
        authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        route: "otp",
        variables_values: String(otp),
        numbers: String(phone),
      }),
    });
    const data = await response.json().catch(() => ({}));
    // Only log the transport status; never echo variables_values back.
    // eslint-disable-next-line no-console
    console.log(`[Fast2SMS] status_code=${data?.status_code || "unknown"}`);
  } catch (err) {
    console.error("[Fast2SMS Error]:", err.message);
  }
};

const createAndSendOtp = async ({ storeId, phone, purpose = "signup" }) => {
  const normalizedPhone = normalizePhone(phone);
  if (!/^\d{10}$/.test(normalizedPhone)) {
    throw createHttpError(400, "Invalid phone number.");
  }

  const recent = await OtpVerification.findOne({
    storeId,
    phone: normalizedPhone,
    purpose,
    createdAt: { $gte: new Date(Date.now() - OTP_RATE_LIMIT_MS) },
  }).sort({ createdAt: -1 });

  if (recent) {
    throw createHttpError(429, "Please wait before requesting another OTP.");
  }

  await OtpVerification.deleteMany({ storeId, phone: normalizedPhone, purpose, verified: false });

  const otp = generateOtp();
  const otpHash = await hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

  await OtpVerification.create({
    storeId,
    phone: normalizedPhone,
    otpHash,
    expiresAt,
    purpose,
    maxAttempts: OTP_MAX_ATTEMPTS,
  });

  await sendOtpSms(normalizedPhone, otp);

  // Callers must NEVER include `otp` in an API response. It's returned here so
  // internal callers can, for example, seed it during automated tests, but the
  // route handlers explicitly drop it before responding to the client.
  return {
    expiresAt,
    otp,
    maskedPhone: maskPhone(normalizedPhone),
  };
};

/**
 * Verify an OTP.
 *
 * Always resolves to { valid, message } - it never throws for a bad or expired
 * code. The callers in userController check `result.valid`, so returning a bare
 * boolean here silently rejected every correct OTP.
 *
 * @returns {Promise<{valid: boolean, message?: string}>}
 */
const verifyOtp = async ({ storeId, phone, otp, purpose = "signup" }) => {
  const normalizedPhone = normalizePhone(phone);
  const record = await OtpVerification.findOne({
    storeId,
    phone: normalizedPhone,
    purpose,
    verified: false,
  }).sort({ createdAt: -1 });

  if (!record) {
    return { valid: false, message: "OTP expired or not found. Please request a new OTP." };
  }

  if (record.expiresAt < new Date()) {
    await OtpVerification.deleteOne({ _id: record._id });
    return { valid: false, message: "OTP has expired. Please request a new OTP." };
  }

  if (record.attempts >= record.maxAttempts) {
    return { valid: false, message: "Too many OTP attempts. Please request a new OTP." };
  }

  const isValid = await bcrypt.compare(String(otp), record.otpHash);
  record.attempts += 1;
  await record.save();

  if (!isValid) {
    return { valid: false, message: "Invalid OTP." };
  }

  record.verified = true;
  await record.save();

  return { valid: true };
};


module.exports = {
  normalizePhone,
  maskPhone,
  createAndSendOtp,
  verifyOtp,
  OTP_EXPIRY_MS,
};
