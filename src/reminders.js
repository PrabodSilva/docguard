// Checks every hour for documents that are close to expiry and texts the owner.
// Each reminder (e.g. "30 days before") is sent only once per document.
const config = require('./config');
const { db, logActivity } = require('./db');
const sec = require('./security');
const { sendSMS } = require('./sms');
const { statusFor, prettyDate } = require('./dates');

function messageFor(user, doc, daysLeft) {
  const first = user.name.split(' ')[0];
  // Privacy: never put the document number or other details in an SMS.
  if (daysLeft < 0) return `DocGuard: Hi ${first}, your ${doc.title} EXPIRED on ${prettyDate(doc.expiry_date)}. Please renew it as soon as possible.`;
  if (daysLeft === 0) return `DocGuard: Hi ${first}, your ${doc.title} expires TODAY (${prettyDate(doc.expiry_date)}). Please renew it now.`;
  return `DocGuard: Hi ${first}, your ${doc.title} expires in ${daysLeft} day${daysLeft > 1 ? 's' : ''} (${prettyDate(doc.expiry_date)}). Plan your renewal.`;
}

async function runReminderCheck({ force = false } = {}) {
  const hour = new Date().getHours();
  if (!force && (hour < config.reminderHourStart || hour >= config.reminderHourEnd)) return { skipped: 'outside sending hours' };

  const users = db.prepare('SELECT * FROM users WHERE phone_verified = 1 AND sms_enabled = 1').all();
  const wasSent = db.prepare('SELECT 1 FROM reminders_sent WHERE document_id = ? AND expiry_date = ? AND threshold = ?');
  const markSent = db.prepare('INSERT OR IGNORE INTO reminders_sent (document_id, expiry_date, threshold) VALUES (?, ?, ?)');
  let sent = 0;

  for (const user of users) {
    const thresholds = [...user.remind_days.split(',').map(Number), 0]; // 0 = on/after expiry day
    const docs = db.prepare('SELECT * FROM documents WHERE user_id = ?').all(user.id);
    for (const doc of docs) {
      const { daysLeft } = statusFor(doc.expiry_date, doc.issue_date);
      if (daysLeft < -30) continue; // ignore documents that expired long ago
      // The smallest threshold we've already reached (e.g. 25 days left -> the "30 days" reminder).
      const due = thresholds.filter((t) => daysLeft <= t).sort((a, b) => a - b)[0];
      if (due === undefined || wasSent.get(doc.id, doc.expiry_date, due)) continue;
      try {
        await sendSMS(sec.decrypt(user.phone_enc, user.id), messageFor(user, doc, daysLeft));
        // Mark this and all larger thresholds as done, so we never send an older reminder late.
        thresholds.filter((t) => t >= due).forEach((t) => markSent.run(doc.id, doc.expiry_date, t));
        logActivity(user.id, 'SMS reminder sent', `${doc.title} – ${daysLeft} days left`);
        sent++;
      } catch (e) {
        console.error(`Reminder for document #${doc.id} failed:`, e.message);
      }
    }
  }
  if (sent) console.log(`⏰ Reminder check: ${sent} SMS sent.`);
  return { sent };
}

function startScheduler() {
  const tick = () => runReminderCheck().catch((e) => console.error('Reminder check failed:', e));
  setTimeout(tick, 5000);                 // shortly after start-up
  setInterval(tick, 60 * 60 * 1000);      // then every hour
}

module.exports = { startScheduler, runReminderCheck };