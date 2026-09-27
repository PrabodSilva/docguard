// PDF reports (pdfkit). Files are encrypted with AES-256 and need a password to open.
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const { prettyDate, todayISO } = require('./dates');

const C = {
  ink: '#16202e', muted: '#5b6675', line: '#dfe4ea', brand: '#0f6e5c',
  valid: '#1d8a4e', soon: '#b7791f', critical: '#c2410c', expired: '#b42318',
};
const STATUS_LABEL = { valid: 'VALID', soon: 'EXPIRING SOON', critical: 'RENEW NOW', expired: 'EXPIRED' };

function newDoc(title, openPassword) {
  return new PDFDocument({
    size: 'A4',
    margin: 50,
    bufferPages: true,                    // lets us add page numbers at the end
    pdfVersion: '1.7ext3',               // enables AES-256 encryption
    userPassword: openPassword,           // needed to open the file
    ownerPassword: crypto.randomBytes(24).toString('hex'),
    permissions: { printing: 'highResolution', copying: false, modifying: false },
    info: { Title: title, Author: 'DocGuard', Subject: 'Confidential document report' },
  });
}

function header(pdf, title, user) {
  pdf.rect(0, 0, pdf.page.width, 90).fill(C.brand);
  pdf.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22).text('DocGuard', 50, 28);
  pdf.font('Helvetica').fontSize(10).text(title, 50, 56);
  pdf.fontSize(9).text(`Prepared for ${user.name}\nGenerated ${prettyDate(todayISO())}`, 300, 34, { width: 245, align: 'right' });
  pdf.fillColor(C.ink).moveDown(0);
  pdf.y = 115;
}

function footer(pdf) {
  const range = pdf.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    pdf.switchToPage(i);
    const bottom = pdf.page.height - 40;
    pdf.page.margins.bottom = 0;
    pdf.fontSize(8).fillColor(C.muted).font('Helvetica')
      .text('CONFIDENTIAL — contains personal information. Store securely and delete when no longer needed.', 50, bottom, { width: 400 })
      .text(`Page ${i - range.start + 1} of ${range.count}`, 450, bottom, { width: 95, align: 'right' });
  }
}

function statusBadge(pdf, doc, x, y) {
  const label = STATUS_LABEL[doc.status];
  pdf.font('Helvetica-Bold').fontSize(9);
  const w = pdf.widthOfString(label) + 16;
  pdf.roundedRect(x, y, w, 18, 9).fill(C[doc.status]);
  pdf.fillColor('#ffffff').text(label, x, y + 5, { width: w, align: 'center' });
  pdf.fillColor(C.ink);
  return w;
}

function progressBar(pdf, doc, x, y, width) {
  pdf.roundedRect(x, y, width, 8, 4).fill('#eef1f4');
  const pct = doc.status === 'expired' ? 100 : doc.progress ?? 0;
  if (pct > 0) pdf.roundedRect(x, y, Math.max(8, (width * pct) / 100), 8, 4).fill(C[doc.status]);
  pdf.fillColor(C.ink);
}

function field(pdf, label, value, x, y, width) {
  pdf.font('Helvetica').fontSize(8).fillColor(C.muted).text(label.toUpperCase(), x, y, { width, characterSpacing: 0.5 });
  pdf.font('Helvetica').fontSize(11).fillColor(C.ink).text(value || '—', x, y + 12, { width });
  return pdf.y;
}

function renewalAdvice(doc) {
  if (doc.status === 'expired') return 'This document has expired. Start the renewal process immediately — using an expired document may not be accepted and can lead to fines.';
  if (doc.status === 'critical') return `Only ${doc.daysLeft} day(s) remain. Book an appointment or submit the renewal application now; processing can take several weeks.`;
  if (doc.status === 'soon') return 'Expiry is within 3 months. Gather the required documents and plan your renewal.';
  return 'No action needed right now. You will receive SMS reminders before it expires.';
}

