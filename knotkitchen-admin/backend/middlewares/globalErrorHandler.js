const config = require("../config/config");

/**
 * Admin error responder (§21).
 * Same behaviour as pos-backend's — sanitise 5xx messages, never leak
 * stack traces in production, but keep 4xx client-friendly messages.
 */
const globalErrorHandler = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || err.statusCode || 500;
  const isServerError = status >= 500;
  const reqId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

  if (isServerError) {
    // eslint-disable-next-line no-console
    console.error(`[admin.error ${reqId}]`, err?.stack || err?.message || err);
  }

  const message = isServerError && config.isProduction
    ? "Internal Server Error!"
    : (err.message || "Internal Server Error!");

  const payload = {
    success: false,
    message,
    reqId,
  };
  if (!config.isProduction && err?.stack) payload.stack = err.stack;

  res.status(status).json(payload);
};

module.exports = globalErrorHandler;
