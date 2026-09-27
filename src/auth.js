// Accounts, login sessions, phone verification and account settings.
const express = require('express');
const config = require('./config');
const { db, logActivity } = require('./db');
const sec = require('./security');
const { sendSMS, normalizePhone, maskPhone } = require('./sms');

const router = express.Router();
const COOKIE = 'dg_session';

// ---------- helpers ----------
function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((c) => c.trim().split('=')).filter(([k, v]) => k && v).map(([k, v]) => [k, decodeURIComponent(v)])
  );
}

function startSession(res, userId) {
  const token = sec.randomToken();
  const expires = Date.now() + config.sessionDays * 86400000;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sec.hashToken(token), userId, expires);
  res.cookie(COOKIE, token, {
    httpOnly: true,          // JavaScript in the page can't read it
    sameSite: 'strict',      // blocks cross-site request forgery
    secure: config.secureCookies,
    maxAge: config.sessionDays * 86400000,
    path: '/',
  });
}

function requireAuth(req, res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return res.status(401).json({ error: 'Please log in.' });
  const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sec.hashToken(token));
  if (!row || row.expires_at < Date.now()) {
    if (row) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
  req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  req.sessionHash = row.token_hash;
  if (!req.user) return res.status(401).json({ error: 'Please log in.' });
  next();
}

// Re-check the password before sensitive actions (reveal number, PDF, delete account).
function confirmPassword(req, res) {
  const { password } = req.body || {};
  if (!password || !sec.verifyPassword(password, req.user.password_hash)) {
    res.status(403).json({ error: 'Incorrect password.' });
    return false;
  }
  return true;
}

function publicUser(u) {
  let phone = '';
  try { phone = u.phone_enc ? maskPhone(sec.decrypt(u.phone_enc, u.id)) : ''; } catch { /* ignore */ }
  return {
    id: u.id, name: u.name, email: u.email,
    phone, phoneVerified: !!u.phone_verified,
    smsEnabled: !!u.sms_enabled,
    remindDays: u.remind_days.split(',').map(Number),
    smsProvider: config.sms.provider,
  };
}

const emailOk = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;
const authLimiter = sec.rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many login attempts. Try again in 15 minutes.' });
const smsLimiter = sec.rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: 'Too many SMS requests. Try again later.' });

// ---------- routes ----------
router.post('/auth/register', authLimiter, (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || String(name).trim().length < 2) return res.status(400).json({ error: 'Please enter your name.' });
  if (!emailOk(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return res.status(400).json({ error: 'Password must contain letters and numbers.' });
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (exists) return res.status(409).json({ error: 'An account with this email already exists.' });
  const info = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run(String(name).trim().slice(0, 80), email.toLowerCase(), sec.hashPassword(password));
  logActivity(info.lastInsertRowid, 'Account created');
  startSession(res, info.lastInsertRowid);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)) });
});

