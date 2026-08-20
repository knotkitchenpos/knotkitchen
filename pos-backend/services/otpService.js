const crypto = require("crypto");
const bcrypt = require("bcrypt");
const createHttpError = require("http-errors");
const config = require("../config/config");
const OtpVerification = require("../models/otpModel");
const { sendOtp: sendFast2SmsOtp, Fast2SmsError } = require("./fast2smsProvider");

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

/**
 * Send the OTP via Fast2SMS (§production-spec — Fast2SMS is the sole SMS
 * transport; there is no legacy "GetOTP" or console-only path in production).
 *
 * Behaviour matrix:
 *
 *   Env                | Behaviour
 *   -------------------+-----------------------------------------------------
 *   production         | MUST send via Fast2SMS. Throws 502 on any Fast2SMS
 *                      | error so the client sees "OTP could not be sent"
 *                      | instead of silently succeeding.
 *   dev + no API key   | Prints the OTP to stdout (masked phone) so the
 *                      | developer can finish the login flow without an SMS
 *                      | provider. Does NOT contact Fast2SMS.
 *   dev + API key      | Real send via Fast2SMS (so you can test the wire
 *                      | contract with a burner number). Also echoes the OTP
 *                      | to stdout in case the SMS is delayed.
 *
 * The Fast2SMS API key is NEVER logged, and the OTP text is never logged in
 * production.
 */
const sendOtpSms = async (phone, otp) => {
  const apiKey = process.env.FAST2SMS_API_KEY;
  const route = process.env.FAST2SMS_ROUTE || "otp";

  if (config.isProduction) {
    if (!apiKey) {
      // Fail loud — a production instance without a configured provider must
      // NOT silently accept OTP requests.
      throw createHttpError(
        502,
        "SMS provider is not configured. Please contact support."
      );
    }
    try {
      const { requestId } = await sendFast2SmsOtp({ phone, otp, apiKey, route });
      // eslint-disable-next-line no-console
      console.log(`[OTP] Fast2SMS OK phone=${maskPhone(phone)} requestId=${requestId}`);
      return { ok: true, requestId };
    } catch (err) {
      if (err instanceof Fast2SmsError) {
        // eslint-disable-next-line no-console
        console.error(
          `[OTP] Fast2SMS failed phone=${maskPhone(phone)} status=${err.status || "-"} ` +
            `providerCode=${err.providerStatusCode || "-"} msg=${err.message}`
        );
        // Bubble up a client-friendly 502 without leaking Fast2SMS body/keys.
        throw createHttpError(502, "We couldn't send the OTP right now. Please try again.");
      }
      throw err;
    }
  }

  // ----- Development / staging convenience path -----
  // eslint-disable-next-line no-console
  console.log(`[OTP:dev] ${maskPhone(phone)}: ${otp}`);

  if (!apiKey) return { ok: true, dev: true };

  try {
    const { requestId } = await sendFast2SmsOtp({ phone, otp, apiKey, route });
    // eslint-disable-next-line no-console
    console.log(`[OTP:dev] Fast2SMS OK phone=${maskPhone(phone)} requestId=${requestId}`);
    return { ok: true, requestId };
  } catch (err) {
    // In dev we deliberately do NOT throw — the OTP was already printed to
    // stdout, so the developer can still complete the login flow.
    // eslint-disable-next-line no-console
    console.warn(
      `[OTP:dev] Fast2SMS failed (${err.message}) — proceeding with printed OTP.`
    );
    return { ok: true, dev: true, providerError: err.message };
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

  // sendOtpSms may throw a 502 in production if Fast2SMS fails — we let that
  // propagate up so the caller returns the error to the client. The stored
  // OTP row is left in place; a real user can just tap "Resend" a moment later
  // and (thanks to the 60s rate limit) they can only do that once per minute.
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
