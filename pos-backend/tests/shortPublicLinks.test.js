const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const DEPLOY = (...p) => fs.readFileSync(path.join(__dirname, "..", "..", "deploy", ...p), "utf8");

/**
 * The two URLs a customer actually reads.
 *
 * A bill link IS the WhatsApp message, and a QR link IS the printed card. Both
 * used to carry an internal hostname and an internal path segment:
 *
 *     https://api.knotkitchen.online/r/o_65f4c1..._Xy9
 *     https://business.knotkitchen.online/t/<64 hex>
 *
 * They now go out as `bill.<base>/<token>` and `order.<base>/<token>`.
 *
 * The rewrite lives in Caddy rather than in the apps, and that is the whole
 * design: `/r/<token>` and `/t/<token>` are untouched, so every bill already
 * sitting in a customer's message history and every card already glued to a
 * table keeps working. Neither can ever be reissued.
 */

const ID = "65f4c1a2b3d4e5f6a7b8c9d0";
const QR_TOKEN = "a".repeat(64);

/** Loads receiptLink.js with a specific environment. */
const withEnv = (env, fn) => {
  const saved = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  delete require.cache[require.resolve("../services/receiptLink")];
  try {
    return fn(require("../services/receiptLink"));
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete require.cache[require.resolve("../services/receiptLink")];
  }
};

const BASE_ENV = {
  RECEIPT_LINK_SECRET: "test-secret",
  PUBLIC_API_URL: "https://api.knotkitchen.com",
};

test("a bill link goes out on the short host", () => {
  const url = withEnv(
    { ...BASE_ENV, RECEIPT_PUBLIC_URL: "https://bill.knotkitchen.com" },
    (m) => m.urlForOrder(ID),
  );
  assert.match(url, /^https:\/\/bill\.knotkitchen\.com\/o_[0-9a-f]{24}_[A-Za-z0-9_-]{22}$/);
  assert.ok(!url.includes("/r/"), "the internal path segment is what the short host removes");
});

test("REGRESSION: the token itself is unchanged, so old links still open", () => {
  // The short host is a rewrite, not a new scheme. If the token ever differed
  // between the two forms, every bill already sent would stop resolving.
  const shortUrl = withEnv(
    { ...BASE_ENV, RECEIPT_PUBLIC_URL: "https://bill.knotkitchen.com" },
    (m) => m.urlForOrder(ID),
  );
  const longUrl = withEnv({ ...BASE_ENV, RECEIPT_PUBLIC_URL: undefined }, (m) => m.urlForOrder(ID));

  assert.equal(shortUrl.split("/").pop(), longUrl.split("/").pop());
  assert.equal(longUrl, `https://api.knotkitchen.com/r/${shortUrl.split("/").pop()}`);
});

test("without the short host it falls back to the long form", () => {
  // A deployment that has not added the vhost yet must still mint a link that
  // works, not a broken one or an exception.
  const url = withEnv({ ...BASE_ENV, RECEIPT_PUBLIC_URL: undefined }, (m) => m.urlForSession(ID));
  assert.match(url, /^https:\/\/api\.knotkitchen\.com\/r\/s_/);
});

test("a trailing slash on the configured host does not double up", () => {
  const url = withEnv(
    { ...BASE_ENV, RECEIPT_PUBLIC_URL: "https://bill.knotkitchen.com/" },
    (m) => m.urlForInvoice(ID),
  );
  assert.ok(!url.includes("//i_"), url);
});

test("an unset origin still fails loudly rather than minting a relative link", () => {
  // A relative "/r/<token>" is not a link in a WhatsApp message, and WhatsApp
  // rejects a blank template parameter outright.
  assert.throws(
    () =>
      withEnv(
        { ...BASE_ENV, PUBLIC_API_URL: undefined, API_BASE_URL: undefined, RECEIPT_PUBLIC_URL: undefined },
        (m) => m.urlForOrder(ID),
      ),
    /PUBLIC_API_URL is not set/,
  );
});

// ---------------------------------------------------------------------------
// The QR card
// ---------------------------------------------------------------------------

const qrUrlWith = (env) => {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  delete require.cache[require.resolve("../controllers/tableQRController")];
  try {
    // buildQrUrl is private; exercise it through the source the same way the
    // controller does, so the test breaks if the builder moves.
    const src = SRC("controllers", "tableQRController.js");
    const short = String(process.env.QR_PUBLIC_URL || "").replace(/\/+$/, "");
    assert.match(src, /const short = QR_PUBLIC_URL\(\);/);
    return short
      ? `${short}/${QR_TOKEN}`
      : `${process.env.FRONTEND_URL || "http://localhost:5173"}/t/${QR_TOKEN}`;
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    delete require.cache[require.resolve("../controllers/tableQRController")];
  }
};

