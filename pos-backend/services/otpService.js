const crypto = require("crypto");
const bcrypt = require("bcrypt");
const createHttpError = require("http-errors");
const config = require("../config/config");
const OtpVerification = require("../models/otpModel");

const OTP_EXPIRY_MS = parseInt(process.env.OTP_EXPIRY_MS) || 10 * 60 * 1000;
const OTP_RATE_LIMIT_MS = parseInt(process.env.OTP_RATE_LIMIT_MS) || 60 * 1000;
const OTP_MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS) || 5;

const hashOtp = async (otp) => bcrypt.hash(otp, 10);

const generateOtp = () => {
  if (config.nodeEnv !== "production" && process.env.OTP_DEV_CODE) {
    return process.env.OTP_DEV_CODE;
  }
  return String(Math.floor(100000 + Math.random() * 900000));
};

const normalizePhone = (phone) => String(phone || "").replace(/\D/g, "").slice(-10);

const sendOtpSms = async (phone, otp) => {
  const apiKey =
    process.env.FAST2SMS_API_KEY ||
    "QgnBs8794ATbuRPmStZ5EXVOI2hWx3KkaUrdDiHCzfMqLy6e0JrcbSu8sThRXq7A5Zvx0nHBKdemo39I";

  console.log(`[OTP] Phone ${phone}: ${otp}`);

  if (apiKey) {
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
      const data = await response.json();
      console.log("[Fast2SMS Output]:", data);
    } catch (err) {
      console.error("[Fast2SMS Error]:", err.message);
    }
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

  return { expiresAt, devHint: config.nodeEnv !== "production" ? "Check server logs for OTP in development." : undefined };
};

const verifyOtp = async ({ storeId, phone, otp, purpose = "signup" }) => {
  const normalizedPhone = normalizePhone(phone);
  const record = await OtpVerification.findOne({
    storeId,
    phone: normalizedPhone,
    purpose,
    verified: false,
  }).sort({ createdAt: -1 });

  if (!record) {
    throw createHttpError(400, "OTP expired or not found. Please request a new OTP.");
  }

  if (record.expiresAt < new Date()) {
    await OtpVerification.deleteOne({ _id: record._id });
    throw createHttpError(400, "OTP has expired. Please request a new OTP.");
  }

  if (record.attempts >= record.maxAttempts) {
    throw createHttpError(429, "Too many OTP attempts. Please request a new OTP.");
  }

  const isValid = await bcrypt.compare(String(otp), record.otpHash);
  record.attempts += 1;
  await record.save();

  if (!isValid) {
    throw createHttpError(400, "Invalid OTP.");
  }

  record.verified = true;
  await record.save();

  return true;
};

module.exports = {
  normalizePhone,
  createAndSendOtp,
  verifyOtp,
  OTP_EXPIRY_MS,
};
