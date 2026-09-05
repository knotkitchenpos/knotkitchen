/**
 * Fast2SMS OTP provider
 * ---------------------------------------------------------------------------
 * Single production SMS transport for Knot Kitchen (§4 of the production spec).
 *
 * Contract:
 *   sendOtp({ phone, otp }) -> Promise<{ ok: true, requestId }>
 *     - Resolves on a Fast2SMS 200 with return:true.
 *     - Rejects (with a Fast2SMS-specific error) on any other outcome, so the
 *       route handler can turn that into a 502 to the caller instead of
 *       claiming the OTP was sent.
 *
 * The API key is read from process.env.FAST2SMS_API_KEY every call rather than
 * cached at module-load time — that way key rotation just needs a container
 * restart, not a code redeploy.
 *
 * References:
 *   Fast2SMS Bulk V2 API: https://docs.fast2sms.com/#bulk-sms-api
 *   Errors covered: 401 invalid key, 402 low balance, 411 invalid number,
 *   422 route disabled, 5xx transient.
 */

const DEFAULT_ROUTE = "otp";
const ENDPOINT = "https://www.fast2sms.com/dev/bulkV2";
const TIMEOUT_MS = 10_000;

class Fast2SmsError extends Error {
  constructor(message, { status, statusCode, retryable = false, providerBody } = {}) {
    super(message);
    this.name = "Fast2SmsError";
    this.status = status;                 // HTTP status from Fast2SMS
    this.providerStatusCode = statusCode; // Fast2SMS' own status_code
    this.retryable = retryable;
    this.providerBody = providerBody;     // parsed body for logging, never leaked
  }
}

/**
 * Normalise a phone number for Fast2SMS.
 * Fast2SMS OTP route expects 10-digit Indian numbers WITHOUT the +91 prefix.
 * We strip anything that isn't a digit, then take the trailing 10 digits.
 */
const toIndianTenDigit = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.slice(-10);
};

/**
 * One-off HTTP call with a hard timeout. We deliberately use fetch's
 * AbortController because Fast2SMS occasionally hangs indefinitely on their
 * side, and a hanging OTP endpoint would tie up Node's event loop for every
 * concurrent login attempt.
 */
const postToFast2Sms = async ({ apiKey, body: reqBody }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reqBody),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Fast2SmsError("Fast2SMS request timed out.", { retryable: true });
    }
    throw new Fast2SmsError(`Fast2SMS network error: ${err.message}`, { retryable: true });
  } finally {
    clearTimeout(timer);
  }

  // 5xx is retryable; everything else is a hard failure.
  const body = await response.json().catch(() => ({}));

  if (response.status >= 500) {
    throw new Fast2SmsError(`Fast2SMS ${response.status}`, {
      status: response.status,
      statusCode: body?.status_code,
      retryable: true,
      providerBody: body,
    });
  }

  if (!response.ok || body?.return === false) {
    // Not retryable — the response is deterministic (bad key, bad number, route
    // disabled, low balance). Surface enough info for ops to debug WITHOUT
    // leaking the API key or the OTP.
    throw new Fast2SmsError(body?.message || `Fast2SMS rejected the request (HTTP ${response.status})`, {
      status: response.status,
      statusCode: body?.status_code,
      retryable: false,
      providerBody: body,
    });
  }

  return {
    ok: true,
    requestId: body?.request_id || "",
  };
};

/**
 * One automatic retry on retryable errors (network hiccup / 5xx). Everything
 * that sends through this provider wants the same policy, and three copies of
 * it is how they drift apart.
 */
const withRetry = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Fast2SmsError && err.retryable) {
      // One short retry -- Fast2SMS is generally back within a few hundred ms.
      await new Promise((r) => setTimeout(r, 400));
      return fn();
    }
    throw err;
  }
};