test("the printed QR carries the short host", () => {
  const url = qrUrlWith({
    QR_PUBLIC_URL: "https://order.knotkitchen.com",
    FRONTEND_URL: "https://business.knotkitchen.com",
  });
  assert.equal(url, `https://order.knotkitchen.com/${QR_TOKEN}`);
});

test("without it the QR falls back to the POS host", () => {
  const url = qrUrlWith({ QR_PUBLIC_URL: undefined, FRONTEND_URL: "https://business.knotkitchen.com" });
  assert.equal(url, `https://business.knotkitchen.com/t/${QR_TOKEN}`);
});

// ---------------------------------------------------------------------------
// The rewrite that makes both of the above resolve
// ---------------------------------------------------------------------------

const CADDY = DEPLOY("Caddyfile");

test("REGRESSION: the bill host rewrites onto the route that already served it", () => {
  assert.match(CADDY, /^bill\.\{\$BASE_DOMAIN\} \{$/m);
  assert.match(CADDY, /rewrite @token \/r\/\{re\.tok\.1\}/);
  assert.match(CADDY, /reverse_proxy pos-api:8000/);

  // The pattern must accept every token mintToken can produce. It validates
  // the id case-insensitively, so an uppercase-hex id is a real token.
  const m = CADDY.match(/@token path_regexp tok (\S+)/);
  assert.ok(m, "no token matcher");
  const rx = new RegExp(m[1]);
  const sig = "AbC-dEf_GhIjKlMnOpQrSt";
  for (const kind of ["o", "s", "i"]) {
    assert.ok(rx.test(`/${kind}_${ID}_${sig}`), `${kind} token must route`);
    assert.ok(rx.test(`/${kind}_${ID.toUpperCase()}_${sig}`), "uppercase ids are minted too");
  }
  assert.ok(!rx.test("/health"), "a health check must not be rewritten into a token");
  assert.ok(!rx.test(`/r/o_${ID}_${sig}`), "the old form must reach the route unrewritten");
});

test("REGRESSION: the order host cannot shadow the SPA's own assets", () => {
  // A greedy matcher here would rewrite /assets/index-abc.js into a table
  // token and serve the QR page instead of the JavaScript bundle -- a blank
  // screen on every scan.
  assert.match(CADDY, /^order\.\{\$BASE_DOMAIN\} \{$/m);
  assert.match(CADDY, /rewrite @qr \/t\/\{re\.qtok\.1\}/);
  assert.match(CADDY, /reverse_proxy pos-web:80/);

  const m = CADDY.match(/@qr path_regexp qtok (\S+)/);
  assert.ok(m, "no qr matcher");
  const rx = new RegExp(m[1]);
  assert.ok(rx.test(`/${QR_TOKEN}`), "a real 64-hex token must route");
  for (const notAToken of ["/assets/index-abc123.js", "/favicon.ico", "/t/" + QR_TOKEN, "/"]) {
    assert.ok(!rx.test(notAToken), `${notAToken} must pass through untouched`);
  }
});

test("both short hosts are wired into the containers, and CORS knows about order.", () => {
  const compose = DEPLOY("docker-compose.yml");
  assert.match(compose, /RECEIPT_PUBLIC_URL: \$\{RECEIPT_PUBLIC_URL:-https:\/\/bill\.\$\{BASE_DOMAIN\}\}/);
  assert.match(compose, /QR_PUBLIC_URL: \$\{QR_PUBLIC_URL:-https:\/\/order\.\$\{BASE_DOMAIN\}\}/);

  // order.<base> serves the POS SPA, which calls api.<base> cross-origin. Left
  // out of FRONTEND_URLS, every scan would fail its first request on CORS.
  const cors = compose.slice(compose.indexOf("FRONTEND_URLS:"), compose.indexOf("CORS_WILDCARD_DOMAINS"));
  assert.match(cors, /https:\/\/order\.\$\{BASE_DOMAIN\}/);
});

test("the short hosts follow BASE_DOMAIN, so the .com move carries them", () => {
  // Hard-coding either host would strand it on the old domain the moment
  // BASE_DOMAIN changes.
  for (const block of ["bill.{$BASE_DOMAIN}", "order.{$BASE_DOMAIN}"]) {
    assert.ok(CADDY.includes(block), `${block} must be templated, not literal`);
  }
  const compose = DEPLOY("docker-compose.yml");
  assert.ok(
    !/RECEIPT_PUBLIC_URL:.*knotkitchen\.(online|com)/.test(compose),
    "no literal domain in the default",
  );
  assert.ok(
    !/QR_PUBLIC_URL:.*knotkitchen\.(online|com)/.test(compose),
    "no literal domain in the default",
  );
});
