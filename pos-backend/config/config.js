require("dotenv").config();

const path = require("path");
const crypto = require("crypto");

const nodeEnv = process.env.NODE_ENV || "development";
const isProd = nodeEnv === "production";

/**
 * Security-critical secret loader (§15).
 *
 * The old code shipped hardcoded JWT/refresh/admin secret fallbacks. Anyone
 * with source-code access could forge tokens for any tenant. This helper:
 *   - REFUSES to start in production if a secret is missing or too short
 *   - In development it warns loudly and generates an EPHEMERAL random secret
 *     (so tokens invalidate every restart — safe by default, and a leaking
 *     the source no longer leaks a working key).
 */
const requireSecret = (name, { minLength = 32 } = {}) => {
  const value = process.env[name];
  if (value && value.length >= minLength) return value;

  if (isProd) {
    // eslint-disable-next-line no-console
    console.error(
      `[FATAL] Environment variable ${name} is missing or shorter than ${minLength} characters. ` +
        "Refusing to start in production to avoid using a predictable secret."
    );
    process.exit(1);
  }

  const ephemeral = crypto.randomBytes(48).toString("hex");
  // eslint-disable-next-line no-console
  console.warn(
    `[SECURITY] ${name} not set (or too short). Using an ephemeral random secret for this process. ` +
      `Set ${name} to at least ${minLength} characters in .env for stable tokens.`
  );
  return ephemeral;
};

