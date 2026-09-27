// Document add/list/edit/delete + PDF export. Every query is limited to the logged-in user.
const express = require('express');
const { db, logActivity } = require('./db');
const sec = require('./security');
const { requireAuth, confirmPassword } = require('./auth');
const { isValidISODate, statusFor } = require('./dates');
const { documentPDF, reportPDF } = require('./pdf');

const router = express.Router();
router.use(requireAuth);

const TYPES = [
  'Passport', 'National Identity Card', 'Driving Licence', 'Vehicle Revenue Licence',
  'Vehicle Insurance', 'Emission Test Certificate', 'Health Insurance', 'Life Insurance',
  'Visa', 'Work Permit', 'Professional Licence', 'Other',
];

const clean = (v, max) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));

function validate(body) {
  const d = {
    type: clean(body.type, 50),
    title: clean(body.title, 80),
    holder: clean(body.holder, 100),
    number: clean(body.number, 50),
    issuer: clean(body.issuer, 100),
    notes: clean(body.notes, 1000),
    issueDate: clean(body.issueDate, 10) || null,
    expiryDate: clean(body.expiryDate, 10),
  };
  if (!TYPES.includes(d.type)) return { error: 'Please choose a document type.' };
  if (!d.title) d.title = d.type;
  if (!isValidISODate(d.expiryDate)) return { error: 'Please enter a valid expiry date.' };
  if (d.issueDate && !isValidISODate(d.issueDate)) return { error: 'Issue date is not valid.' };
  if (d.issueDate && d.issueDate >= d.expiryDate) return { error: 'Issue date must be before the expiry date.' };
  return { d };
}

// What the list view sees: no unlocked secrets at all.
function summary(row) {
  return {
    id: row.id, type: row.type, title: row.title, numberMasked: row.number_masked,
    issueDate: row.issue_date, expiryDate: row.expiry_date, ...statusFor(row.expiry_date, row.issue_date),
  };
}

// Detail view: unlocked, but the document number stays masked unless revealed.
function detail(row, userId, { revealNumber = false } = {}) {
  return {
    ...summary(row),
    holder: sec.decrypt(row.holder_enc, userId),
    issuer: sec.decrypt(row.issuer_enc, userId),
    notes: sec.decrypt(row.notes_enc, userId),
    number: revealNumber ? sec.decrypt(row.number_enc, userId) : row.number_masked,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function findOwn(req, res) {
  const row = db.prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
  if (!row) res.status(404).json({ error: 'Document not found.' });
  return row;
}

router.get('/types', (req, res) => res.json({ types: TYPES }));

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM documents WHERE user_id = ? ORDER BY expiry_date ASC').all(req.user.id);
  res.json({ documents: rows.map(summary) });
});

router.get('/:id', (req, res) => {
  const row = findOwn(req, res);
  if (row) res.json({ document: detail(row, req.user.id) });
});

router.post('/', (req, res) => {
  const { d, error } = validate(req.body || {});
  if (error) return res.status(400).json({ error });
  const count = db.prepare('SELECT COUNT(*) n FROM documents WHERE user_id = ?').get(req.user.id).n;
  if (count >= 200) return res.status(400).json({ error: 'Document limit reached.' });
  const u = req.user.id;
  const info = db.prepare(`INSERT INTO documents (user_id, type, title, holder_enc, number_enc, number_masked, issuer_enc, notes_enc, issue_date, expiry_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(u, d.type, d.title, sec.encrypt(d.holder, u), sec.encrypt(d.number, u), sec.mask(d.number),
      sec.encrypt(d.issuer, u), sec.encrypt(d.notes, u), d.issueDate, d.expiryDate);
  logActivity(u, 'Document added', d.title);
  res.status(201).json({ document: detail(db.prepare('SELECT * FROM documents WHERE id = ?').get(info.lastInsertRowid), u) });
});

router.put('/:id', (req, res) => {
  const row = findOwn(req, res);
  if (!row) return;
  const { d, error } = validate(req.body || {});
  if (error) return res.status(400).json({ error });
  const u = req.user.id;
  // If the number field still shows the masked value, keep the stored number.
  const keepNumber = !d.number || d.number === row.number_masked;
  db.prepare(`UPDATE documents SET type=?, title=?, holder_enc=?, number_enc=?, number_masked=?, issuer_enc=?, notes_enc=?,
      issue_date=?, expiry_date=?, updated_at=datetime('now') WHERE id=? AND user_id=?`)
    .run(d.type, d.title, sec.encrypt(d.holder, u),
      keepNumber ? row.number_enc : sec.encrypt(d.number, u), keepNumber ? row.number_masked : sec.mask(d.number),
      sec.encrypt(d.issuer, u), sec.encrypt(d.notes, u), d.issueDate, d.expiryDate, row.id, u);
  logActivity(u, 'Document updated', d.title);
  res.json({ document: detail(db.prepare('SELECT * FROM documents WHERE id = ?').get(row.id), u) });
});

router.delete('/:id', (req, res) => {
  const row = findOwn(req, res);
  if (!row) return;
  db.prepare('DELETE FROM documents WHERE id = ? AND user_id = ?').run(row.id, req.user.id);
  logActivity(req.user.id, 'Document deleted', row.title);
  res.json({ ok: true });
});

// Sensitive: needs the password again.
router.post('/:id/reveal', (req, res) => {
  const row = findOwn(req, res);
  if (!row || !confirmPassword(req, res)) return;
  logActivity(req.user.id, 'Full document number viewed', row.title);
  res.json({ number: sec.decrypt(row.number_enc, req.user.id) });
});

function sendPDF(res, doc, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  doc.pipe(res);
  doc.end();
}

// Report of every document.
router.post('/report/pdf', (req, res) => {
  if (!confirmPassword(req, res)) return;
  const rows = db.prepare('SELECT * FROM documents WHERE user_id = ? ORDER BY expiry_date ASC').all(req.user.id);
  logActivity(req.user.id, 'Full PDF report downloaded', `${rows.length} documents`);
  const pdf = reportPDF(req.user, rows.map((r) => detail(r, req.user.id, { revealNumber: true })), req.body.password);
  sendPDF(res, pdf, 'DocGuard-All-Documents.pdf');
});

// Full report for one document. The PDF is locked with the account password.
router.post('/:id/pdf', (req, res) => {
  const row = findOwn(req, res);
  if (!row || !confirmPassword(req, res)) return;
  logActivity(req.user.id, 'PDF downloaded', row.title);
  const pdf = documentPDF(req.user, detail(row, req.user.id, { revealNumber: true }), req.body.password);
  sendPDF(res, pdf, `DocGuard-${row.type.replace(/\W+/g, '-')}-${row.id}.pdf`);
});

module.exports = { router, TYPES };