const express = require("express");
const cookieParser = require("cookie-parser");
const config = require("./config");
const { requireAdmin } = require("./lib/adminAuth");

function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (config.isProduction) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    // Strict CORS allow-list for the dashboard; devices do not need CORS.
    const origin = req.headers.origin;
    if (origin && config.dashboardOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-KKMDM");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE");
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.use(cookieParser());
  // APK uploads parse their own raw body; everything else is JSON.
  app.use((req, res, next) => (req.path === "/api/apps/upload" || req.path === "/device/logs" ? next() : express.json({ limit: "1mb" })(req, res, next)));

  app.get("/healthz", (req, res) => res.json({ ok: true, service: "kkmdm" }));

  app.use("/", require("./routes/device").router);
  app.use("/api/auth", require("./routes/auth").router);

  const admin = express.Router();
  admin.use(requireAdmin());
  admin.use("/enrollment", require("./routes/enrollment").router);
  admin.use("/devices", require("./routes/devices").router);
  admin.use("/apps", require("./routes/apps").router);
  admin.use("/", require("./routes/org").router);
  admin.use("/", require("./routes/misc").router);
  app.use("/api", admin);

  app.use((req, res) => res.status(404).json({ error: "not_found" }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error("[error]", req.method, req.path, err);
    const body = { error: err.code || (status >= 500 ? "internal_error" : "bad_request") };
    if (err.message && err.message !== body.error && status < 500) body.message = err.message;
    if (err.name === "ValidationError" || err.name === "CastError") return res.status(400).json({ error: "invalid_input", message: err.message });
    if (err.code === 11000) return res.status(409).json({ error: "duplicate", message: JSON.stringify(err.keyValue) });
    res.status(status).json(body);
  });
  return app;
}

module.exports = { createApp };
