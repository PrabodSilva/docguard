// SQLite database. The file is created automatically on first run.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite'); // built into Node.js 22.13+ (nothing to install)
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
try { fs.chmodSync(config.dbFile, 0o600); } catch { /* Windows ignores this */ }

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  phone_enc       TEXT,             -- encrypted full phone number
  phone_last4     TEXT,
  phone_verified  INTEGER NOT NULL DEFAULT 0,
  phone_code_hash TEXT,
  phone_code_expires INTEGER,
  phone_code_tries INTEGER NOT NULL DEFAULT 0,
  sms_enabled     INTEGER NOT NULL DEFAULT 1,
  remind_days     TEXT NOT NULL DEFAULT '90,30,7,1',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  title         TEXT NOT NULL,
  holder_enc    TEXT,          -- encrypted: name on the document
  number_enc    TEXT,          -- encrypted: document number
  number_masked TEXT,          -- e.g. ••••4567 (safe to show in lists)
  issuer_enc    TEXT,          -- encrypted: issuing authority / company
  notes_enc     TEXT,          -- encrypted: free-text notes
  issue_date    TEXT,          -- YYYY-MM-DD
  expiry_date   TEXT NOT NULL, -- YYYY-MM-DD
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);

CREATE TABLE IF NOT EXISTS reminders_sent (
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  expiry_date TEXT NOT NULL,
  threshold   INTEGER NOT NULL,
  sent_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (document_id, expiry_date, threshold)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action  TEXT NOT NULL,
  detail  TEXT,
  at      TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function logActivity(userId, action, detail = null) {
  db.prepare('INSERT INTO activity_log (user_id, action, detail) VALUES (?, ?, ?)').run(userId, action, detail);
  // keep only the latest 200 entries per user
  db.prepare(`DELETE FROM activity_log WHERE user_id = ? AND id NOT IN
    (SELECT id FROM activity_log WHERE user_id = ? ORDER BY id DESC LIMIT 200)`).run(userId, userId);
}

module.exports = { db, logActivity };