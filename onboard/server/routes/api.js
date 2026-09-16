const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { issueSessionCookie, requireAuth, requireAdmin, COOKIE_NAME } = require('../middleware/auth');
const { allowServiceToken } = require('../middleware/serviceAuth');

const router = express.Router();
const DB_PATH = path.join(__dirname, '..', 'data', 'database.json');
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/; // agreement ids / file keys — no path separators
const SAFE_USERNAME = /^[a-zA-Z0-9._-]{3,40}$/;

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
  const db = readDb();
  const agId = agreement.id;
  const agFolder = path.join(UPLOADS_DIR, agId);
  if (!fs.existsSync(agFolder)) fs.mkdirSync(agFolder, { recursive: true });

  const filesObj = agreement.files || {};
  const processedFiles = {};

  for (const [key, fileData] of Object.entries(filesObj)) {
    if (!SAFE_ID.test(key)) continue; // reject keys that could traverse the filesystem
    if (fileData && fileData.dataUrl) {
      try {
        const matches = fileData.dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const ext = (fileData.name ? path.extname(fileData.name) : '.bin').replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10) || '.bin';
          const fileName = `${key}${ext}`;
          fs.writeFileSync(path.join(agFolder, fileName), Buffer.from(matches[2], 'base64'));
          // Store only the reference — never the raw base64 blob — in the JSON DB.
          processedFiles[key] = { name: fileData.name || fileName, url: `/uploads/${agId}/${fileName}` };
        }
      } catch (e) {
        console.error('Error saving upload:', e);
      }
    } else if (fileData && fileData.url) {
      // Existing file kept as-is (no new upload for this key).
      processedFiles[key] = { name: fileData.name, url: fileData.url };
    }
  }

  db.agreements[agId] = {
    id: agId,
    r_name: agreement.r_name || (agreement.data ? agreement.data.r_display || agreement.data.r_name : '—'),
    o_name: agreement.o_name || (agreement.data ? agreement.data.o_name : '—'),
    sales_agent: agreement.sales_agent || (agreement.data ? agreement.data.sales_agent : '—'),
    created_at: agreement.created_at || new Date().toLocaleDateString('en-IN'),
    status: agreement.status || 'Draft',
    data: agreement.data || {},
    files: processedFiles,
    agreement_text: agreement.agreement_text || '',
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
