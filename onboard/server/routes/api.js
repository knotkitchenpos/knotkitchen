const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { issueSessionCookie, requireAuth, requireAdmin, COOKIE_NAME } = require('../middleware/auth');
const { allowServiceToken } = require('../middleware/serviceAuth');

const router = express.Router();
// Overridable so the tests run against a scratch database and upload folder.
const DB_PATH = process.env.ONBOARD_DB_PATH || path.join(__dirname, '..', 'data', 'database.json');
const UPLOADS_DIR = process.env.ONBOARD_UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/; // agreement ids / file keys — no path separators
const SAFE_USERNAME = /^[a-zA-Z0-9._-]{3,40}$/;
const SAFE_FILE_NAME = /^[A-Za-z0-9_.-]{1,100}$/;

// The statuses the portal's own saves send (saveAgreementToDb in index.html).
// "Store Created" is set only by the store-created route below; "Completed"
// by nobody any more.
const CLIENT_STATUSES = ['Draft', 'eSigned', 'Submitted'];
const SUBMITTED_STATUSES = ['submitted', 'store created', 'completed', 'signed', 'complete'];
const SIGNATURE_METHODS = ['handwritten-scanned', 'aadhaar-esign', 'dsc'];
const DEFAULT_SIGNATURE_METHOD = 'handwritten-scanned';
// The five acceptance statements ticked on the portal's final step.
const ACCEPTANCE_KEYS = ['accept_accurate', 'accept_authorised', 'accept_terms', 'accept_wallet', 'accept_signed'];
// The only agreement version a new submission may carry. Must match
// window.AGREEMENT_VERSION in public/js/agreement_v3.js.
const CURRENT_AGREEMENT_VERSION = 'v3.0';
const VERSION_LINE = /\*\*Agreement Version:\*\*\s*(v[\d.]+)/;

// The version label in the text; the payload's own label only when the text has none.
const versionOf = (text, payloadVersion) =>
  (String(text || '').match(VERSION_LINE) || [])[1] ||
  (/^v\d+(\.\d+)*$/.test(String(payloadVersion || '')) ? String(payloadVersion) : '');
const isSubmittedRecord = (ag) => Boolean(ag && (
  (ag.acceptance && ag.acceptance.submittedAt) ||
  SUBMITTED_STATUSES.includes(String(ag.status || '').toLowerCase())
));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const DATA_URL = /^data:([A-Za-z-+\/.]+);base64,(.+)$/;

function readDb() {
  try {
    if (fs.existsSync(DB_PATH)) return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {
    console.error('Error reading DB:', e);
  }
  const bootstrapUser = process.env.ADMIN_USERNAME;
  const bootstrapPass = process.env.ADMIN_PASSWORD;
  if (!bootstrapUser || !bootstrapPass) {
    throw new Error('[FATAL] No database found and ADMIN_USERNAME/ADMIN_PASSWORD are not set to bootstrap one.');
  }
  return {
    agents: [
      { username: bootstrapUser, password: bcrypt.hashSync(bootstrapPass, 12), name: 'System Admin', role: 'admin', enabled: true }
    ],
    agreements: {}
  };
}

function writeDb(db) {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing DB:', e);
  }
}

// One-time migration: any plaintext password (anything not already a bcrypt hash)
// is hashed in place the first time the DB is loaded after this fix is deployed.
function migratePlaintextPasswords(db) {
  let changed = false;
  for (const agent of db.agents || []) {
    if (typeof agent.password === 'string' && !/^\$2[aby]\$/.test(agent.password)) {
      agent.password = bcrypt.hashSync(agent.password, 12);
      changed = true;
    }
  }
  if (changed) writeDb(db);
  return db;
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Try again later.' },
});

router.get('/health', (req, res) => res.json({ status: 'ok', server: 'KnotKitchen REST API' }));

