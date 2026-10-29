class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Per-process fixed-window limiter (same approach as pos-backend). Behind
 * several instances this moves to Redis.
 */
function rateLimit({ windowMs, max, key = (req) => req.ip, name = "rate" }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const k = `${name}:${key(req)}`;
    const now = Date.now();
    let h = hits.get(k);
    if (!h || h.reset < now) {
      h = { n: 0, reset: now + windowMs };
      hits.set(k, h);
    }
    h.n++;
    if (h.n > max) {
      res.set("Retry-After", String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: "rate_limited" });
    }
    next();
  };
}

/** ?page=&limit= -> { skip, limit, page } with a hard cap. */
function paging(req, defLimit = 50, maxLimit = 500) {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || defLimit, 1), maxLimit);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  return { limit, page, skip: (page - 1) * limit };
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { HttpError, wrap, rateLimit, paging, escapeRegex };
