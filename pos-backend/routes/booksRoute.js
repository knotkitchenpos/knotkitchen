const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const createHttpError = require("http-errors");
const config = require("../config/config");
const { BooksRecord, BooksConfig } = require("../models/booksModel");
const { sniffMime, ALLOWED_MIME, DOCUMENTS_DIR } = require("../services/csdDocumentStorage");
const { rateLimit } = require("../middlewares/rateLimiter");

// KnotKitchen Books (books/): the two partners' accounting app. Sign-in is
// Google; only emails on the access list (books_config "access", first seeded
// from BOOKS_ALLOWED_EMAILS) get a token. Bill photos sit with the restaurant
// documents in a directory nothing serves, and stream only through here.
const router = express.Router();

const GOOGLE_CLIENT_IDS = (process.env.BOOKS_GOOGLE_CLIENT_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
const TOKEN_SECRET = crypto.createHmac("sha256", config.accessTokenSecret).update("kk-books-v1").digest();
const FILES_DIR = path.join(DOCUMENTS_DIR, "books");
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const FILE_RE = /^[a-f0-9]{32}\.(pdf|jpg|png|webp|heic)$/;
const KINDS = new Set(["invoice", "expense", "capital", "settings"]);

// ---- access list --------------------------------------------------------

const normEmail = (e) => String(e || "").trim().toLowerCase();
let accessCache = { at: 0, list: [] };
const allowedUsers = async () => {
  if (Date.now() - accessCache.at < 30_000) return accessCache.list;
  let doc = await BooksConfig.findById("access").lean();
  if (!doc) {
    const seed = (process.env.BOOKS_ALLOWED_EMAILS || "").split(",").map(normEmail).filter(Boolean);
    if (seed.length) doc = await BooksConfig.findOneAndUpdate({ _id: "access" }, { $setOnInsert: { allowedUsers: seed } }, { upsert: true, new: true }).lean();
  }
  accessCache = { at: Date.now(), list: (doc?.allowedUsers || []).map(normEmail) };
  return accessCache.list;
};

const issue = (email, name) => ({
  token: jwt.sign({ sub: email, name: name || "", scope: "books" }, TOKEN_SECRET, { algorithm: "HS256", expiresIn: "120d" }),
  email,
  name: name || "",
});

const requireUser = async (req, _res, next) => {
  try {
    const raw = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    let claims;
    try {
      claims = jwt.verify(raw, TOKEN_SECRET, { algorithms: ["HS256"] });
    } catch {
      return next(createHttpError(401, "Please sign in again."));
    }
    // Taking a partner off the list locks them out at once, token or not.
    if (claims.scope !== "books" || !(await allowedUsers()).includes(claims.sub)) return next(createHttpError(403, "This account is not allowed."));
    req.booksUser = claims.sub;
    req.booksClaims = claims;
    next();
  } catch (err) {
    next(err);
  }
};

// ---- Google sign-in -----------------------------------------------------

let googleKeys = { at: 0, keys: {} };
const googleKey = async (kid) => {
  if (!googleKeys.keys[kid] || Date.now() - googleKeys.at > 3600_000) {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/certs");
    if (!res.ok) throw createHttpError(502, "Could not reach Google. Try again.");
    const { keys } = await res.json();
    googleKeys = { at: Date.now(), keys: Object.fromEntries(keys.map((k) => [k.kid, crypto.createPublicKey({ key: k, format: "jwk" })])) };
  }
  return googleKeys.keys[kid];
};

const authLimit = rateLimit({ windowMs: 15 * 60_000, max: 30, message: "Too many sign-in attempts. Try again later." });

router.post("/auth/google", authLimit, async (req, res, next) => {
  try {
    if (!GOOGLE_CLIENT_IDS.length) return next(createHttpError(503, "Google sign-in is not set up (BOOKS_GOOGLE_CLIENT_IDS)."));
    const idToken = String(req.body?.idToken || "");
    const kid = jwt.decode(idToken, { complete: true })?.header?.kid;
    const key = kid && (await googleKey(kid));
    if (!key) return next(createHttpError(401, "Google sign-in failed."));
    let g;
    try {
      g = jwt.verify(idToken, key, { algorithms: ["RS256"], audience: GOOGLE_CLIENT_IDS, issuer: ["accounts.google.com", "https://accounts.google.com"] });
    } catch {
      return next(createHttpError(401, "Google sign-in failed."));
    }
    const email = normEmail(g.email);
    if (!g.email_verified || !(await allowedUsers()).includes(email)) return next(createHttpError(403, `${email || "This account"} is not allowed to use KnotKitchen Books.`));
    res.json(issue(email, g.name));
  } catch (err) {
    next(err);
  }
});

// Local testing only: sign in as an allowed email without Google.
router.post("/auth/dev", authLimit, async (req, res, next) => {
  try {
    if (config.isProduction || process.env.BOOKS_DEV_LOGIN !== "1") return next(createHttpError(404, "Not found"));
    const email = normEmail(req.body?.email);
    if (!(await allowedUsers()).includes(email)) return next(createHttpError(403, "Not on the access list."));
    res.json(issue(email, email.split("@")[0]));
  } catch (err) {
    next(err);
  }
});

router.get("/auth/config", (_req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_IDS[0] || "", devLogin: !config.isProduction && process.env.BOOKS_DEV_LOGIN === "1" });
});

