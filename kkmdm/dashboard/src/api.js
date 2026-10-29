// Thin client for the KKMDM admin API. Same-origin (Vite proxy in dev).
// Every state-changing call carries X-KKMDM: the server's CSRF guard.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || body?.error || `HTTP ${status}`);
    this.status = status;
    this.code = body?.error;
    this.body = body;
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(method, path, body, { raw } = {}) {
  const headers = {};
  if (method !== "GET") headers["X-KKMDM"] = "1";
  let payload;
  if (raw) {
    headers["Content-Type"] = "application/vnd.android.package-archive";
    payload = raw;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: "same-origin" });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (res.status === 401 && !path.startsWith("/auth/login") && !path.startsWith("/auth/reauth")) onUnauthorized();
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