const parseCsv = (str) =>
  (str || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const config = Object.freeze({
    port: process.env.PORT || 3000,
    databaseURI: process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/knotkitchen",
    nodeEnv,
    isProduction: isProd,

    // Capacitor Android uses https://localhost as its WebView origin. In
    // production, cross-origin cookie auth therefore needs SameSite=None.
    cookieSameSite: process.env.COOKIE_SAMESITE || (isProd ? "none" : "lax"),
    cookieSecure: process.env.COOKIE_SECURE
        ? process.env.COOKIE_SECURE === "true"
        : isProd,

    // ==== SECRETS ====
    // No hardcoded fallbacks. In production the process refuses to start
    // without a strong secret. In development an ephemeral secret is used
    // (see requireSecret above).
    accessTokenSecret: requireSecret("JWT_SECRET"),
    refreshTokenSecret: requireSecret("REFRESH_TOKEN_SECRET"),
    accessTokenExpiry: process.env.ACCESS_TOKEN_EXPIRY || "15m",
    refreshTokenExpiry: process.env.REFRESH_TOKEN_EXPIRY || "30d",

    razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    razorpaySecretKey: process.env.RAZORPAY_KEY_SECRET,
    razorpyWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,

    // Rate limiting
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 100,

    // Lockout
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5,
    lockoutDurationMs: parseInt(process.env.LOCKOUT_DURATION_MS) || 15 * 60 * 1000,

    // Realtime
    socketEnabled: process.env.SOCKET_ENABLED !== "false",

    // ==== CORS / Frontend allow-list ====
    //
    // The old code used `origin: true` — that reflects ANY origin back with
    // Access-Control-Allow-Origin AND allows credentials, which is a total
    // cross-site takeover primitive. We now build a strict allow-list.
    //
    // Local dev defaults let the Vite dev server and Capacitor WebView origins
    // work out of the box. In production the operator MUST configure
    // FRONTEND_URLS (comma separated).
    frontendUrls: [
        ...parseCsv(process.env.FRONTEND_URLS || (isProd ? "" : "http://localhost:5173,http://127.0.0.1:5173")),
        "https://localhost",
        "capacitor://localhost",
    ],

    // ==== Wildcard base domain for customer websites ====
    //
    // A customer website is served from <slug>.knotkitchen.online. Enumerating
    // every possible subdomain in FRONTEND_URLS is impossible, so instead we
    // list the base domains here (comma separated, no leading dot) and CORS
    // accepts any Origin that ends with `.<base>` over https.
    //
    // Example: CORS_WILDCARD_DOMAINS=knotkitchen.online,knot.local
    // Accepts: https://burger-house.knotkitchen.online, https://cafe.knotkitchen.online
    // Rejects: https://knotkitchen.online.evil.com, http://x.knotkitchen.online in prod
    corsWildcardDomains: parseCsv(process.env.CORS_WILDCARD_DOMAINS || ""),

    // Base domain the platform is served under, used by the storefront
    // provisioner to construct subdomain URLs and by the frontend hostname
    // resolver to know which host segment is the store slug.
    baseDomain: (process.env.BASE_DOMAIN || "").toLowerCase().replace(/^\.+/, ""),


    // ===== Storefront / Media =====
    storefrontBaseUrl: (process.env.STOREFRONT_BASE_URL || "http://localhost:5173").replace(/\/$/, ""),
    storefrontRootDomain: process.env.STOREFRONT_ROOT_DOMAIN || "",
    frontendUrl: (process.env.FRONTEND_URL || process.env.STOREFRONT_BASE_URL || "http://localhost:5173").replace(/\/$/, ""),

    // Media storage: local | cloudinary | s3 | r2
    mediaProvider: (process.env.MEDIA_STORAGE_PROVIDER || "local").toLowerCase(),
    uploadsDir: process.env.UPLOADS_DIR || path.join(__dirname, "..", "uploads"),
    mediaPublicBaseUrl: (
        process.env.MEDIA_PUBLIC_BASE_URL ||
        `${process.env.BACKEND_PUBLIC_URL || "http://localhost:" + (process.env.PORT || 3000)}/uploads`
    ).replace(/\/$/, ""),

    cloudinary: {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
        apiKey: process.env.CLOUDINARY_API_KEY || "",
        apiSecret: process.env.CLOUDINARY_API_SECRET || "",
    },

    s3: {
        bucket: process.env.S3_BUCKET || "",
        region: process.env.S3_REGION || "auto",
        endpoint: process.env.S3_ENDPOINT || "",
        accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
        publicBaseUrl: (process.env.S3_PUBLIC_BASE_URL || "").replace(/\/$/, ""),
    },

    // Public storefront ordering rate limits (§24)
    storefrontOrderRateMax: parseInt(process.env.STOREFRONT_ORDER_RATE_MAX) || 10,
    storefrontOrderRateWindowMs: parseInt(process.env.STOREFRONT_ORDER_RATE_WINDOW_MS) || 10 * 60 * 1000,
    storefrontReadRateMax: parseInt(process.env.STOREFRONT_READ_RATE_MAX) || 300,
    storefrontReadRateWindowMs: parseInt(process.env.STOREFRONT_READ_RATE_WINDOW_MS) || 60 * 1000,

    // Auth-specific rate limits (§13)
    authLoginRateMax: parseInt(process.env.AUTH_LOGIN_RATE_MAX) || 10,
    authLoginRateWindowMs: parseInt(process.env.AUTH_LOGIN_RATE_WINDOW_MS) || 15 * 60 * 1000,
    authOtpSendRateMax: parseInt(process.env.AUTH_OTP_SEND_RATE_MAX) || 5,
    authOtpSendRateWindowMs: parseInt(process.env.AUTH_OTP_SEND_RATE_WINDOW_MS) || 15 * 60 * 1000,
    authOtpVerifyRateMax: parseInt(process.env.AUTH_OTP_VERIFY_RATE_MAX) || 10,
    authOtpVerifyRateWindowMs: parseInt(process.env.AUTH_OTP_VERIFY_RATE_WINDOW_MS) || 15 * 60 * 1000,

    // Dev-only OTP bypass (§2 §4). NEVER active in production.
    // In development mode (!isProd), demo OTP is allowed by default (OTP_DEV_CODE=123456)
    // unless explicitly disabled with ALLOW_DEV_OTP=false.
    allowDevOtp: !isProd && process.env.ALLOW_DEV_OTP !== "false",
    devOtpCode: process.env.OTP_DEV_CODE || "123456",

    // Dev-only Product ID auto-creation (§30). NEVER active in production.
    allowDemoProductId: !isProd && process.env.ALLOW_DEMO_PRODUCT_ID !== "false",

});


module.exports = config;
