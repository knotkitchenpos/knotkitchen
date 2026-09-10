/**
 * Signed public receipt links.
 *
 * The e-bill puts a "View Bill" URL in the customer's hands, so that URL has
 * to open without a login. The previous wording of it was
 *
 *     `${FRONTEND_URL}/receipt/${orderNumber}`
 *
 * which was wrong three times over: no such route existed, the receipt API
 * behind it required a staff token, and it was keyed by ORDER NUMBER -- which
 * is sequential, so had it ever worked, subtracting one would have shown you
 * the previous customer's bill.
 *
 * A token here is the id plus an HMAC of it. That makes the link unguessable
 * without storing anything: no collection, no migration, no expiry sweep, and
 * no chance of the "written but not in the schema" silent drop that this
 * codebase has been bitten by before. Rotating the secret invalidates every
 * link at once, which is the only revocation a receipt needs.
 *
 *     o_<24-hex order id>_<22-char signature>
 *     s_<24-hex session id>_<22-char signature>
 */

const crypto = require("crypto");

const KIND_ORDER = "o";
const KIND_SESSION = "s";
// A KnotKitchen invoice to a restaurant. Same signing, because POS session
// cookies are namespaced by an x-store-id HEADER -- which a plain link or a
// new tab cannot send, so an authenticated URL would only work when exactly
// one store happens to be signed in.
const KIND_INVOICE = "i";

/**
 * Read the key per call so a rotation only needs a container restart.
 *
 * Deliberately no default. A fallback key would be a public one, and every
 * receipt ever issued would be enumerable by anyone who read this file.
 */
const secret = () => {
  const key =
    process.env.RECEIPT_LINK_SECRET ||
    process.env.CREDENTIALS_SECRET ||
    process.env.JWT_SECRET ||
    "";
  if (!key) {
    throw new Error(
      "No signing key for receipt links: set RECEIPT_LINK_SECRET (or CREDENTIALS_SECRET).",
    );
  }
  return key;
};

const signature = (kind, id) =>
  crypto
    .createHmac("sha256", secret())
    .update(`${kind}:${id}`)
    .digest("base64url")
    .slice(0, 22);

/** Build the token for an order or a table session. */
const mintToken = (kind, id) => {
  const clean = String(id || "");
  if (!/^[a-f0-9]{24}$/i.test(clean)) throw new Error("Receipt link needs a document id.");
  return `${kind}_${clean}_${signature(kind, clean)}`;
};

const tokenForOrder = (orderId) => mintToken(KIND_ORDER, orderId);
const tokenForSession = (sessionId) => mintToken(KIND_SESSION, sessionId);
const tokenForInvoice = (invoiceId) => mintToken(KIND_INVOICE, invoiceId);

/**
 * Verify and unpack a token.
 *
 * Returns null for anything that does not verify -- a typo, a truncated
 * link, a guess -- so the caller has one "no" to handle rather than a
 * taxonomy of failures it would only ever render as 404.
 */
const readToken = (token) => {
  // Anchored, NOT split("_"): base64url's alphabet includes the underscore, so
  // roughly half of all signatures contain one and splitting on it produced
  // four parts instead of three. That rejected perfectly valid links, at
  // random, depending on the signing key -- the sort of fault that looks like
  // "the link works on my phone but not yours".
  const match = /^([a-z])_([a-f0-9]{24})_([A-Za-z0-9_-]{22})$/i.exec(String(token || ""));
  if (!match) return null;

  const [, kind, id, sig] = match;
  if (![KIND_ORDER, KIND_SESSION, KIND_INVOICE].includes(kind)) return null;

  let expected;
  try {
    expected = signature(kind, id);
  } catch {
    // No key configured. Refuse rather than accept anything.
    return null;
  }

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(sig), "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  return {
    kind,
    id,
    isOrder: kind === KIND_ORDER,
    isSession: kind === KIND_SESSION,
    isInvoice: kind === KIND_INVOICE,
  };
};

/**
 * The absolute URL the customer receives.
 *
 * Served by the API, not a front end: the receipt is one static page with no
 * session, and routing it through an SPA would mean a public route in an app
 * that is otherwise entirely behind a login.
 */
const publicBaseUrl = () =>
  String(process.env.PUBLIC_API_URL || process.env.API_BASE_URL || "").replace(/\/+$/, "");

/**
 * The short host a customer actually reads: `https://bill.<base>/<token>`.
 *
 * A bill link is sent over WhatsApp and SMS, where the URL is the message --
 * `api.knotkitchen.com/r/o_65f...` announces an API and spends characters on a
 * path segment that means nothing to the diner. `bill.` says what the link is.
 *
 * The rewrite lives in Caddy, not here: the `bill.` vhost maps `/<token>` back
 * onto the `/r/<token>` route this service has always served, so the old form
 * keeps working for every link already sent. Those are in customers' message
 * histories and can never be reissued.
 *
 * Unset falls back to the long form, so a deployment that has not added the
 * vhost yet still mints links that work.
 */
const billBaseUrl = () => String(process.env.RECEIPT_PUBLIC_URL || "").replace(/\/+$/, "");

/**
 * Absolute or nothing. A relative "/r/<token>" is meaningless the moment it
 * leaves the server -- in a WhatsApp message it is not even a link -- and
 * WhatsApp rejects a blank template parameter, so a misconfigured origin has
 * to fail here, where the message says what is wrong.
 */
const receiptUrl = (token) => {
  const short = billBaseUrl();
  if (short) return `${short}/${token}`;

  const base = publicBaseUrl();
  if (!base) {
    throw new Error("PUBLIC_API_URL is not set, so the bill link would not be a working URL.");
  }
  return `${base}/r/${token}`;
};

const urlForOrder = (orderId) => receiptUrl(tokenForOrder(orderId));
const urlForSession = (sessionId) => receiptUrl(tokenForSession(sessionId));
const urlForInvoice = (invoiceId) => receiptUrl(tokenForInvoice(invoiceId));

module.exports = {
  KIND_ORDER,
  KIND_SESSION,
  KIND_INVOICE,
  tokenForOrder,
  tokenForSession,
  tokenForInvoice,
  urlForInvoice,
  readToken,
  receiptUrl,
  urlForOrder,
  urlForSession,
  publicBaseUrl,
};