router.post('/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Provide credentials' });
  const db = migratePlaintextPasswords(readDb());
  const user = db.agents.find(a => a.username.toLowerCase() === String(username).trim().toLowerCase());
  if (!user || !bcrypt.compareSync(String(password).trim(), user.password)) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
  if (!user.enabled) return res.status(403).json({ success: false, message: 'Account disabled' });
  issueSessionCookie(res, user);
  res.json({ success: true, user: { username: user.username, name: user.name, role: user.role } });
});

router.post('/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ success: true });
});

router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

/* -------------------------------------------------------------------------
 * Service-accessible endpoints (KnotKitchen CSD).
 *
 * Mounted ABOVE the blanket `router.use(requireAuth)` on purpose. Express
 * matches in definition order, so declaring them here scopes the service
 * token to exactly these three routes. Putting them below — or widening the
 * blanket guard itself — would let the same token reach agent CRUD and the
 * agreement/file DELETE endpoints, which it has no business touching.
 *
 * allowServiceToken falls through to requireAuth when no valid token is
 * present, so a logged-in sales agent still reaches these exactly as before.
 * ---------------------------------------------------------------------- */

router.get('/agreements', allowServiceToken(requireAuth), (req, res) =>
  res.json({ success: true, agreements: readDb().agreements })
);

