const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const connectDB = require("./config/database");
const config = require("./config/config");
const { seedSuperAdmin } = require("./controllers/authController");
const apiRoutes = require("./routes/api");
const globalErrorHandler = require("./middlewares/globalErrorHandler");

const app = express();

// Trust the platform load balancer so req.ip / Secure cookies use the
// real client address (Vercel, Cloudflare, nginx, etc.).
app.set("trust proxy", 1);

/**
 * CORS allow-list (§10).
 *
 * The previous configuration:
 *   - reflected ANY origin whenever NODE_ENV !== "production" (dev bypass)
 *   - allowed ANY *.vercel.app subdomain in production
 * Combined with `credentials: true` this let an attacker's rogue Vercel
 * preview call authenticated admin APIs using the victim admin's session.
 *
 * Now: strict allow-list, driven entirely by ADMIN_FRONTEND_ORIGIN.
 * Multiple origins may be provided as a comma-separated list.
 */
const allowedOrigins = new Set(
  (process.env.ADMIN_FRONTEND_ORIGIN
    ? process.env.ADMIN_FRONTEND_ORIGIN.split(",")
    : ["http://localhost:5174", "http://localhost:5173", "http://127.0.0.1:5174", "http://127.0.0.1:5173"]
  )
    .map((u) => u.trim().replace(/\/$/, ""))
    .filter(Boolean)
);

app.use(
  cors({
    origin: (origin, callback) => {
      // Server-to-server / curl / native app requests carry no Origin header.
      if (!origin) return callback(null, true);
      const clean = origin.replace(/\/$/, "");
      if (allowedOrigins.has(clean)) return callback(null, true);
      // Refuse credentials to any other origin — the browser will block the
      // response. We don't throw; that would render as a 500 in some clients.
      return callback(null, false);
    },
    credentials: true,
  })
);

/**
 * Security headers (§22).
 * Admin portal is a private tool, so we can be strict:
 *   - Deny framing entirely (clickjacking).
 *   - Prevent MIME sniffing on API responses.
 *   - Turn off Referer leakage.
 *   - Add HSTS in production.
 */
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (config.isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

// Tighter body size limit for the admin API — it doesn't carry image uploads.
app.use(express.json({ limit: "512kb" }));
app.use(express.urlencoded({ extended: true, limit: "512kb" }));
app.use(cookieParser());

// Health check
app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "ok",
    service: "knotkitchen-admin-backend",
  });
});

// API routes (supported with or without /api prefix)
app.use("/api", apiRoutes);
app.use("/", apiRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found!",
  });
});

// Global error handler
app.use(globalErrorHandler);

// Connect to MongoDB and seed admin.
// This is cached between warm invocations.
let initialized = false;

const initialize = async () => {
  if (initialized) return;

  await connectDB();
  await seedSuperAdmin();

  initialized = true;
};

// Vercel entry point
module.exports = async (req, res) => {
  await initialize();
  return app(req, res);
};

if (require.main === module) {
  const PORT = config.port || process.env.PORT || 4000;
  initialize().then(() => {
    const server = app.listen(PORT, () => {
      console.log(`☑️ Admin Backend listening on port ${PORT}`);
    });

    /**
     * Graceful shutdown for the admin backend (§14).
     *
     * Mirrors pos-backend/app.js. When docker sends SIGTERM we stop accepting
     * new HTTP connections, close Mongoose, and exit — no in-flight admin
     * request is dropped mid-write. A 25 s watchdog fits inside Docker's
     * default 30 s stop timeout.
     */
    const mongoose = require("mongoose");
    let shuttingDown = false;
    const shutdown = (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`[admin-backend] ${signal} received, closing gracefully...`);
      const forceExit = setTimeout(() => {
        console.error("[admin-backend] shutdown timeout, forcing exit.");
        process.exit(1);
      }, 25_000);
      forceExit.unref();
      server.close(async () => {
        try {
          await mongoose.connection.close(false);
        } catch (err) {
          console.warn("[admin-backend] mongo close error:", err.message);
        }
        console.log("[admin-backend] shutdown complete.");
        process.exit(0);
      });
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("unhandledRejection", (reason) => {
      console.error("[admin-backend unhandledRejection]", reason);
    });
    process.on("uncaughtException", (err) => {
      console.error("[admin-backend uncaughtException]", err);
      shutdown("uncaughtException");
    });
  });
}
