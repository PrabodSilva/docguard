// All the privacy/security building blocks live in this one file.
const crypto = require('crypto');
const config = require('./config');

// ---------- Field encryption (AES-256-GCM) ----------
// Every sensitive value gets its own random IV. The owner's user id is used
// as "associated data", so a value copied into another user's row won't decrypt.
function encrypt(plain, userId) {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.dataKey, iv);
  cipher.setAAD(Buffer.from(String(userId)));
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

function decrypt(blob, userId) {
  if (!blob) return '';
  const [v, iv, tag, ct] = blob.split(':');
  if (v !== 'v1') throw new Error('Unknown encryption version');
  const decipher = crypto.createDecipheriv('aes-256-gcm', config.dataKey, Buffer.from(iv, 'base64'));
  decipher.setAAD(Buffer.from(String(userId)));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}

// Show only the last 4 characters: "N1234567" -> "••••4567"
function mask(value) {
  if (!value) return '';
  const s = String(value).replace(/\s/g, '');
  return s.length <= 4 ? '••••' : '••••' + s.slice(-4);
}

// ---------- Password hashing (scrypt, built into Node) ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [algo, salt, hash] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

// ---------- Tokens ----------
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
// We store only a keyed hash of session tokens / SMS codes, never the raw value.
const hashToken = (token) => crypto.createHmac('sha256', config.sessionSecret).update(String(token)).digest('hex');
const sixDigitCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

// ---------- Simple in-memory rate limiter ----------
function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const key = req.ip + ':' + req.path;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset < now) entry = { count: 0, reset: now + windowMs };
    entry.count += 1;
    hits.set(key, entry);
    if (entry.count > max) {
      res.set('Retry-After', Math.ceil((entry.reset - now) / 1000));
      return res.status(429).json({ error: message || 'Too many attempts. Please wait and try again.' });
    }
    next();
  };
}

module.exports = { encrypt, decrypt, mask, hashPassword, verifyPassword, randomToken, hashToken, sixDigitCode, rateLimit };