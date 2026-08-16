const express = require("express");
const http = require("http");
const path = require("path");
const connectDB = require("./config/database");
const config = require("./config/config");
const globalErrorHandler = require("./middlewares/globalErrorHandler");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const app = express();


const PORT = config.port;
connectDB();

// Trust the first proxy hop so req.ip / secure cookies / rate limiting reflect
// the real client (nginx, Vercel, Cloudflare, etc.) rather than the LB address.
// A LB-terminated deployment MUST set this, otherwise Secure cookies and IP
// rate limits are bypassable by forging X-Forwarded-For to arbitrary values.
app.set("trust proxy", 1);

// ==== Middlewares ====
//
// The previous implementation used `origin: true` with `credentials: true` —
// that reflects any origin back with Access-Control-Allow-Origin AND allows
// cookies, which is a total cross-site takeover primitive: a malicious site
// could call our authenticated API using the victim's browser cookies.
//
// Now: allow-list only. Same-origin (no `Origin` header) is always permitted
// because that covers server-to-server, Capacitor file:// and health checks.
const allowedOrigins = new Set(
    (config.frontendUrls || [])
        .map((u) => (u || "").replace(/\/$/, ""))
        .filter(Boolean)
);

app.use(
    cors({
        credentials: true,
        origin: (origin, callback) => {
            if (!origin) return callback(null, true); // same-origin / native app
            const clean = origin.replace(/\/$/, "");
            if (allowedOrigins.has(clean)) return callback(null, true);
            // Do NOT set a permissive header for unknown origins; browsers will
            // then correctly block the response. We still return null so the
            // route runs (and returns whatever data) without leaking cookies.
            return callback(null, false);
        },
    })
);

/**
 * Basic security headers on every response (§22).
 * A full CSP is intentionally NOT set here — the storefront theme layer, PWA
 * and cross-origin image CDNs make a global CSP fragile. Static /uploads has
 * its own restrictive CSP (see below).
 */
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    if (config.isProduction) {
        // Only meaningful over HTTPS; the reverse proxy is expected to enforce TLS.
        res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
});

// Slightly larger limit than the default 100kb so base64 image uploads and
// multi-item storefront carts fit comfortably.
app.use(express.json({ limit: "8mb" })); // parse incoming request in json format
app.use(cookieParser());

/**
 * Serve media-library files when using the "local" storage provider.
 * Cloud providers (Cloudinary/S3/R2) serve their own URLs, so this is a no-op
 * for them. `X-Content-Type-Options: nosniff` prevents a browser from
 * re-interpreting an uploaded file as HTML/JS (stored-XSS defence).
 */
if (config.mediaProvider === "local") {
    app.use(
        "/uploads",
        (req, res, next) => {
            res.setHeader("X-Content-Type-Options", "nosniff");
            res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self' data:;");
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            next();
        },
        express.static(config.uploadsDir, { index: false, dotfiles: "deny" })
    );
}



// Root Endpoint
app.get("/", (req,res) => {
    res.json({message : "Hello from POS Server!"});
})

// Other Endpoints
app.use("/api/auth", require("./routes/userRoute"));
app.use("/api/user", require("./routes/userRoute"));
app.use("/api/order", require("./routes/orderRoute"));
app.use("/api/table", require("./routes/tableRoute"));
app.use("/api/menu", require("./routes/menuRoute"));
app.use("/api/payment", require("./routes/paymentRoute"));
app.use("/api/marketplace", require("./routes/marketplaceRoute"));
app.use("/api/restaurant", require("./routes/restaurantRoute"));
app.use("/api/team", require("./routes/teamRoute"));
app.use("/api/kds", require("./routes/kdsRoute"));
app.use("/api/inventory", require("./routes/inventoryRoute"));
app.use("/api/loyalty", require("./routes/loyaltyRoute"));
app.use("/api/billing", require("./routes/billingRoute"));
app.use("/api/qr", require("./routes/qrRoute"));
app.use("/api/analytics", require("./routes/analyticsRoute"));
app.use("/api/notification", require("./routes/notificationRoute"));
app.use("/api/offline", require("./routes/offlineRoute"));
app.use("/api/plugin", require("./routes/pluginRoute"));
app.use("/api/public", require("./routes/publicStoreRoute"));

// ===== Multi-tenant storefront (customer website) =====
// Public, unauthenticated customer website API
app.use("/api/storefront", require("./routes/storefrontRoute"));
// Authenticated POS/admin website configuration + media library
app.use("/api/website", require("./routes/websiteRoute"));
app.use("/api/media", require("./routes/mediaRoute"));
// POS view of website orders
app.use("/api/online-orders", require("./routes/onlineOrderRoute"));


// EPOS table session + customer + payment link routes
app.use("/api/table-session", require("./routes/tableSessionRoute"));
app.use("/api/table-qr", require("./routes/tableQRRoute"));
app.use("/api/customer", require("./routes/customerRoute"));
app.use("/api/payment-link", require("./routes/paymentLinkRoute"));
app.use("/api/receipts", require("./routes/receiptRoute"));

// Global Error Handler
app.use(globalErrorHandler);

// HTTP server + optional Socket.IO realtime
const server = http.createServer(app);
if (config.socketEnabled !== false) {
  try {
    const { initSocket } = require("./services/socket");
    initSocket(server, { corsOrigin: config.frontendUrls });
  } catch (err) {
    console.warn("Socket.IO disabled:", err.message);
  }
}

// Server
server.listen(PORT, () => {
    console.log(`☑️  POS Server is listening on port ${PORT}`);
})
