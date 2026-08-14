require("dotenv").config();

const config = Object.freeze({
    port: process.env.PORT || 3000,
    databaseURI: process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/knotkitchen",
    nodeEnv: process.env.NODE_ENV || "development",
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
    frontendUrls: (process.env.FRONTEND_URLS || "http://localhost:5173").split(","),
});

module.exports = config;