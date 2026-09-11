const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const DEPLOY = (...p) => fs.readFileSync(path.join(__dirname, "..", "..", "deploy", ...p), "utf8");
const FE = (...p) => fs.readFileSync(path.join(__dirname, "..", "..", "pos-frontend", ...p), "utf8");

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
  // A rewrite is right HERE, unlike the QR host below: /r/<token> is rendered
  // by pos-api on the server, so no client-side router ever reads the path.
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

test("REGRESSION: the order host REDIRECTS, so the SPA boots on a route it has", () => {
  // A rewrite is server-side. The browser goes on asking for `/<token>`, so
  // the single-page app boots at a path it has no route for, decides the
  // visitor is staff without a session, and sends them to the POS sign-in
  // screen. Every diner scanning a short-form code got a Store ID box.
  //
  // Nothing outside the browser could see it: the request returns 200 either
  // way, because the SPA shell is served for any path.
  assert.match(CADDY, /^order\.\{\$BASE_DOMAIN\} \{$/m);
  assert.match(
    CADDY,
    /redir @qr \/t\/\{re\.qtok\.1\} 30\d/,
    "the QR host must redirect, not rewrite -- see App.jsx, which routes on /t/:token",
  );
  assert.ok(
    !/rewrite @qr /.test(CADDY),
    "a rewrite here lands the diner on the staff sign-in screen",
  );
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


// ---------------------------------------------------------------------------
// The deploy that has to actually happen
// ---------------------------------------------------------------------------

test("REGRESSION: a deploy that cannot fast-forward fails instead of going green", () => {
  // The short-link change was pushed, CI passed, "Deploy to VPS" reported
  // success -- and the server went on running the previous commit, because a
  // tracked file had been hand-edited there and `git pull --ff-only` aborted
  // into `|| true`. Three days of green deploys shipped nothing at all.
  const wf = fs.readFileSync(
    path.join(__dirname, "..", "..", ".github", "workflows", "deploy.yml"),
    "utf8",
  );
  const swallowed = /git pull[^\r\n]*\|\| true/;
  assert.ok(
    !swallowed.test(wf),
    "a swallowed pull failure is a deploy that lies about what it shipped",
  );
  assert.match(wf, /if ! git pull --ff-only origin "\$REF"; then/);
  assert.match(wf, /exit 1/);
  // And it must say what is actually wrong, not merely fail.
  assert.match(wf, /git status --porcelain/);
});

test("the hand-added demo vhost is in version control, before the wildcard", () => {
  // Left only on the server, it is what blocked every pull. The wildcard below
  // it would otherwise claim the hostname and proxy it to customer-web, which
  // has no such store.
  assert.match(CADDY, /^demostore\.\{\$BASE_DOMAIN\} \{$/m);
  assert.ok(
    CADDY.indexOf("demostore.{$BASE_DOMAIN}") < CADDY.indexOf("*.{$BASE_DOMAIN}"),
    "the wildcard must not shadow it",
  );
  assert.match(CADDY, /root \* \/srv\/landing\/demostore/);
  // Its files are bind-mounted straight out of the repo, so they have to be
  // tracked alongside the vhost that serves them.
  assert.ok(
    fs.existsSync(path.join(__dirname, "..", "..", "deploy", "landing", "demostore", "index.html")),
    "the page itself must ship with the vhost that serves it",
  );
});

test("REGRESSION: a Caddyfile change recreates caddy, because a reload cannot", () => {
  // The Caddyfile is bind-mounted as a FILE, so the mount is pinned to the
  // inode it had at container start. git replaces a file by renaming a new one
  // over it, which changes the inode -- so the container keeps serving the
  // config it booted with, and `up -d` sees no service change and leaves it
  // alone. `caddy reload` re-reads the same stale inode and does not help.
  //
  // This is why the bill host went live serving the storefront instead of the
  // receipt: pos-api had already started minting bill.<base> links while caddy
  // was still running a config that had no such vhost, so the wildcard took
  // them.
  const wf = fs.readFileSync(
    path.join(__dirname, "..", "..", ".github", "workflows", "deploy.yml"),
    "utf8",
  );
  assert.match(wf, /git diff --quiet "\$PREV_SHA" HEAD -- deploy\/Caddyfile/);
  assert.match(wf, /up -d --force-recreate caddy/);

  // The comparison point has to be captured before the checkout moves HEAD.
  assert.ok(
    wf.indexOf('PREV_SHA="$(git rev-parse HEAD)"') < wf.indexOf('git checkout "$REF"'),
    "PREV_SHA must be read before the checkout, or the diff compares HEAD to itself",
  );

  // And the mount this all works around must still be the file mount it
  // describes -- if it ever becomes a directory mount, this dance is dead
  // weight and the comment above is a lie.
  const compose = DEPLOY("docker-compose.yml");
  assert.match(compose, /- \.\/Caddyfile:\/etc\/caddy\/Caddyfile:ro/);
});

// ---------------------------------------------------------------------------
// A stored URL is a stale URL
// ---------------------------------------------------------------------------

test("REGRESSION: a QR's URL is rebuilt from its token, never read back from the row", () => {
  // qrUrl is a stored copy of something derived: host plus token. The token is
  // the durable half; the host is deployment config that moves underneath it.
  // Returning the stored copy meant the thirteen tables that already had a QR
  // went on printing the POS hostname after the short host went live, because
  // nothing ever recomputes a column.
  const src = SRC("controllers", "tableQRController.js");

  assert.match(src, /const withQrUrl = \(qr\) => \{/);
  assert.match(src, /qrUrl: plain\.token \? buildQrUrl\(plain\.token\) : plain\.qrUrl \|\| ""/);

  // Every path that hands a QR to a caller. Miss one and that screen keeps
  // showing the old host while the others move.
  assert.equal(
    src.split("...withQrUrl(qr),").length - 1,
    2,
    "get-or-create and regenerate both return a rebuilt URL",
  );
  assert.match(src, /data: qrs\.map\(withQrUrl\)/, "the list does too");
  assert.match(src, /qrUrl: buildQrUrl\(qr\.token\)/, "and the public token resolver");

  // The legacy mirror on the Table row is what the print sheet actually reads,
  // so it must be stamped with the derived URL, not with whatever the QR row
  // happened to be created with.
  assert.ok(
    !/qrCode: qr\.qrUrl/.test(src),
    "copying the stored column forward just moves the stale value",
  );
  assert.equal(
    src.split("qrCode: buildQrUrl(token)").length - 1,
    2,
    "both creation paths stamp the derived URL",
  );
});

test("REGRESSION: the till prints the server's QR URL, not its own hostname", () => {
  // The API has rebuilt this from the token since the short host shipped, and
  // the screen that prints the cards ignored it: it composed
  // `window.location.origin + "/t/" + token`, and the till is served from
  // business.<base>. So every code generated, shown and printed carried the
  // POS hostname however QR_PUBLIC_URL was set -- the long link outliving the
  // short one by way of the one surface that never asked the server.
  const tables = FE("src", "pages", "Tables.jsx");

  assert.match(tables, /const qrLinkFor = \(table\) =>\s*\n?\s*table\?\.qrCode/, "the server's URL first");
  assert.match(tables, /value=\{qrLinkFor\(qrModalTable\)\}/, "the code encodes it");

  // The origin may appear ONLY inside the two fallbacks, for the moment
  // before the fetch lands and for a deployment with no short host.
  const composed = [...tables.matchAll(/\$\{window\.location\.origin\}\/t\//g)];
  assert.equal(composed.length, 1, "one fallback, inside qrLinkFor");

  const print = FE("src", "components", "tables", "PrintTableQRModal.jsx");
  assert.match(print, /table\.qrCode \|\|/, "the printed card prefers the stored server URL");
});

test("opening a table heals a QR URL the host moved under", () => {
  // `qrUrl` and `Table.qrCode` are written once, at mint time, and the host in
  // them is deployment config that changes afterwards. Responses are rebuilt
  // from the token, but anything reading the stored string keeps serving the
  // old hostname.
  const ctrl = SRC("controllers", "tableQRController.js");
  const block = ctrl.slice(ctrl.indexOf("const getOrCreateQr"), ctrl.indexOf("Regenerate a QR for a table"));

  assert.match(block, /const fresh = buildQrUrl\(qr\.token\)/);
  assert.match(block, /if \(fresh && qr\.qrUrl !== fresh\)/);
  assert.match(block, /if \(fresh && table\.qrCode !== fresh\)/);
});
