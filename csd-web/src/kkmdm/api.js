// KKMDM's API, reached from CSD (owner, 2026-11-03: KKMDM inside CSD).
// Same shape as kkmdm/dashboard/src/api.js, so its screens run here unchanged.
// Signing in is CSD's: on a 401 the CSD server hands over a one-minute
// assertion (POST /api/csd/kkmdm/sso) which KKMDM turns into its own session
// cookie, and the call is retried. Every call carries X-KKMDM, KKMDM's CSRF guard.
import { kkmdm as csd } from "../api";

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || body?.error || `HTTP ${status}`);
    this.status = status;
    this.code = body?.error;
    this.body = body;
  }
}

/** KKMDM's address: mdm.<the domain CSD is on>, or the local server in development. */
export const KKMDM_URL = (
  import.meta.env.VITE_KKMDM_URL ||
  (["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "http://localhost:8100"
    : `https://mdm.${window.location.hostname.replace(/^csd\./, "")}`)
).replace(/\/$/, "");

const send = (path, init) => fetch(`${KKMDM_URL}/api${path}`, { credentials: "include", ...init });

const parse = async (res) => {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { error: text };
  }
};

/** Turn a CSD assertion into a KKMDM session. Returns the KKMDM account. */
const exchange = async ({ assertion }) => {
  const res = await send("/auth/sso", { method: "POST", headers: { "Content-Type": "application/json", "X-KKMDM": "1" }, body: JSON.stringify({ assertion }) });
  const body = await parse(res);
  if (!res.ok) throw new ApiError(res.status, body);
  return body.admin;
};

let signingIn = null;
/** Sign in to KKMDM through CSD; concurrent callers share one sign-in. */
export const signIn = () => {
  if (!signingIn) signingIn = csd.sso().then(exchange).finally(() => { signingIn = null; });
  return signingIn;
};

/** Before a destructive action: the CSD password and code, confirmed, make a fresh KKMDM sign-in. */
export const reauthenticate = (password, code) => csd.reauth({ password, code }).then(exchange);

async function request(method, path, body, { raw, retried } = {}) {
  const headers = { "X-KKMDM": "1" };
  let payload;
  if (raw) {
    headers["Content-Type"] = "application/vnd.android.package-archive";
    payload = raw;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await send(path, { method, headers, body: payload });
  if (res.status === 401 && !retried) {
    await signIn();
    return request(method, path, body, { raw, retried: true });
  }
  const data = await parse(res);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  get: (p) => request("GET", p),
  post: (p, b) => request("POST", p, b ?? {}),
  put: (p, b) => request("PUT", p, b),
  patch: (p, b) => request("PATCH", p, b),
  del: (p) => request("DELETE", p),
  upload: (p, file) => request("POST", p, undefined, { raw: file }),
};

export function qs(params) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "" && v !== false && v !== null) s.set(k, v);
  const out = s.toString();
  return out ? `?${out}` : "";
}
