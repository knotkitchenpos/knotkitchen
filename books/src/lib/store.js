// The books, kept on the phone and synced with the server.
// Every save lands locally at once (works offline) and joins the outbox;
// sync() sends the outbox and brings back what the other partner changed.
// Same record edited on both phones: the one the server got last wins.
import { api, getAuth, setAuth } from "./api.js";
import { pendingFile, dropPendingFile } from "./files.js";

const K = { recs: "kkb.records", out: "kkb.outbox", since: "kkb.since" };
const load = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k) || "null") ?? d;
  } catch {
    return d;
  }
};
let recs = load(K.recs, {}); // id -> { id, kind, data, deleted, updatedAt, by }
let outbox = load(K.out, {}); // id -> local revision not yet on the server
let since = load(K.since, 0);

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
let status = "ok"; // ok | pending | offline | error
const emit = () => listeners.forEach((fn) => fn(status));
const persist = () => {
  localStorage.setItem(K.recs, JSON.stringify(recs));
  localStorage.setItem(K.out, JSON.stringify(outbox));
  localStorage.setItem(K.since, JSON.stringify(since));
};

export const unsyncedCount = () => Object.keys(outbox).length;
export const syncStatus = () => (Object.keys(outbox).length && status === "ok" ? "pending" : status);

export const list = (kind) =>
  Object.values(recs)
    .filter((r) => r.kind === kind && !r.deleted)
    .map((r) => ({ ...r.data, id: r.id, by: r.by }));

export const get = (id) => (recs[id] && !recs[id].deleted ? { ...recs[id].data, id } : null);

export const put = (kind, id, data) => {
  const { id: _drop, by: _by, ...clean } = data;
  recs[id] = { id, kind, data: clean, deleted: false, updatedAt: Date.now(), by: getAuth()?.email || "" };
  outbox[id] = (outbox[id] || 0) + 1;
  persist();
  emit();
  scheduleSync();
};

export const remove = (id) => {
  if (!recs[id]) return;
  recs[id] = { ...recs[id], deleted: true, updatedAt: Date.now() };
  outbox[id] = (outbox[id] || 0) + 1;
  persist();
  emit();
  scheduleSync();
};

// Everything, for the JSON backup.
export const dump = () => Object.values(recs).filter((r) => !r.deleted).map(({ id, kind, data }) => ({ id, kind, data }));
export const restore = (records) => {
  for (const r of records) {
    if (!r || typeof r.id !== "string" || !["invoice", "expense", "capital", "settings"].includes(r.kind)) continue;
    put(r.kind, r.id, r.data || {});
  }
};

export const clearLocal = () => {
  recs = {};
  outbox = {};
  since = 0;
  persist();
};

// ---- sync -----------------------------------------------------------------

let timer = null;
let running = null;
export const scheduleSync = (ms = 800) => {
  clearTimeout(timer);
  timer = setTimeout(() => sync(), ms);
};

// Receipts picked offline wait on the phone; upload them before their expense goes up.
const uploadPending = async () => {
  for (const r of Object.values(recs)) {
    const p = r.kind === "expense" && !r.deleted && r.data.receipt?.pending;
    if (!p) continue;
    const blob = await pendingFile(p);
    if (!blob) continue;
    const up = await api("/files", { method: "POST", raw: blob });
    put("expense", r.id, { ...r.data, receipt: { id: up.id, type: up.type, name: r.data.receipt.name || "" } });
    await dropPendingFile(p);
  }
};

let onSignedOut = () => {};
export const setOnSignedOut = (fn) => (onSignedOut = fn);

export const sync = async () => {
  if (!getAuth()?.token) return;
  if (running) return running;
  running = (async () => {
    try {
      await uploadPending();
      const sent = { ...outbox };
      const changes = Object.keys(sent)
        .filter((id) => recs[id])
        .map((id) => ({ id, kind: recs[id].kind, data: recs[id].data, deleted: recs[id].deleted }));
      const res = await api("/sync", { method: "POST", body: { since, changes } });
      for (const r of res.applied) {
        // Edited again while this was in flight: keep the newer local copy for next time.
        if (outbox[r.id] === sent[r.id]) {
          delete outbox[r.id];
          recs[r.id] = r;
        }
      }
      for (const r of res.records) if (!outbox[r.id]) recs[r.id] = r;
      since = res.now;
      if (res.token) setAuth({ ...getAuth(), token: res.token });
      status = "ok";
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        status = "error";
        // 401 = session expired: keep what is on the phone, it goes up after signing in.
        // 403 = taken off the access list: this phone must forget the books.
        onSignedOut(err.message, err.status === 401);
      } else status = err.status ? "error" : "offline";
    } finally {
      persist();
      emit();
      running = null;
    }
  })();
  return running;
};

window.addEventListener("online", () => scheduleSync(100));
setInterval(() => {
  if (document.visibilityState === "visible") sync();
}, 60_000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") scheduleSync(100);
});
