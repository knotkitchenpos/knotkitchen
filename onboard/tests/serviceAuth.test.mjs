import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { allowServiceToken, isConfigured } =
  require("../server/middleware/serviceAuth.js");

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${!ok && d ? "  <- " + d : ""}`); };

const TOKEN = "a".repeat(64);
const req = (token) => ({ headers: token === undefined ? {} : { "x-service-token": token } });

// A stand-in for the portal's real guard.
const denied = [];
const YOUR_GUARD = (r, res, next) => { denied.push(1); res.code = 401; };
const run = (mw, r) => { const res = {}; let passed = false; mw(r, res, () => { passed = true; }); return { passed, res }; };

console.log("\n--- with a token configured ---");
process.env.ONBOARD_SERVICE_TOKEN = TOKEN;
{
  const mw = allowServiceToken(YOUR_GUARD);
  check("configured", isConfigured() === true);
  check("correct token is allowed", run(mw, req(TOKEN)).passed);
  check("service call is flagged", (() => { const r = req(TOKEN); run(mw, r); return r.isServiceCall === true; })());
  check("wrong token falls through to the real guard", !run(mw, req("b".repeat(64))).passed);
  check("no token falls through to the real guard", !run(mw, req(undefined)).passed);
  check("empty token falls through", !run(mw, req("")).passed);
  check("a prefix of the token does not match", !run(mw, req("a".repeat(63))).passed);
  check("array-valued header does not match", !run(mw, req(["x"])).passed);
  check("a session user still gets in", (() => {
    const ok = (r, res, next) => next();
    return run(allowServiceToken(ok), req(undefined)).passed;
  })());
}

console.log("\n--- fail-closed when misconfigured ---");
{
  const mw = allowServiceToken(YOUR_GUARD);
  process.env.ONBOARD_SERVICE_TOKEN = "";
  check("unset: not configured", isConfigured() === false);
  check("unset: empty token does NOT authenticate", !run(mw, req("")).passed);
  check("unset: nothing authenticates", !run(mw, req(TOKEN)).passed);
  process.env.ONBOARD_SERVICE_TOKEN = "short";
  check("too short: refuses to match itself", !run(mw, req("short")).passed);
}

console.log("\n--- wire-up safety ---");
process.env.ONBOARD_SERVICE_TOKEN = TOKEN;
{
  let threw = false;
  try { allowServiceToken(); } catch { threw = true; }
  check("no guard is a wire-up error, not a silent open door", threw);

  let ok = false;
  try { ok = run(allowServiceToken(allowServiceToken.PUBLIC), req(undefined)).passed; } catch { /* none */ }
  check("explicitly PUBLIC is allowed through", ok);
}

console.log("\n--- multiple guards ---");
{
  const order = [];
  const g1 = (r, s, n) => { order.push(1); n(); };
  const g2 = (r, s, n) => { order.push(2); n(); };
  check("both guards run, in order", run(allowServiceToken(g1, g2), req(undefined)).passed && order.join() === "1,2", order.join());

  const boom = () => { throw new Error("guard exploded"); };
  let err = null;
  allowServiceToken(boom)(req(undefined), {}, (e) => { err = e; });
  check("a throwing guard becomes next(err)", err instanceof Error, String(err));

  let err2 = null;
  allowServiceToken((r, s, n) => n(new Error("nope")), g2)(req(undefined), {}, (e) => { err2 = e; });
  check("next(err) short-circuits the chain", err2 instanceof Error && !order.includes(2, 2));
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
