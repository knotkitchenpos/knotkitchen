const config = require("../config/config");

/**
 * Central error responder (§21).
 *
 * The previous implementation echoed `err.message` verbatim. In production
 * that leaks Mongoose validation internals, MongoDB duplicate-key details
 * (including the duplicated value) and third-party stack traces to the
 * client.
 *
 * Behaviour:
 *   - 4xx (client errors) → send the message as-is; these are meant for the
 *     caller to read (`"Invalid credentials"`, `"Table not found"`, ...).
 *   - 5xx (server errors) → send a generic "Internal server error" in
 *     production. Full details go to server logs, keyed by a short reqId so
 *     an operator can look them up without shipping them to the browser.
 *   - Stack trace is only ever returned when NODE_ENV === "development".
 */
const globalErrorHandler = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  const statusCode = err.statusCode || err.status || 500;
  const isServerError = statusCode >= 500;

  // Short correlation id so users can quote it when reporting an issue and
  // operators can find the full trace in logs.
  const reqId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

  if (isServerError) {
    // eslint-disable-next-line no-console
    console.error(`[error ${reqId}]`, err?.stack || err?.message || err);
  }

  const safeMessage = isServerError && config.isProduction
    ? "Internal server error."
    : (err.message || "Something went wrong.");

  const payload = {
    status: statusCode,
    message: safeMessage,
    reqId,
  };

  // Per-field validation messages for forms, e.g.
  // createHttpError(400, "...", { fieldErrors: { gstin: "..." } }).
  //
  // Deliberately NOT named `errors`: Mongoose's ValidationError carries an
  // `errors` property full of internals (paths, kinds, casting detail), and
  // forwarding that name would leak them. Only 4xx — a 5xx must stay generic.
  if (!isServerError && err?.fieldErrors && typeof err.fieldErrors === "object") {
    payload.fieldErrors = err.fieldErrors;
  }

  if (!config.isProduction && err?.stack) {
    payload.errorStack = err.stack;
  }

  return res.status(statusCode).json(payload);
};

module.exports = globalErrorHandler;