// ---- sync ---------------------------------------------------------------

const plain = (r) => ({ id: r._id, kind: r.kind, data: r.data, deleted: r.deleted, by: r.by, updatedAt: new Date(r.updatedAt).getTime() });
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Two partners saved the same number offline: the later one takes the next free number.
const nextFreeNo = async (no) => {
  const head = no.slice(0, no.lastIndexOf("/") + 1);
  const used = await BooksRecord.find({ kind: "invoice", deleted: false, "data.no": { $regex: `^${escapeRe(head)}` } }, { "data.no": 1 }).lean();
  const max = used.reduce((m, r) => Math.max(m, Number(String(r.data.no).slice(head.length)) || 0), 0);
  return head + String(max + 1).padStart(3, "0");
};

const apply = async (c, email) => {
  if (!c || !ID_RE.test(String(c.id)) || !KINDS.has(c.kind)) throw createHttpError(400, "Bad record.");
  if (c.kind === "settings" && c.id !== "firm") throw createHttpError(400, "Bad settings record.");
  const data = c.data && typeof c.data === "object" && !Array.isArray(c.data) ? c.data : {};
  if (JSON.stringify(data).length > 200_000) throw createHttpError(413, "Record too large.");
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await BooksRecord.findOneAndUpdate(
        { _id: String(c.id), kind: c.kind },
        { $set: { data, deleted: !!c.deleted, by: email, updatedAt: new Date() } },
        { upsert: true, new: true }
      ).lean();
      return plain(r);
    } catch (err) {
      if (err?.code !== 11000 || attempt > 3) throw err;
      if (c.kind !== "invoice" || !data.no || err?.keyPattern?._id) throw createHttpError(409, "Record id clash.");
      data.no = await nextFreeNo(String(data.no));
    }
  }
};

router.post("/sync", requireUser, async (req, res, next) => {
  try {
    const changes = Array.isArray(req.body?.changes) ? req.body.changes.slice(0, 500) : [];
    const applied = [];
    for (const c of changes) applied.push(await apply(c, req.booksUser));
    const since = Number(req.body?.since) || 0;
    const now = Date.now();
    // A 5-second overlap so a save landing in the same instant is never missed; repeats are harmless.
    const filter = since ? { updatedAt: { $gte: new Date(since - 5000) } } : {};
    const records = (await BooksRecord.find(filter).lean()).map(plain);
    // Sessions slide: a token older than a week is swapped for a fresh one.
    const c = req.booksClaims;
    const renewed = c.iat * 1000 < now - 7 * 86400_000 ? issue(c.sub, c.name).token : undefined;
    res.json({ now, applied, records, token: renewed });
  } catch (err) {
    next(err);
  }
});

// ---- access list (Settings) ---------------------------------------------

router.get("/access", requireUser, async (_req, res, next) => {
  try {
    res.json({ allowedUsers: await allowedUsers() });
  } catch (err) {
    next(err);
  }
});

router.put("/access", requireUser, async (req, res, next) => {
  try {
    const list = [...new Set((Array.isArray(req.body?.allowedUsers) ? req.body.allowedUsers : []).map(normEmail))]
      .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (!list.includes(req.booksUser)) return next(createHttpError(400, "You cannot remove yourself."));
    await BooksConfig.updateOne({ _id: "access" }, { $set: { allowedUsers: list } }, { upsert: true });
    accessCache = { at: 0, list: [] };
    res.json({ allowedUsers: list });
  } catch (err) {
    next(err);
  }
});

// ---- bill photos / PDFs -------------------------------------------------

router.post("/files", requireUser, express.raw({ type: "application/octet-stream", limit: "12mb" }), async (req, res, next) => {
  try {
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    const mime = sniffMime(buf);
    if (!mime) return next(createHttpError(415, "Only photos (JPG, PNG, WebP, HEIC) and PDFs."));
    const name = `${crypto.randomBytes(16).toString("hex")}.${ALLOWED_MIME.get(mime)}`;
    await fs.promises.mkdir(FILES_DIR, { recursive: true });
    await fs.promises.writeFile(path.join(FILES_DIR, name), buf);
    res.status(201).json({ id: name, type: mime, size: buf.length });
  } catch (err) {
    next(err);
  }
});

router.get("/files/:id", requireUser, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    if (!FILE_RE.test(id)) return next(createHttpError(404, "Not found"));
    const file = path.join(FILES_DIR, id);
    const buf = await fs.promises.readFile(file).catch(() => null);
    if (!buf) return next(createHttpError(404, "Not found"));
    res.setHeader("Content-Type", sniffMime(buf) || "application/octet-stream");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Security-Policy", "default-src 'none'");
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
