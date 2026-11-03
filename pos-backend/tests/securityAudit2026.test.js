const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/** Security audit of the live sites (owner, 2026-11-03): what was found, and stays fixed. */

const SRC = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("a store's own website may call only the diner-side API, never staff or support routes", () => {
  const app = SRC("app.js");
  assert.match(app, /const WILDCARD_PATHS = \["\/api\/storefront", "\/api\/public", "\/api\/eats", "\/api\/qr", "\/api\/table-qr", "\/api\/payment-link", "\/api\/receipts"\];/);
  assert.match(app, /allow = allowedOrigins\.has\(clean\) \|\| \(isWildcardMatch\(clean\) && isPublicPath\(req\.path\)\);/);
});

test("MongoDB operators are dropped from every request before a route sees it", () => {
  const app = SRC("app.js");
  assert.match(app, /if \(key\.startsWith\("\$"\)\) delete value\[key\];/);
  assert.match(app, /stripOperators\(req\.body\);/);
  assert.match(app, /stripOperators\(req\.query\);/);
});

test("rate limits key on the address Caddy saw, not on a header the client typed", () => {
  const { clientIp } = require("../middlewares/rateLimiter");
  // Express sets req.ip from X-Forwarded-For under trust proxy; a forged first entry is ignored.
  assert.equal(clientIp({ ip: "203.0.113.9", headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.9" } }), "203.0.113.9");
  // Without req.ip, the LAST entry (added by Caddy) is used, never the first.
  assert.equal(clientIp({ headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.9" } }), "203.0.113.9");
});

test("authenticator codes match the RFC 6238 test vectors, and each is checked in constant time", () => {
  const totp = require("../services/totp");
  const secret = totp.toBase32(Buffer.from("12345678901234567890"));
  assert.equal(totp.codeAt(secret, 1), "287082");                       // T = 59 s
  assert.equal(totp.codeAt(secret, Math.floor(1111111109 / 30)), "081804");
  assert.equal(totp.codeAt(secret, Math.floor(1234567890 / 30)), "005924");
  const now = Date.now();
  assert.equal(totp.matchStep(secret, totp.codeAt(secret, totp.stepNow(now)), { now }), totp.stepNow(now));
  assert.equal(totp.matchStep(secret, "123", { now }), null);
  assert.match(SRC("services/totp.js"), /crypto\.timingSafeEqual\(want, Buffer\.from\(given\)\)/);
});

test("CSD: lockout after repeated failures, a code used once, sign-out ends the session", () => {
  const ctrl = SRC("controllers/csdAuthController.js");
  assert.match(ctrl, /const MAX_FAILED = 5;/);
  assert.match(ctrl, /if \(step === null \|\| step <= \(staff\.mfa\.lastStep \|\| 0\)\) \{/);
  // Sign-out ends this device's session row; the others stay signed in (owner, 2026-11-03).
  assert.ok(ctrl.includes("$pull: { sessions: { sid: req.csdSessionId } }"));
  assert.match(SRC("middlewares/csdAuth.js"), /\(decoded\.tv \|\| 0\) !== \(staff\.tokenVersion \|\| 0\)/);
});

test("passwords are hashed at bcrypt cost 12; the socket checks its token's algorithm", () => {
  assert.match(SRC("models/userModel.js"), /bcrypt\.genSalt\(12\)/);
  assert.match(SRC("models/csdStaffModel.js"), /bcrypt\.genSalt\(12\)/);
  assert.match(SRC("services/socket.js"), /algorithms: \["HS256"\]/);
});

test("Caddy: no other site can frame KnotKitchen pages; the POS site may use its camera; a bad Caddyfile never ships", () => {
  const caddy = fs.readFileSync(path.join(__dirname, "..", "..", "deploy", "Caddyfile"), "utf8");
  assert.match(caddy, /\?X-Frame-Options\s+"SAMEORIGIN"/);
  const deploy = fs.readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", "deploy.yml"), "utf8");
  assert.ok(deploy.indexOf("adapt --config /etc/caddy/Caddyfile") < deploy.indexOf("up -d --remove-orphans"), "checked before anything restarts");
});

test("recheck: a request that changes something must come from one of our own sites (CSRF)", () => {
  const app = SRC("app.js");
  assert.ok(app.includes(`const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);`));
  assert.ok(app.includes("if (allowedOrigins.has(clean) || (host && host === req.headers.host) || (isWildcardMatch(clean) && isPublicPath(req.path))) return next();"));
  assert.match(app, /code: "CROSS_SITE"/);
});

test("KKMDM inside CSD: CSD signs one-minute ES256 assertions; KKMDM can only verify them", () => {
  const svc = SRC("services/kkmdmSso.js");
  assert.ok(svc.includes(`{ algorithm: "ES256", audience: "kkmdm", issuer: "csd", expiresIn: 60 }`));
  assert.ok(svc.includes(`privateKey: seal(pair.privateKey.export({ type: "pkcs8", format: "pem" }))`), "the private half is sealed at rest");
  const routes = SRC("routes/csdRoute.js");
  // The public key is public; the assertions need a CSD session, which needs 2FA.
  assert.ok(routes.indexOf('router.get("/kkmdm/sso-key", kkmdmKey);') < routes.indexOf("router.use(requireCsdAuth);"));
  assert.ok(routes.indexOf('router.post("/kkmdm/sso", kkmdmAssertion);') > routes.indexOf("router.use(requireCsdAuth);"));
  assert.ok(!SRC("middlewares/csdAuth.js").includes('"/api/csd/kkmdm/sso"'), "not reachable before two-factor sign-in is on");
  // A mistyped password in the confirm step is a 400: CSD's screens sign out on a 401.
  const ctrl = SRC("controllers/csdAuthController.js");
  assert.ok(ctrl.includes(`return next(createHttpError(400, "That password is not right."));`));
});