router.post('/auth/login', authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  const user = emailOk(email) && db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  // Same message whether the email or the password is wrong, so attackers can't discover accounts.
  if (!user || !sec.verifyPassword(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').run(user.id, Date.now());
  startSession(res, user.id);
  logActivity(user.id, 'Logged in', req.ip);
  res.json({ user: publicUser(user) });
});

router.post('/auth/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

router.post('/auth/logout-all', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);
  logActivity(req.user.id, 'Logged out of all devices');
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

router.get('/session', (req, res) => {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  const row = token && db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?').get(sec.hashToken(token), Date.now());
  const user = row && db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  res.json({ user: user ? publicUser(user) : null });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

router.put('/me/settings', requireAuth, (req, res) => {
  const { remindDays, smsEnabled } = req.body || {};
  let days = Array.isArray(remindDays) ? remindDays.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 365) : null;
  if (!days || !days.length) return res.status(400).json({ error: 'Choose at least one reminder day.' });
  days = [...new Set(days)].sort((a, b) => b - a).slice(0, 8);
  db.prepare('UPDATE users SET remind_days = ?, sms_enabled = ? WHERE id = ?').run(days.join(','), smsEnabled ? 1 : 0, req.user.id);
  logActivity(req.user.id, 'Reminder settings changed', days.join(', ') + ' days');
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

// Step 1: save the phone number (encrypted) and text a 6-digit code to it.
router.post('/me/phone', requireAuth, smsLimiter, async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!phone) return res.status(400).json({ error: 'Please enter a valid mobile number, e.g. 0771234567 or +94771234567.' });
  const code = sec.sixDigitCode();
  db.prepare(`UPDATE users SET phone_enc = ?, phone_last4 = ?, phone_verified = 0, phone_code_hash = ?,
              phone_code_expires = ?, phone_code_tries = 0 WHERE id = ?`)
    .run(sec.encrypt(phone, req.user.id), phone.slice(-4), sec.hashToken(code), Date.now() + 10 * 60000, req.user.id);
  try {
    await sendSMS(phone, `DocGuard verification code: ${code}. It expires in 10 minutes. Don't share this code with anyone.`);
  } catch (e) {
    console.error('SMS failed:', e.message);
    return res.status(502).json({ error: 'Could not send the SMS. Check the SMS settings in .env.' });
  }
  logActivity(req.user.id, 'Phone number added', maskPhone(phone));
  res.json({ ok: true, sentTo: maskPhone(phone) });
});

// Step 2: check the code.
router.post('/me/phone/verify', requireAuth, authLimiter, (req, res) => {
  const u = req.user;
  const code = String(req.body?.code || '').trim();
  if (!u.phone_code_hash || u.phone_code_expires < Date.now()) return res.status(400).json({ error: 'Code expired. Please request a new one.' });
  if (u.phone_code_tries >= 5) return res.status(429).json({ error: 'Too many wrong codes. Please request a new one.' });
  if (sec.hashToken(code) !== u.phone_code_hash) {
    db.prepare('UPDATE users SET phone_code_tries = phone_code_tries + 1 WHERE id = ?').run(u.id);
    return res.status(400).json({ error: 'That code is not correct.' });
  }
  db.prepare('UPDATE users SET phone_verified = 1, phone_code_hash = NULL, phone_code_expires = NULL WHERE id = ?').run(u.id);
  logActivity(u.id, 'Phone number verified');
  // Send any reminders that are already due, right away
  require('./reminders').runReminderCheck().catch((e) => console.error('Reminder check failed:', e.message));
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
});

router.delete('/me/phone', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET phone_enc = NULL, phone_last4 = NULL, phone_verified = 0, phone_code_hash = NULL WHERE id = ?').run(req.user.id);
  logActivity(req.user.id, 'Phone number removed');
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

router.post('/me/test-sms', requireAuth, smsLimiter, async (req, res) => {
  const u = req.user;
  if (!u.phone_verified) return res.status(400).json({ error: 'Verify your phone number first.' });
  try {
    await sendSMS(sec.decrypt(u.phone_enc, u.id), `DocGuard: test message. Your expiry reminders are working, ${u.name.split(' ')[0]}!`);
  } catch (e) {
    console.error('SMS failed:', e.message);
    return res.status(502).json({ error: 'Could not send the SMS. Check the SMS settings in .env.' });
  }
  res.json({ ok: true });
});

router.get('/me/activity', requireAuth, (req, res) => {
  res.json({ activity: db.prepare('SELECT action, detail, at FROM activity_log WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id) });
});

// Permanently delete the account and every document (right to be forgotten).
router.delete('/me', requireAuth, (req, res) => {
  if (!confirmPassword(req, res)) return;
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id); // cascades to documents, sessions, logs
  res.clearCookie(COOKIE, { path: '/' });
  console.log(`Account #${req.user.id} and all its data were deleted.`);
  res.json({ ok: true });
});

module.exports = { router, requireAuth, confirmPassword };