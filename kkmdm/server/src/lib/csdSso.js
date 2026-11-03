/**
 * Single sign-on from the KnotKitchen Customer Support Desk (owner,
 * 2026-11-03: KKMDM is used from inside CSD, in CSD's theme).
 *
 * CSD (pos-api) signs a short assertion with its own private key (ES256);
 * KKMDM checks it with CSD's public key, fetched from CSD over the internal
 * network. So KKMDM can never mint one itself, and nothing secret is shared.
 * Each assertion lives a minute and is used once.
 *
 * A CSD admin becomes a KKMDM Super Admin and CSD staff become Support; the
 * KKMDM account is linked to the CSD one (ssoSubject "csd:<id>"), so KKMDM's
 * own permissions and audit log apply. CSD requires two-factor sign-in, so
 * these accounts are not asked for KKMDM's own. Whether the CSD account is
 * still active is checked again every few minutes, so a disabled CSD account
 * loses KKMDM too, even with KKMDM's sessions that last until sign-out.
 */
const jwt = require("jsonwebtoken");
const config = require("../config");
const { source } = require("./storeSync");

const MAX_LIFE_S = 120;
const STATUS_TTL_MS = 5 * 60 * 1000;

let key = { pem: "", at: 0 };
/** CSD's public key, cached for an hour; `fresh` refetches (a rotated key). */
async function csdPublicKey(fresh = false) {
  if (!fresh && key.pem && Date.now() - key.at < 3600e3) return key.pem;
  const r = await fetch(config.csdSsoKeyUrl, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`CSD key: HTTP ${r.status}`);
  const body = await r.json();
  if (!body?.publicKey) throw new Error("CSD key: none returned");
  key = { pem: body.publicKey, at: Date.now() };
  return key.pem;
}

const used = new Map(); // jti -> expiry (ms): an assertion counts once
function spend(jti, expMs) {
  const now = Date.now();
  if (used.size > 2000) for (const [k, v] of used) if (v < now) used.delete(k);
  if (!jti || used.has(jti)) return false;
  used.set(jti, expMs);
  return true;
}

/**
 * The claims of a valid, unused assertion, or null. Claims: sub (CSD staff
 * _id), staffId, name, role ("admin" | "staff"), reauth (password and code
 * just confirmed in CSD).
 */
async function verifyAssertion(token, { getKey = csdPublicKey } = {}) {
  const check = (pem) => jwt.verify(String(token || ""), pem, { algorithms: ["ES256"], audience: "kkmdm", issuer: "csd" });
  let claims;
  try {
    claims = check(await getKey());
  } catch (e) {
    if (e?.name !== "JsonWebTokenError") return null;
    try { claims = check(await getKey(true)); } catch { return null; } // CSD may have a new key
  }
  if (!claims?.sub || !claims.exp || !claims.iat || claims.exp - claims.iat > MAX_LIFE_S) return null;
  if (!spend(claims.jti, claims.exp * 1000)) return null;
  return claims;
}

const roleFor = (csdRole) => (csdRole === "admin" ? "super_admin" : "support");

const status = new Map(); // csd staff _id -> { active, at }
/**
 * Is the linked CSD account still active? Read from KnotKitchen's database
 * (the same read-only link the store sync uses), cached a few minutes. True
 * where that link is not configured (development), so it never locks out.
 */
async function csdStaffActive(csdId, { now = Date.now() } = {}) {
  const hit = status.get(csdId);
  if (hit && now - hit.at < STATUS_TTL_MS) return hit.active;
  const conn = await source();
  if (!conn) return true;
  const mongoose = require("mongoose");
  if (!mongoose.Types.ObjectId.isValid(csdId)) return false;
  const row = await conn.collection("csdstaffs").findOne({ _id: new mongoose.Types.ObjectId(csdId) }, { projection: { status: 1 } });
  const active = row?.status === "active";
  status.set(csdId, { active, at: now });
  return active;
}

module.exports = { verifyAssertion, roleFor, csdStaffActive, csdPublicKey };
