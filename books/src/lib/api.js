// Talks to /api/books on the KnotKitchen server. The session token lives on the phone.
const BASE = (import.meta.env?.VITE_API_BASE || "").replace(/\/$/, "");
const AUTH_KEY = "kkb.auth";

export const getAuth = () => {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
  } catch {
    return null;
  }
};
export const setAuth = (a) => (a ? localStorage.setItem(AUTH_KEY, JSON.stringify(a)) : localStorage.removeItem(AUTH_KEY));

export const api = async (path, { method = "GET", body, raw } = {}) => {
  const headers = {};
  const auth = getAuth();
  if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
  let payload;
  if (raw) {
    headers["Content-Type"] = "application/octet-stream";
    payload = raw;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}/api/books${path}`, { method, headers, body: payload });
  if (!res.ok) {
    let message = `Error ${res.status}`;
    try {
      message = (await res.json()).message || message;
    } catch {
      /* not JSON */
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return path.startsWith("/files/") && method === "GET" ? res.blob() : res.json();
};