router.get('/agreements/:id', allowServiceToken(requireAuth), (req, res) => {
  if (!SAFE_ID.test(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid agreement id' });
  const db = readDb();
  const ag = db.agreements[req.params.id];
  if (!ag) return res.status(404).json({ success: false, message: 'Agreement not found' });
  res.json({ success: true, agreement: ag });
});

/**
 * CSD tells us a store now exists for this agreement.
 *
 * Idempotent: CSD treats a failure here as non-fatal and offers a "Sync
 * portal" retry, so re-marking an agreement that is already "Store Created"
 * must succeed rather than error.
 */
router.post('/agreements/:id/store-created', allowServiceToken(requireAuth), (req, res) => {
  if (!SAFE_ID.test(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid agreement id' });
  const db = readDb();
  const ag = db.agreements[req.params.id];
  if (!ag) return res.status(404).json({ success: false, message: 'Agreement not found' });

  const { storeId, storeCreatedAt, by } = req.body || {};
  ag.status = 'Store Created';
  if (storeId) ag.storeId = String(storeId).slice(0, 40);
  if (storeCreatedAt) ag.storeCreatedAt = String(storeCreatedAt).slice(0, 40);
  if (by) ag.storeCreatedBy = String(by).slice(0, 120);
  writeDb(db);

  res.json({ success: true, agreement: ag });
});

// Everything below requires a valid session.
router.use(requireAuth);

router.get('/agents', (req, res) => {
  const db = readDb();
  res.json({ success: true, agents: db.agents.map(a => ({ username: a.username, name: a.name, role: a.role, enabled: a.enabled })) });
});

router.post('/agents', requireAdmin, (req, res) => {
  const { name, username, password, enabled } = req.body;
  if (!name || !username || !password) return res.status(400).json({ success: false, message: 'Fields missing' });
  if (!SAFE_USERNAME.test(String(username).trim())) {
    return res.status(400).json({ success: false, message: 'Username must be 3-40 chars: letters, numbers, dot, underscore, hyphen' });
  }
  if (String(password).trim().length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
  }
  const db = readDb();
  if (db.agents.some(a => a.username.toLowerCase() === username.trim().toLowerCase())) {
    return res.status(400).json({ success: false, message: 'Username exists' });
  }
  const newAgent = {
    username: username.trim(),
    password: bcrypt.hashSync(password.trim(), 12),
    name: String(name).trim().slice(0, 100),
    role: 'agent',
    enabled: enabled !== false,
  };
  db.agents.push(newAgent);
  writeDb(db);
  res.json({ success: true, agent: { username: newAgent.username, name: newAgent.name, role: newAgent.role, enabled: newAgent.enabled }, agents: db.agents.map(a => ({ username: a.username, name: a.name, role: a.role, enabled: a.enabled })) });
});

router.put('/agents/:username', requireAdmin, (req, res) => {
  const db = readDb();
  const idx = db.agents.findIndex(a => a.username.toLowerCase() === req.params.username.toLowerCase());
  if (idx === -1) return res.status(404).json({ success: false, message: 'Agent not found' });
  const { name, username, password, enabled } = req.body;
  if (username && !SAFE_USERNAME.test(String(username).trim())) {
    return res.status(400).json({ success: false, message: 'Invalid username format' });
  }
  if (password && String(password).trim().length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
  }
  // An old copy of the page pre-filled the edit form with the text "undefined"
  // and sent it back as the new password on every save.
  if (password && ['undefined', 'null'].includes(String(password).trim())) {
    return res.status(400).json({ success: false, message: 'Leave the password blank to keep it, or type a new one.' });
  }
  db.agents[idx] = {
    ...db.agents[idx],
    name: name ? String(name).trim().slice(0, 100) : db.agents[idx].name,
    username: username ? username.trim() : db.agents[idx].username,
    password: password ? bcrypt.hashSync(password.trim(), 12) : db.agents[idx].password,
    enabled: enabled !== undefined ? enabled : db.agents[idx].enabled,
  };
  writeDb(db);
  const a = db.agents[idx];
  res.json({ success: true, agent: { username: a.username, name: a.name, role: a.role, enabled: a.enabled }, agents: db.agents.map(x => ({ username: x.username, name: x.name, role: x.role, enabled: x.enabled })) });
});

router.patch('/agents/:username/toggle', requireAdmin, (req, res) => {
  const db = readDb();
  const idx = db.agents.findIndex(a => a.username.toLowerCase() === req.params.username.toLowerCase());
  if (idx === -1) return res.status(404).json({ success: false, message: 'Agent not found' });
  db.agents[idx].enabled = !db.agents[idx].enabled;
  writeDb(db);
  const a = db.agents[idx];
  res.json({ success: true, agent: { username: a.username, name: a.name, role: a.role, enabled: a.enabled }, agents: db.agents.map(x => ({ username: x.username, name: x.name, role: x.role, enabled: x.enabled })) });
});

router.delete('/agents/:username', requireAdmin, (req, res) => {
  const db = readDb();
  const username = req.params.username.toLowerCase();
  if (username === 'admin') {
    return res.status(400).json({ success: false, message: 'Cannot delete admin account' });
  }
  const idx = db.agents.findIndex(a => a.username.toLowerCase() === username);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Agent not found' });
  db.agents.splice(idx, 1);
  writeDb(db);
  res.json({ success: true, agents: db.agents.map(a => ({ username: a.username, name: a.name, role: a.role, enabled: a.enabled })) });
});

router.post('/agreements/next-id', (req, res) => {
  const now = new Date();
  const dateStr = now.getFullYear().toString() + (now.getMonth() + 1).toString().padStart(2, '0') + now.getDate().toString().padStart(2, '0');
  const prefix = `KK-AGR-${dateStr}-`;
  const db = readDb();
  let counter = 1001;
  let candidate = prefix + counter;
  while (db.agreements[candidate]) { counter++; candidate = prefix + counter; }
  res.json({ success: true, agreementId: candidate });
});

// NOTE: GET /agreements and GET /agreements/:id now live above the blanket
// requireAuth, so that a CSD service token can reach them. Behaviour for a
// logged-in agent is unchanged.

router.post('/agreements', (req, res) => {
  const agreement = req.body;
  if (!agreement || !agreement.id || !SAFE_ID.test(agreement.id)) {
    return res.status(400).json({ success: false, message: 'Invalid data' });
  }
  const status = agreement.status === undefined || agreement.status === '' ? 'Draft' : agreement.status;
  if (!CLIENT_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, code: 'STATUS_NOT_ALLOWED', message: `Status "${String(status).slice(0, 40)}" cannot be set here.` });
  }
  const data = agreement.data && typeof agreement.data === 'object' ? agreement.data : {};
  const signMethod = data.sign_method === undefined || data.sign_method === '' ? DEFAULT_SIGNATURE_METHOD : data.sign_method;
  if (!SIGNATURE_METHODS.includes(signMethod)) {
    return res.status(400).json({ success: false, code: 'SIGN_METHOD_INVALID', message: 'Unknown signature method.' });
  }

  const db = readDb();
  const agId = agreement.id;
  const previous = db.agreements[agId] || {};
  const filesObj = agreement.files && typeof agreement.files === 'object' ? agreement.files : {};
  const text = agreement.agreement_text || '';

  // Once submitted, what was signed stays as it was: a sales agent can no
  // longer change the text, the form data or the signed copy (an admin can).
  const locked = isSubmittedRecord(previous);
  const isAdmin = Boolean(req.user && req.user.role === 'admin');
  if (locked && !isAdmin) {
    const incoming = filesObj.esigned;
    const kept = previous.files && previous.files.esigned;
    // A key left out of the payload keeps the stored file (see below).
    let esignedSame = !('esigned' in filesObj);
    if (incoming && kept) {
      if (incoming.dataUrl) {
        const m = String(incoming.dataUrl).match(DATA_URL);
        let keptHash = previous.acceptance && previous.acceptance.signedCopyHash;
        if (!keptHash) {
          try { keptHash = sha256(fs.readFileSync(path.join(UPLOADS_DIR, agId, path.basename(kept.url)))); } catch (e) { keptHash = ''; }
        }
        esignedSame = Boolean(m && keptHash && sha256(Buffer.from(m[2], 'base64')) === keptHash);
      } else {
        esignedSame = incoming.url === kept.url;
      }
    }
    const changed = [];
    if (text !== (previous.agreement_text || '')) changed.push('agreement text');
    if (JSON.stringify(data) !== JSON.stringify(previous.data || {})) changed.push('details');
    if (!esignedSame) changed.push('signed copy');
    if (changed.length) {
      return res.status(409).json({ success: false, code: 'AGREEMENT_LOCKED', message: `This agreement was already submitted, so its ${changed.join(', ')} can no longer be changed. Ask an admin.` });
    }
  }

  const submitting = status === 'Submitted' && !locked;
  if (submitting) {
    const e = filesObj.esigned;
    if (!e || !(e.dataUrl || e.url)) {
      return res.status(400).json({ success: false, code: 'ESIGNED_REQUIRED', message: 'Upload the signed agreement before submitting.' });
    }
    const missing = ACCEPTANCE_KEYS.filter(k => data[k] !== true);
    if (missing.length) {
      return res.status(400).json({ success: false, code: 'ACCEPTANCE_REQUIRED', message: 'Tick all the acceptance statements before submitting.', missing });
    }
    if (versionOf(text, agreement.agreement_version) !== CURRENT_AGREEMENT_VERSION) {
      return res.status(400).json({ success: false, code: 'AGREEMENT_OUTDATED', message: `This agreement is not the current version (${CURRENT_AGREEMENT_VERSION}). Open the Agreement step to regenerate it, then download, sign and upload it again.` });
    }
    // The signed copy was uploaded against exactly this text.
    if (sha256(text) !== String(agreement.esigned_text_hash || '')) {
      return res.status(400).json({ success: false, code: 'SIGNED_TEXT_MISMATCH', message: 'The agreement changed after it was signed. Download the new version and upload the new signed copy.' });
    }
  }

  const agFolder = path.join(UPLOADS_DIR, agId);
  if (!fs.existsSync(agFolder)) fs.mkdirSync(agFolder, { recursive: true });
  // Files left out of the payload are kept; only an explicit null removes one,
  // so a save never has to carry every file again.
  const processedFiles = {};
  for (const [key, kept] of Object.entries(previous.files || {})) {
    if (!(key in filesObj)) processedFiles[key] = kept;
  }
  const nowIso = new Date().toISOString();
  let replacedSigned = null; // what an admin's replacement of a submitted signed copy replaced

  for (const [key, fileData] of Object.entries(filesObj)) {
    if (!SAFE_ID.test(key)) continue; // reject keys that could traverse the filesystem
    if (key === 'esigned' && locked && !isAdmin) {
      // Checked unchanged above; never rewritten.
      if (previous.files && previous.files.esigned) processedFiles.esigned = previous.files.esigned;
      continue;
    }
    if (fileData && fileData.dataUrl) {
      try {
        const matches = String(fileData.dataUrl).match(DATA_URL);
        if (matches && matches.length === 3) {
          const ext = (fileData.name ? path.extname(String(fileData.name)) : '.bin').replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10) || '.bin';
          const fileName = `${key}${ext}`;
          const bytes = Buffer.from(matches[2], 'base64');
          const old = key === 'esigned' && locked && previous.files && previous.files.esigned;
          if (old) {
            // An admin replacing submitted evidence: the old copy is kept under a
            // timestamped name and recorded in acceptance.history below.
            const oldPath = path.join(agFolder, path.basename(String(old.url)));
            let oldHash = (previous.acceptance && previous.acceptance.signedCopyHash) || '';
            try { if (!oldHash) oldHash = sha256(fs.readFileSync(oldPath)); } catch (e) { /* file already gone */ }
            if (oldHash && sha256(bytes) === oldHash) { processedFiles.esigned = old; continue; }
            let keptUrl = '';
            if (fs.existsSync(oldPath)) {
              const keptName = `esigned-${nowIso.replace(/[-:.]/g, '')}${path.extname(oldPath)}`;
              fs.renameSync(oldPath, path.join(agFolder, keptName));
              keptUrl = `/uploads/${agId}/${keptName}`;
            }
            replacedSigned = { name: old.name || '', url: keptUrl, hash: oldHash };
          }
          fs.writeFileSync(path.join(agFolder, fileName), bytes);
          // Store only the reference — never the raw base64 blob — in the JSON DB.
          processedFiles[key] = { name: String(fileData.name || fileName).slice(0, 200), url: `/uploads/${agId}/${fileName}` };
        }
      } catch (e) {
        console.error('Error saving upload:', e);
      }
    } else if (fileData && fileData.url) {
      // Existing file kept (no new upload for this key). Only ever a file in
      // this agreement's own folder.
      const base = path.basename(String(fileData.url));
      if (SAFE_FILE_NAME.test(base) && String(fileData.url) === `/uploads/${agId}/${base}` && fs.existsSync(path.join(agFolder, base))) {
        processedFiles[key] = { name: String(fileData.name || base).slice(0, 200), url: `/uploads/${agId}/${base}` };
      }
    }
  }

  if (submitting && !processedFiles.esigned) {
    return res.status(400).json({ success: false, code: 'ESIGNED_REQUIRED', message: 'The signed agreement could not be stored. Upload it again.' });
  }

  const signedCopyHash = () => {
    try {
      return sha256(fs.readFileSync(path.join(UPLOADS_DIR, agId, path.basename(processedFiles.esigned.url))));
    } catch (e) { return ''; }
  };

  // The acceptance record: what was accepted, when, from where and how it was
  // signed. Kept from the first submission and never overwritten by a later
  // save. An admin's later change of the signed copy or the text is appended
  // to acceptance.history with the values it replaced.
  const acceptance = previous.acceptance || {};
  if (submitting && !acceptance.submittedAt) {
    Object.assign(acceptance, {
      submittedAt: nowIso,
      submittedAtIst: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }),
      agreementVersion: versionOf(text, agreement.agreement_version),
      agreementHash: sha256(text),
      signedCopyHash: signedCopyHash(),
      ip: req.ip || '',
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      agent: req.user ? { username: req.user.username, name: req.user.name } : null,
      signatory: { name: data.o_name || '', designation: data.o_designation || '', entityType: data.b_type || '' },
      signatureMethod: signMethod,
    });
  } else if (locked && isAdmin && acceptance.submittedAt && (replacedSigned || sha256(text) !== acceptance.agreementHash)) {
    acceptance.history = Array.isArray(acceptance.history) ? acceptance.history : [];
    acceptance.history.push({
      at: nowIso,
      by: req.user ? { username: req.user.username, name: req.user.name } : null,
      previousAgreementHash: acceptance.agreementHash || '',
      previousSignedCopyHash: acceptance.signedCopyHash || '',
      previousSignedCopy: replacedSigned, // { name, url, hash } of the kept file; null when only the text changed
    });
    acceptance.agreementHash = sha256(text);
    if (replacedSigned) acceptance.signedCopyHash = signedCopyHash();
  }

  // Spread the previous record first, so fields set elsewhere (storeId and the
  // rest from store-created) survive a later save.
  db.agreements[agId] = {
    ...previous,
    id: agId,
    r_name: agreement.r_name || data.r_display || data.r_name || '—',
    o_name: agreement.o_name || data.o_name || '—',
    sales_agent: agreement.sales_agent || data.sales_agent || '—',
    created_at: agreement.created_at || previous.created_at || new Date().toLocaleDateString('en-IN'),
    // A submitted agreement never goes back to Draft / eSigned, and keeps
    // "Store Created" once CSD has set it.
    status: locked ? previous.status : status,
    data,
    files: processedFiles,
    agreement_text: text,
    acceptance,
  };
  writeDb(db);
  res.json({ success: true, agreement: db.agreements[agId] });
});

