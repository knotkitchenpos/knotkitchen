const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const apiRoutes = require('./routes/api');
const { requireAuth } = require('./middleware/auth');
const { allowServiceToken } = require('./middleware/serviceAuth');

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false, // the SPA relies on inline styles/scripts; CSP tightened separately if needed
}));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // same-origin / curl / server-to-server
    // No allow-list trusts every origin only in development; in production it
    // fails closed (security audit, 2026-11-03).
    const open = allowedOrigins.length === 0 && process.env.NODE_ENV !== 'production';
    if (open || allowedOrigins.includes(origin.replace(/\/$/, ''))) {
      return callback(null, true);
    }
    // Not ours: no CORS headers, so the browser keeps the reply from it (not a 500).
    return callback(null, false);
  },
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

const UPLOADS_DIR = process.env.ONBOARD_UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Mount REST API routes
app.use('/api', apiRoutes);

// Serve uploaded documents folder — these are PII/KYC documents (PAN, FSSAI, etc.),
// never expose them without a valid session.
//
// allowServiceToken additionally accepts the KnotKitchen CSD service token, so
// that store creation can copy an agreement's documents into the new store.
// A caller with neither a token nor a session still falls through to
// requireAuth and is rejected exactly as before.
app.use('/uploads', allowServiceToken(requireAuth), express.static(UPLOADS_DIR));

// Serve Frontend static assets from public/
app.use(express.static(path.join(__dirname, '..', 'public')));

// Fallback to index.html for Single Page Application
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`KnotKitchen Full-Stack Server running at http://localhost:${PORT}`));
}

module.exports = app;
