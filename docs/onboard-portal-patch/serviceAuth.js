/**
 * Service-token authentication for the KnotKitchen onboarding portal.
 *
 * ---------------------------------------------------------------------------
 * COPY THIS FILE INTO THE PORTAL REPO (suggested: server/middleware/serviceAuth.js)
 * ---------------------------------------------------------------------------
 *
 * Why this exists
 * ---------------
 * The CSD admin panel needs to read agreements and their uploaded documents so
 * it can turn a signed agreement into a store. The portal's API is
 * session-authenticated for human sales agents; CSD is a server and has no
 * session, so it presents a shared secret instead.
 *
 * Why it WRAPS the existing guard rather than replacing it
 * --------------------------------------------------------
 * The obvious implementation is a second, independent auth path: "if service
 * token, allow; else run the normal check" written out at each call site. That
 * drifts. The day someone changes how agent sessions work, the service path
 * silently keeps the old behaviour — and the service path is the one holding
 * every customer's KYC.
 *
 * So this is a single wrapper. It takes the route's REAL guard as an argument
 * and delegates to it untouched whenever no valid service token is present.
 * Existing behaviour for logged-in agents is preserved by construction, and
 * there is exactly one place to audit.
 *
 * No dependencies beyond Node's stdlib — it should drop into any Express app.
 */

const crypto = require("crypto");

/**
 * A short or empty token must never authenticate anything. If the env var is
 * unset in some environment, every request there presents "" — and "" must not
 * match "". Failing closed here is the difference between "the feature is off"
 * and "the agreements API is public".
 */
const MIN_TOKEN_LENGTH = 24;

const configuredToken = () => process.env.ONBOARD_SERVICE_TOKEN || "";

const presentedToken = (req) => {
  const header = req.headers["x-service-token"];
  return typeof header === "string" ? header : "";
};

/**
 * Constant-time comparison. Lengths are compared first because
 * timingSafeEqual throws on a length mismatch; that leaks the token's LENGTH
 * to an attacker, which is not a secret worth protecting, whereas leaking its
 * CONTENT one byte at a time through response timing would be.
 */
const tokenMatches = (given) => {
  const expected = configuredToken();
  if (expected.length < MIN_TOKEN_LENGTH) return false;
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
};

/**
 * Marker for routes that genuinely have no guard today.
 *
 * Passing no guard at all is a wire-up error rather than a silent open door:
 * `allowServiceToken()` with nothing to fall through to would leave the route
 * unauthenticated for everyone, which is almost never what someone means. If
 * a route really is public, say so explicitly with this marker so the choice
 * is visible in the diff and in review.
 */
const PUBLIC = Symbol("serviceAuth.PUBLIC");

/**
 * Wrap one or more existing Express guards so that a valid service token is
 * accepted in their place.
 *
 *   router.get("/agreements", allowServiceToken(requireAuth), listAgreements);
 *
 * On a service call, `req.isServiceCall` is set to true, so handlers can tell
 * the two apart if they ever need to (for logging, or to skip agent-specific
 * personalisation). Nothing is required to use it.
 */
const allowServiceToken = (...guards) => {
  const chain = guards.flat().filter((g) => g !== PUBLIC && Boolean(g));
  const isPublic = guards.flat().includes(PUBLIC);

  if (!chain.length && !isPublic) {
    throw new Error(
      "allowServiceToken() needs the route's existing guard, so non-service " +
        "callers are still authenticated. If the route is intentionally " +
        "public, pass allowServiceToken.PUBLIC explicitly."
    );
  }

  return (req, res, next) => {
    if (tokenMatches(presentedToken(req))) {
      req.isServiceCall = true;
      return next();
    }

    if (!chain.length) return next(); // explicitly PUBLIC

    // Run the real guards in order, exactly as Express would have.
    let i = 0;
    const step = (err) => {
      if (err) return next(err);
      const guard = chain[i];
      i += 1;
      if (!guard) return next();
      try {
        guard(req, res, step);
      } catch (thrown) {
        next(thrown);
      }
    };
    step();
  };
};

allowServiceToken.PUBLIC = PUBLIC;

/** True when a token is configured well enough to ever match. */
const isConfigured = () => configuredToken().length >= MIN_TOKEN_LENGTH;

module.exports = { allowServiceToken, isConfigured, PUBLIC };