// ---------- One document ----------
function documentBlock(pdf, doc) {
  const x = 50, w = pdf.page.width - 100;
  pdf.font('Helvetica-Bold').fontSize(18).fillColor(C.ink).text(doc.title, x, pdf.y, { width: w });
  pdf.font('Helvetica').fontSize(10).fillColor(C.muted).text(doc.type);
  const y = pdf.y + 8;
  const bw = statusBadge(pdf, doc, x, y);
  pdf.font('Helvetica-Bold').fontSize(11).fillColor(C[doc.status]).text(doc.remainingText, x + bw + 10, y + 3);

  const ny = y + 32;
  const big = String(Math.abs(doc.daysLeft));
  pdf.font('Helvetica-Bold').fontSize(30).fillColor(C[doc.status]).text(big, x, ny, { lineBreak: false });
  const nw = pdf.widthOfString(big);
  pdf.font('Helvetica').fontSize(12).fillColor(C.muted)
    .text(doc.daysLeft >= 0 ? 'days until expiry' : 'days since expiry', x + nw + 8, ny + 12, { lineBreak: false });
  pdf.y = ny + 34;
  if (doc.progress !== null || doc.status === 'expired') {
    const py = pdf.y + 8;
    progressBar(pdf, doc, x, py, w);
    pdf.fontSize(8).fillColor(C.muted).text(`${doc.status === 'expired' ? 100 : doc.progress}% of validity period used`, x, py + 12);
  }

  let top = pdf.y + 18;
  pdf.moveTo(x, top).lineTo(x + w, top).strokeColor(C.line).stroke();
  top += 14;
  const col = w / 2 - 10;
  const rows = [
    ['Name on document', doc.holder, 'Document number', doc.number],
    ['Issue date', prettyDate(doc.issueDate), 'Expiry date', prettyDate(doc.expiryDate)],
    ['Issued by', doc.issuer, 'Days remaining', doc.daysLeft >= 0 ? `${doc.daysLeft} days` : 'Expired'],
  ];
  for (const [l1, v1, l2, v2] of rows) {
    const e1 = field(pdf, l1, v1, x, top, col);
    const e2 = field(pdf, l2, v2, x + col + 20, top, col);
    top = Math.max(e1, e2) + 12;
  }
  if (doc.notes) top = field(pdf, 'Notes', doc.notes, x, top, w) + 12;

  pdf.roundedRect(x, top, w, 1, 0).fill(C.line);
  pdf.font('Helvetica-Bold').fontSize(10).fillColor(C.ink).text('What to do', x, top + 12);
  pdf.font('Helvetica').fontSize(10).fillColor(C.ink).text(renewalAdvice(doc), x, pdf.y + 2, { width: w });
  pdf.font('Helvetica').fontSize(8).fillColor(C.muted)
    .text(`Record added ${doc.createdAt} UTC · last updated ${doc.updatedAt} UTC`, x, pdf.y + 14, { width: w });
}

function documentPDF(user, doc, openPassword) {
  const pdf = newDoc(`${doc.title} — details`, openPassword);
  header(pdf, 'Document details report', user);
  documentBlock(pdf, doc);
  footer(pdf);
  return pdf;
}

// ---------- All documents ----------
function reportPDF(user, docs, openPassword) {
  const pdf = newDoc('All documents — report', openPassword);
  header(pdf, 'All documents report', user);
  const x = 50, w = pdf.page.width - 100;

  // Summary tiles
  const counts = { expired: 0, critical: 0, soon: 0, valid: 0 };
  docs.forEach((d) => counts[d.status]++);
  const tiles = [['Total', docs.length, C.brand], ['Expired', counts.expired, C.expired], ['Within 30 days', counts.critical, C.critical], ['Within 90 days', counts.soon, C.soon], ['Valid', counts.valid, C.valid]];
  const tw = (w - 4 * 8) / 5;
  const tileY = 115;
  tiles.forEach(([label, n, color], i) => {
    const tx = x + i * (tw + 8);
    pdf.roundedRect(tx, tileY, tw, 52, 6).lineWidth(1).strokeColor(C.line).stroke();
    pdf.font('Helvetica-Bold').fontSize(20).fillColor(color).text(String(n), tx, 128, { width: tw, align: 'center' });
    pdf.font('Helvetica').fontSize(8).fillColor(C.muted).text(label, tx, 154, { width: tw, align: 'center' });
  });
  pdf.y = 185;

  // Overview table
  pdf.font('Helvetica-Bold').fontSize(13).fillColor(C.ink).text('Overview', x, pdf.y);
  const cols = [['Document', 150], ['Number', 80], ['Expiry', 80], ['Status', 85], ['Remaining', w - 395]];
  let ty = pdf.y + 8;
  pdf.rect(x, ty, w, 20).fill('#f3f5f8');
  let cx = x;
  pdf.font('Helvetica-Bold').fontSize(8).fillColor(C.muted);
  cols.forEach(([h, cw]) => { pdf.text(h.toUpperCase(), cx + 6, ty + 7, { width: cw - 8 }); cx += cw; });
  ty += 20;
  for (const d of docs) {
    if (ty > pdf.page.height - 90) { pdf.addPage(); ty = 50; }
    const cells = [d.title, d.number || '—', prettyDate(d.expiryDate), STATUS_LABEL[d.status], d.remainingText];
    cx = x;
    cells.forEach((v, i) => {
      pdf.font(i === 3 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(i === 3 ? C[d.status] : C.ink)
        .text(v, cx + 6, ty + 7, { width: cols[i][1] - 8, height: 12, ellipsis: true });
      cx += cols[i][1];
    });
    ty += 24;
    pdf.moveTo(x, ty).lineTo(x + w, ty).strokeColor(C.line).lineWidth(0.5).stroke();
  }
  if (!docs.length) pdf.font('Helvetica').fontSize(10).fillColor(C.muted).text('No documents saved yet.', x, ty + 10);

  // One page per document with full details
  for (const d of docs) {
    pdf.addPage();
    pdf.y = 50;
    documentBlock(pdf, d);
  }
  footer(pdf);
  return pdf;
}

module.exports = { documentPDF, reportPDF };