const createHttpError = require("http-errors");

/**
 * Dependency-free in-memory rate limiter (§24).
 *
 * The project has no express-rate-limit dependency and no Redis, so this keeps
 * the public storefront endpoints protected without adding infrastructure.
 * Buckets are pruned lazily to bound memory.
 *
 * NOTE for horizontal scaling: this limits per-process. Swap the Map for Redis
 * (or put the limit at the edge/load balancer) when running multiple instances.
 */

const buckets = new Map();
let lastSweep = Date.now();

const sweep = (now) => {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
};

const clientIp = (req) =>
  (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
  req.ip ||
  req.socket?.remoteAddress ||
  "unknown";

/**
 * @param {object} options
 *   windowMs {number}
 *   max      {number}
 *   keyGenerator {function(req):string}
 *   message  {string}
 */
const rateLimit = ({ windowMs = 60_000, max = 60, keyGenerator, message } = {}) => (req, res, next) => {
  const now = Date.now();
  sweep(now);

  const key = keyGenerator ? keyGenerator(req) : clientIp(req);
  let entry = buckets.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    buckets.set(key, entry);
  }

  entry.count += 1;

  const remaining = Math.max(0, max - entry.count);
  res.setHeader("X-RateLimit-Limit", max);
  res.setHeader("X-RateLimit-Remaining", remaining);
  res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

  if (entry.count > max) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader("Retry-After", retryAfter);
    return next(
      createHttpError(429, message || "Too many requests. Please slow down and try again shortly.")
    );
  }

  return next();
};

/** Reset all buckets — used by tests. */
const resetRateLimits = () => buckets.clear();

module.exports = { rateLimit, resetRateLimits, clientIp };