/** The OTP route, which takes the code as its only template variable. */
const callFast2Sms = async ({ apiKey, phone, otp, route, otpId }) => {
  const reqBody = {
    route: route || DEFAULT_ROUTE,
    variables_values: String(otp),
    numbers: String(phone),
  };

  // If a DLT OTP template ID is configured, pass it in the payload for
  // Fast2SMS DLT-route accounts.
  if (otpId || process.env.FAST2SMS_OTP_ID) {
    reqBody.message = otpId || process.env.FAST2SMS_OTP_ID;
  }

  return postToFast2Sms({ apiKey, body: reqBody });
};

/**
 * Public entry point. One automatic retry on retryable errors (network hiccup
 * / 5xx). Non-retryable errors bubble immediately.
 */
const sendOtp = async ({ phone, otp, apiKey, route, otpId }) => {
  if (!apiKey) throw new Fast2SmsError("Fast2SMS API key is not configured.");
  const number = toIndianTenDigit(phone);
  if (number.length !== 10) {
    throw new Fast2SmsError("Fast2SMS requires a 10-digit Indian phone number.");
  }

  try {
    return await callFast2Sms({ apiKey, phone: number, otp, route, otpId });
  } catch (err) {
    if (err instanceof Fast2SmsError && err.retryable) {
      // One short retry — Fast2SMS is generally back within a few hundred ms.
      await new Promise((r) => setTimeout(r, 400));
      return callFast2Sms({ apiKey, phone: number, otp, route, otpId });
    }
    throw err;
  }
};

/**
 * Send an approved DLT template.
 *
 * India requires transactional SMS to go out against a template registered on
 * the DLT platform: you send the TEMPLATE ID as `message` and the values that
 * fill its `{#var#}` placeholders as a pipe-separated `variables_values`, in
 * the order they appear in the template. Free-text transactional SMS (the
 * `v3`/`q` routes) is not DLT-compliant and operators drop it.
 *
 *   route            "dlt"
 *   sender_id        the 3-6 char approved header, e.g. "KNOTKT"
 *   message          the approved Message ID from DLT MANAGER, e.g. "187654"
 *   variables_values "Asha|1042|450"   <- order matters, ours to get right
 *   numbers          10-digit Indian number(s)
 *
 * A `|` inside a value would silently shift every later variable by one, so
 * they are stripped rather than escaped -- there is no escape.
 *
 * https://docs.fast2sms.com/reference/dlt-sms
 */
const sendDlt = async ({ phone, senderId, templateId, variables = [], apiKey }) => {
  if (!apiKey) throw new Fast2SmsError("Fast2SMS API key is not configured.");
  if (!senderId) throw new Fast2SmsError("Fast2SMS sender ID (DLT header) is not configured.");
  if (!templateId) throw new Fast2SmsError("Fast2SMS DLT template ID is not configured.");

  const number = toIndianTenDigit(phone);
  if (number.length !== 10) {
    throw new Fast2SmsError("Fast2SMS requires a 10-digit Indian phone number.");
  }

  const values = (Array.isArray(variables) ? variables : [variables])
    .map((v) => String(v === null || v === undefined ? "" : v).replace(/\|/g, " ").trim())
    .join("|");

  return withRetry(() =>
    postToFast2Sms({
      apiKey,
      body: {
        route: "dlt",
        sender_id: senderId,
        message: String(templateId),
        variables_values: values,
        numbers: number,
      },
    }),
  );
};

/**
 * Free-text send on the non-DLT routes. Kept for development and for accounts
 * that have not finished DLT registration; it is NOT compliant for
 * transactional messages to Indian numbers and operators may drop it.
 */
const sendText = async ({ phone, message, senderId, apiKey, route = "v3" }) => {
  if (!apiKey) throw new Fast2SmsError("Fast2SMS API key is not configured.");
  const number = toIndianTenDigit(phone);
  if (number.length !== 10) {
    throw new Fast2SmsError("Fast2SMS requires a 10-digit Indian phone number.");
  }

  return withRetry(() =>
    postToFast2Sms({
      apiKey,
      body: {
        route,
        sender_id: senderId || "TXTIND",
        message: String(message || ""),
        language: "english",
        numbers: number,
      },
    }),
  );
};

module.exports = { sendOtp, sendDlt, sendText, Fast2SmsError, toIndianTenDigit };
