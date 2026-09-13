const express = require("express");
const http = require("http");
const path = require("path");
const mongoose = require("mongoose");
const connectDB = require("./config/database");
const config = require("./config/config");
const globalErrorHandler = require("./middlewares/globalErrorHandler");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const app = express();


const PORT = config.port;
connectDB();

// Seed the CSD super-administrator on first Mongo ready. Deferred to the
// "connected" event so it runs whether connectDB resolves synchronously or
// after a reconnection, and it never blocks the HTTP listener coming up —
// a seed failure is logged and the server still boots. See
// controllers/csdAuthController.js:seedSuperAdmin for the recovery path.
mongoose.connection.once("connected", () => {
    require("./controllers/csdAuthController")
        .seedSuperAdmin()
        .catch((err) => console.error("[boot] CSD seed failed:", err?.message || err));
});

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
//
// Wildcard support (production): CORS_WILDCARD_DOMAINS=knotkitchen.com lets any
// https://<slug>.knotkitchen.com origin call the API. This is the ONLY way to
// support customer websites without listing every store's subdomain explicitly.
// The comparison is a strict host-suffix check (a.knotkitchen.com but never
// knotkitchen.com.evil.tld).
const allowedOrigins = new Set(
    (config.frontendUrls || [])
        .map((u) => (u || "").replace(/\/$/, ""))
        .filter(Boolean)
);

const wildcardBases = (config.corsWildcardDomains || []).map((d) => d.toLowerCase());

