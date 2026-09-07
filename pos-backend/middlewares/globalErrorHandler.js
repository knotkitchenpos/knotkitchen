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
/**
 * Convert Mongoose / MongoDB "programmer error looks like a 500" errors into
 * proper 4xx responses with actionable messages. Without this, a schema
 * required-field mismatch (like TableSession.outletId in Sep 2026), a bad
 * ObjectId cast, or a duplicate-key insertion all bubble up as a generic
 * "Internal server error." — and the operator has no way to tell WHAT went
 * wrong, only THAT it did. Now the same mistakes surface with the exact
 * failing field and a self-diagnosing message.
 */
const normalizeError = (err) => {
  if (!err || typeof err !== "object") return err;

  // Mongoose ValidationError — one or more required/enum/validate failures.
  if (err.name === "ValidationError" && err.errors) {
    const fieldErrors = {};
    for (const [path, e] of Object.entries(err.errors)) {
      fieldErrors[path] = e?.message || String(e);
    }
    const paths = Object.keys(fieldErrors);
    const message = paths.length
      ? `Validation failed on ${paths.join(", ")}.`
      : "Validation failed.";
    return Object.assign(new Error(message), { statusCode: 400, fieldErrors });
  }

  // Bad ObjectId / bad enum value / bad number coercion.
  if (err.name === "CastError") {
    return Object.assign(
      new Error(`Invalid value for ${err.path || "field"}.`),
      { statusCode: 400 }
    );
  }

  // Duplicate key — a unique index would reject the insert.
  if (err.code === 11000 && err.keyValue) {
    const key = Object.keys(err.keyValue)[0] || "field";
    return Object.assign(
      new Error(`A record with that ${key} already exists.`),
      { statusCode: 409, fieldErrors: { [key]: "Already registered." } }
    );
  }

  return err;
};

const globalErrorHandler = (rawErr, req, res, next) => { // eslint-disable-line no-unused-vars
  const err = normalizeError(rawErr);
  const statusCode = err.statusCode || err.status || 500;
  const isServerError = statusCode >= 500;

  // Short correlation id so users can quote it when reporting an issue and
  // operators can find the full trace in logs.
  const reqId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

  if (isServerError) {
    // eslint-disable-next-line no-console
    console.error(`[error ${reqId}]`, err?.stack || err?.message || err);
  }

  /**
   * `expose` is http-errors' own opt-in, and it is the difference between an
   * internal fault and an operator-facing one that happens to be 5xx.
   *
   * "KnotKitchen's payment gateway is not configured" is a 503 -- the service
   * genuinely is unavailable -- but masking it told an operator clicking Add
   * Balance only "Internal server error", which reads as a crash and gives
   * them nothing to act on. Masking stays the default; this is opt-in per
   * error, and only for messages written to be read.
   */
  const exposed = err.expose === true;

  const safeMessage = isServerError && config.isProduction && !exposed
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

  // A stable machine-readable tag for clients that must branch on WHICH 4xx
  // this is, e.g. two different 409s on sign-in that need different screens.
  // Message text is for humans and may be reworded; this is the contract.
  // 4xx only, for the same reason as fieldErrors.
  if ((!isServerError || exposed) && typeof err?.code === "string") {
    payload.code = err.code;
  }

  if (!config.isProduction && err?.stack) {
    payload.errorStack = err.stack;
  }

  return res.status(statusCode).json(payload);
};

module.exports = globalErrorHandler;
