require("dotenv").config();

const config = Object.freeze({
    port: process.env.PORT || 3000,
    databaseURI: process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/knotkitchen",
    nodeEnv: process.env.NODE_ENV || "development",
    // Capacitor Android uses https://localhost as its WebView origin. In
    // production, cross-origin cookie auth therefore needs SameSite=None.
    cookieSameSite: process.env.COOKIE_SAMESITE || (process.env.NODE_ENV === "production" ? "none" : "lax"),
    cookieSecure: process.env.COOKIE_SECURE
        ? process.env.COOKIE_SECURE === "true"
        : (process.env.NODE_ENV || "development") === "production",
    accessTokenSecret: process.env.JWT_SECRET || "knotkitchen-secret-key-2024-pos-system",
    refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET || "knotkitchen-refresh-secret-2024-pos-system",
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
    frontendUrls: [
        ...(process.env.FRONTEND_URLS || "http://localhost:5173")
            .split(",")
            .map((url) => url.trim())
            .filter(Boolean),
        "https://localhost",
        "capacitor://localhost",
    ],

    // ===== Storefront / Media =====
    // Public base URL of the customer-facing storefront app. Used to build the
    // shareable website link shown in POS → Settings → Website.
    storefrontBaseUrl: (process.env.STOREFRONT_BASE_URL || "http://localhost:5173").replace(/\/$/, ""),
    // Root domain for future per-store subdomains (abc-restaurant.knotkitchen.com)
    storefrontRootDomain: process.env.STOREFRONT_ROOT_DOMAIN || "",

    // Media storage: local | cloudinary | s3 | r2
    mediaProvider: (process.env.MEDIA_STORAGE_PROVIDER || "local").toLowerCase(),
    uploadsDir: process.env.UPLOADS_DIR || require("path").join(__dirname, "..", "uploads"),
    // Where locally-stored files are publicly reachable from.
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
});


module.exports = config;