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
  // Production SMS integration placeholder — wire Twilio/MSG91 via env when available.
  if (config.nodeEnv !== "production" || process.env.OTP_LOG_ONLY === "true") {
    console.log(`[OTP] Phone ${phone}: ${otp}`);
    return;
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.warn("[OTP] SMS credentials missing — OTP logged to server console only.");
    console.log(`[OTP] Phone ${phone}: ${otp}`);
    return;
  }

  const twilio = require("twilio")(accountSid, authToken);
  await twilio.messages.create({
    body: `Your KnotKitchen verification code is ${otp}. Valid for 10 minutes.`,
    from: fromNumber,
    to: phone.startsWith("+") ? phone : `+91${phone}`,
  });
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
