#!/usr/bin/env node
/**
 * Reset a portal user's password from the server's own terminal.
 *
 *   docker exec -it knotkitchen-onboard-portal-1 node server/reset-password.js <username>
 *
 * The password is typed at a hidden prompt, twice, by whoever runs this. It
 * never appears on screen, in shell history, in a command line or in a log,
 * and only its bcrypt hash is written. There is no way to pass it as an
 * argument on purpose.
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'data', 'database.json');

/** Set the hash for `username` in the JSON DB at `dbPath`. Returns the stored username. */
function setPassword(dbPath, username, password) {
  const clean = String(password || '').trim();
  if (clean.length < 8) throw new Error('Password must be at least 8 characters.');
  if (!fs.existsSync(dbPath)) throw new Error(`No account file at ${dbPath}.`);
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const agent = (db.agents || []).find((a) => a.username.toLowerCase() === String(username).trim().toLowerCase());
  if (!agent) {
    throw new Error(`No user "${username}". Users: ${(db.agents || []).map((a) => a.username).join(', ') || 'none'}`);
  }
  agent.password = bcrypt.hashSync(clean, 12);
  agent.enabled = true;
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
  return agent.username;
}

/** Read one line from the terminal without echoing it. */
function hidden(prompt) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return reject(new Error('Run this in a terminal (docker exec -it ...), so the password can be typed hidden.'));
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          return resolve(value);
        }
        if (ch === '') { stdin.setRawMode(false); stdout.write('\n'); process.exit(130); } // Ctrl+C
        if (ch === '' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const username = process.argv[2];
  if (!username || process.argv.length > 3) {
    console.error('Usage: node server/reset-password.js <username>   (the password is asked for, never passed)');
    process.exit(2);
  }
  const first = await hidden(`New password for ${username} (8+ characters, hidden): `);
  const second = await hidden('Type it again: ');
  if (first !== second) throw new Error('The two entries did not match. Nothing was changed.');
  const who = setPassword(DB_PATH, username, first);
  console.log(`Password updated for ${who}. Sign in at the portal with it now.`);
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { setPassword };