const isWildcardMatch = (origin) => {
    if (!wildcardBases.length) return false;
    let url;
    try {
        url = new URL(origin);
    } catch {
        return false;
    }
    // In production only accept HTTPS wildcard origins; localhost dev of the
    // customer-web is served on http and covered by FRONTEND_URLS instead.
    if (config.isProduction && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return wildcardBases.some(
        (base) => host === base || host.endsWith(`.${base}`)
    );
};

app.use(
    cors({
        credentials: true,
        origin: (origin, callback) => {
            if (!origin) return callback(null, true); // same-origin / native app
            const clean = origin.replace(/\/$/, "");
            if (allowedOrigins.has(clean)) return callback(null, true);
            if (isWildcardMatch(clean)) return callback(null, true);
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
// `verify` hands us the EXACT bytes received, before parsing. Gateway webhook
// signatures are computed over the raw request body, so
// verifying against JSON.stringify(req.body) — a re-serialisation — is only
// accidentally correct: it breaks on any non-ASCII character, different number
// formatting, or key ordering the gateway did not use. Stored only for the
// webhook route to consume; every other handler keeps using req.body.
app.use(
    express.json({
        limit: "8mb",
        verify: (req, _res, buf) => {
            if (buf && buf.length) req.rawBody = buf;
        },
    })
); // parse incoming request in json format
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

/**
 * Liveness probe (§14).
 *
 * Always returns 200 as long as the event loop is responsive. Deliberately
 * does NOT touch MongoDB — a temporarily-unavailable DB should not cause
 * container restarts (that would just widen the outage).
 */
app.get("/health", (req, res) => {
    res.status(200).json({
        success: true,
        status: "ok",
        service: "knotkitchen-pos-backend",
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
    });
});

/**
 * Readiness probe (§14).
 *
 * Returns 200 only when the app is ready to serve traffic (Mongo connected).
 * Used by the deploy script to decide when to route traffic to a new
 * container. Never leaks connection strings, hostnames, or version info.
 */
app.get("/ready", (req, res) => {
    const dbState = mongoose.connection?.readyState;
    // 1 = connected, 2 = connecting. Anything else = not ready.
    const dbReady = dbState === 1;
    res.status(dbReady ? 200 : 503).json({
        success: dbReady,
        status: dbReady ? "ready" : "not_ready",
        checks: { database: dbReady ? "ok" : "unavailable" },
    });
});

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
// The restaurant's KnotKitchen Business Balance. Scoped to the caller's own
// restaurant throughout -- no route here takes a restaurantId.
app.use("/api/business-balance", require("./routes/businessBalanceRoute"));
app.use("/api/subscription", require("./routes/subscriptionRoute"));
app.use("/api/qr", require("./routes/qrRoute"));
app.use("/api/analytics", require("./routes/analyticsRoute"));
app.use("/api/notification", require("./routes/notificationRoute"));
app.use("/api/offline", require("./routes/offlineRoute"));
app.use("/api/plugin", require("./routes/pluginRoute"));
app.use("/api/public", require("./routes/publicStoreRoute"));

// ===== KnotKitchen Business — CSD + Admin panel (csd.${BASE_DOMAIN}) =====
// Phone + OTP authenticated, role-gated server-side. Separate JWT secret and
// cookie from the POS session above, so a CSD token can never authenticate a
// POS request or vice versa.
app.use("/api/csd", require("./routes/csdRoute"));

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
app.use("/api/table-bookings", require("./routes/tableBookingRoute"));
app.use("/api/table-qr", require("./routes/tableQRRoute"));
app.use("/api/customer", require("./routes/customerRoute"));
app.use("/api/payment-link", require("./routes/paymentLinkRoute"));
app.use("/api/receipts", require("./routes/receiptRoute"));

// Public, unauthenticated, and deliberately NOT under /api: this is the link a
// customer taps in their e-bill, so it is kept short and human-sized. The
// signed token in the path is the whole authorisation.
app.use("/r", require("./routes/publicReceiptRoute"));

// Global Error Handler
app.use(globalErrorHandler);

// HTTP server + optional Socket.IO realtime
const server = http.createServer(app);
let ioInstance = null;
if (config.socketEnabled !== false) {
  try {
    const { initSocket } = require("./services/socket");
    ioInstance = initSocket(server, {
      corsOrigin: (origin, callback) => {
        // Same allow-list logic as HTTP CORS above, so Socket.IO cannot be
        // handshake-attacked from an unlisted origin.
        if (!origin) return callback(null, true);
        const clean = origin.replace(/\/$/, "");
        if (allowedOrigins.has(clean)) return callback(null, true);
        if (isWildcardMatch(clean)) return callback(null, true);
        return callback(null, false);
      },
    });
  } catch (err) {
    console.warn("Socket.IO disabled:", err.message);
  }
}

/**
 * Module 4 §4 — Automatic Preparing → Ready scheduler.
 *
 * The scheduler is the SERVER-AUTHORITATIVE timer that promotes eligible
 * orders to "Ready" after their configured auto-ready duration. Started
 * here so it lives for the whole server lifetime; skipped in NODE_ENV=test
 * so unit-test runs don't leak interval handles.
 *
 * We pass the socket's emitOrderStatusChanged into the scheduler so any
 * auto-promotion pushes a realtime update to the POS + customer tracking
 * without the scheduler having to import the socket module directly
 * (avoids a circular require chain).
 */
try {
    const { startAutoReadyScheduler } = require("./services/autoReadyService");
    const { emitOrderStatusChanged } = require("./services/socket");
    startAutoReadyScheduler({ onOrderReady: emitOrderStatusChanged });

    // Non-payment locks. Evaluated on the events that change them (a charge
    // that could not be collected, a top-up, a renewal); this sweep is the
    // backstop for an account that crosses its grace period while nobody is
    // touching it. Only candidates are read, never every restaurant.
    const { startLockSweeper } = require("./services/accountLock");
    startLockSweeper();
} catch (err) {
    console.warn("Auto-ready scheduler failed to start:", err.message);
}

/**
 * Returns settled tables to service once their post-payment cooldown elapses.
 * A sweep rather than a per-table timer, so a restart mid-service does not
 * strand tables in "cleaning" forever — the deadline lives on the row.
 */
try {
    const { startTableCooldownSweeper } = require("./services/tableCooldownService");
    startTableCooldownSweeper();
} catch (err) {
    console.warn("Table cooldown sweeper failed to start:", err.message);
}

// Server
server.listen(PORT, () => {
    console.log(`☑️  POS Server is listening on port ${PORT}`);
})


/**
 * Graceful shutdown (§14).
 *
 * Docker / Kubernetes send SIGTERM to ask the container to exit. We:
 *   1. Stop accepting new HTTP connections (`server.close`).
 *   2. Tell Socket.IO to disconnect its clients cleanly.
 *   3. Close the MongoDB connection.
 *   4. Exit cleanly.
 *
 * A 25-second watchdog force-exits if any step hangs — long enough for
 * in-flight requests to finish, short enough to fit inside Docker's default
 * 30s stop timeout so the runtime doesn't SIGKILL us.
 */
let shuttingDown = false;
const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received, closing gracefully...`);

    const forceExit = setTimeout(() => {
        console.error("[shutdown] Timeout exceeded, forcing exit.");
        process.exit(1);
    }, 25_000);
    forceExit.unref();

    server.close(async () => {
        try {
            if (ioInstance) {
                await new Promise((resolve) => ioInstance.close(resolve));
            }
        } catch (err) {
            console.warn("[shutdown] Socket.IO close error:", err.message);
        }

        try {
            await mongoose.connection.close(false);
        } catch (err) {
            console.warn("[shutdown] MongoDB close error:", err.message);
        }

        console.log("[shutdown] Complete.");
        process.exit(0);
    });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Do NOT crash the process on unhandled rejections in production — log and
// continue so a single bad request never takes the whole POS offline.
process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
    console.error("[uncaughtException]", err);
    // uncaughtException leaves the process in an undefined state — safest to
    // trigger a graceful shutdown so the orchestrator restarts a clean copy.
    shutdown("uncaughtException");
});
