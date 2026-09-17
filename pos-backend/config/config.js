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


    // Cashfree PG. Platform-wide credentials, used by any store that has
    // not brought its own in Website Settings. CASHFREE_ENV picks the
    // base URL: TEST = sandbox.cashfree.com, PROD = api.cashfree.com.
    cashfreeAppId: process.env.CASHFREE_APP_ID,
    cashfreeSecretKey: process.env.CASHFREE_SECRET_KEY,
    cashfreeEnv: process.env.CASHFREE_ENV || "TEST",
    cashfreeWebhookSecret: process.env.CASHFREE_WEBHOOK_SECRET,
    // Shared secret a Swiggy/Zomato bridge sends in x-marketplace-secret.
    // Unset = the marketplace webhook is closed.
    marketplaceWebhookSecret: process.env.MARKETPLACE_WEBHOOK_SECRET || "",
    // Server-to-server payment notification. Cashfree requires HTTPS and
    // rejects anything else, so it is dropped from the order when unset
    // or plain http -- the verify-on-return path still settles the bill.
    cashfreeNotifyUrl: process.env.CASHFREE_NOTIFY_URL || "",

    // Encrypts gateway credentials at rest (services/secretBox). Absent,
    // they are stored Base64 exactly as before -- a missing key must not
    // take payments offline.
    credentialsSecret: process.env.CREDENTIALS_SECRET || "",

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
    // A customer website is served from <slug>.knotkitchen.com. Enumerating
    // every possible subdomain in FRONTEND_URLS is impossible, so instead we
    // list the base domains here (comma separated, no leading dot) and CORS
    // accepts any Origin that ends with `.<base>` over https.
    //
    // Example: CORS_WILDCARD_DOMAINS=knotkitchen.com,knot.local
    // Accepts: https://burger-house.knotkitchen.com, https://cafe.knotkitchen.com
    // Rejects: https://knotkitchen.com.evil.com, http://x.knotkitchen.com in prod
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

    // Table QR rate limits.
    //
    // Every write endpoint on the QR router is unauthenticated and gated only
    // by a table's QR token — which anyone who has sat at that table, or
    // photographed the card stuck to it, keeps indefinitely. Without these,
    // order placement and the waiter alarm were both unthrottled.
    qrReadRateMax: parseInt(process.env.QR_READ_RATE_MAX) || 240,
    qrReadRateWindowMs: parseInt(process.env.QR_READ_RATE_WINDOW_MS) || 60 * 1000,
    qrOrderRateMax: parseInt(process.env.QR_ORDER_RATE_MAX) || 20,
    qrOrderRateWindowMs: parseInt(process.env.QR_ORDER_RATE_WINDOW_MS) || 10 * 60 * 1000,
    // Deliberately the tightest limit in the app: this one makes a noise the
    // floor staff cannot ignore until somebody walks over and clears it.
    qrWaiterCallRateMax: parseInt(process.env.QR_WAITER_CALL_RATE_MAX) || 5,
    qrWaiterCallRateWindowMs: parseInt(process.env.QR_WAITER_CALL_RATE_WINDOW_MS) || 5 * 60 * 1000,

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

    // ===== CSD panel bootstrap =====
    //
    // Seeds the first CSD super-administrator on server start. Historically
    // these two vars only fed the (removed) knotkitchen-admin backend; now
    // they also seed the CSD panel that replaced it, so operators keep one
    // credential across both. Missing values in production print a warning
    // and skip seeding — sign-in still works if a CsdStaff row already
    // exists, so this doesn't fail closed and take the panel down.
    csdSeedEmail: process.env.SUPERADMIN_EMAIL || process.env.ADMIN_EMAIL || "",
    csdSeedPassword: process.env.SUPERADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "",

});


module.exports = config;