router.delete('/agreements/:id', (req, res) => {
  if (!SAFE_ID.test(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid agreement id' });
  const db = readDb();
  const agId = req.params.id;
  if (!db.agreements[agId]) {
    return res.status(404).json({ success: false, message: 'Agreement not found' });
  }
  if (isSubmittedRecord(db.agreements[agId]) && !(req.user && req.user.role === 'admin')) {
    return res.status(403).json({ success: false, code: 'AGREEMENT_LOCKED', message: 'A submitted agreement can only be deleted by an admin.' });
  }

  try {
    const agFolder = path.join(UPLOADS_DIR, agId);
    if (fs.existsSync(agFolder)) {
      fs.rmSync(agFolder, { recursive: true, force: true });
    }
  } catch (e) {
    console.error('Error removing agreement folder:', e);
  }

  delete db.agreements[agId];
  writeDb(db);
  res.json({ success: true, message: 'Agreement deleted successfully' });
});

router.delete('/agreements/:id/files/:fileKey', (req, res) => {
  if (!SAFE_ID.test(req.params.id) || !SAFE_ID.test(req.params.fileKey)) {
    return res.status(400).json({ success: false, message: 'Invalid identifier' });
  }
  const db = readDb();
  const agId = req.params.id;
  const fileKey = req.params.fileKey;

  if (!db.agreements[agId]) {
    return res.status(404).json({ success: false, message: 'Agreement not found' });
  }

  const ag = db.agreements[agId];
  if (fileKey === 'esigned' && isSubmittedRecord(ag) && !(req.user && req.user.role === 'admin')) {
    return res.status(403).json({ success: false, code: 'AGREEMENT_LOCKED', message: 'The signed copy of a submitted agreement can only be removed by an admin.' });
  }
  if (ag.files && ag.files[fileKey]) {
    const fileObj = ag.files[fileKey];
    if (fileObj.url) {
      try {
        const filePath = path.join(UPLOADS_DIR, agId, path.basename(fileObj.url));
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (e) {
        console.error('Error deleting file:', e);
      }
    }
    delete ag.files[fileKey];
    writeDb(db);
    return res.json({ success: true, agreement: ag });
  }

  res.status(404).json({ success: false, message: 'Document not found' });
});

module.exports = router;
