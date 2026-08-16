const createHttpError = require("http-errors");

/**
 * Minimal in-memory rate limiter for the admin API (§13).
 * Same implementation shape as pos-backend/middlewares/rateLimiter.js — kept
 * here so this project has no cross-package dependency.
 *
 * For horizontal scaling of the admin backend, replace the Map with Redis or
 * push the limit to the load balancer.
 */

const buckets = new Map();
let lastSweep = Date.now();

const clientIp = (req) =>
  (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
  req.ip ||
  req.socket?.remoteAddress ||
  "unknown";

const sweep = (now) => {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
};

const rateLimit = ({ windowMs = 60_000, max = 60, keyGenerator, message } = {}) =>
  (req, res, next) => {
    const now = Date.now();
    sweep(now);
    const key = keyGenerator ? keyGenerator(req) : clientIp(req);
    let entry = buckets.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(key, entry);
    }
    entry.count += 1;
    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, max - entry.count));
    res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader("Retry-After", retryAfter);
      return next(createHttpError(429, message || "Too many requests. Please slow down."));
    }
    next();
  };

module.exports = { rateLimit, clientIp };
