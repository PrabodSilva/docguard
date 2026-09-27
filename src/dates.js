// Date helpers. All dates are plain calendar dates (YYYY-MM-DD).
const DAY = 24 * 60 * 60 * 1000;

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isValidISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const toUTC = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const daysBetween = (from, to) => Math.round((toUTC(to) - toUTC(from)) / DAY);

// "1 year, 2 months, 5 days"
function humanDuration(from, to) {
  let [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  let years = y2 - y1, months = m2 - m1, days = d2 - d1;
  if (days < 0) { months -= 1; days += new Date(Date.UTC(y2, m2 - 1, 0)).getUTCDate(); }
  if (months < 0) { years -= 1; months += 12; }
  const parts = [];
  if (years) parts.push(`${years} year${years > 1 ? 's' : ''}`);
  if (months) parts.push(`${months} month${months > 1 ? 's' : ''}`);
  if (days || !parts.length) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
  return parts.join(', ');
}

// Status used everywhere (web page, PDF, SMS)
function statusFor(expiry, issue) {
  const today = todayISO();
  const daysLeft = daysBetween(today, expiry);
  let status = 'valid';
  if (daysLeft < 0) status = 'expired';
  else if (daysLeft <= 30) status = 'critical';
  else if (daysLeft <= 90) status = 'soon';

  let progress = null; // % of validity period already used
  if (issue && isValidISODate(issue) && toUTC(issue) < toUTC(expiry)) {
    const total = daysBetween(issue, expiry);
    const used = daysBetween(issue, today);
    progress = Math.max(0, Math.min(100, Math.round((used / total) * 100)));
  }
  const remaining = daysLeft >= 0 ? humanDuration(today, expiry) : humanDuration(expiry, today);
  return { daysLeft, status, progress, remainingText: daysLeft >= 0 ? `${remaining} left` : `Expired ${remaining} ago` };
}

function prettyDate(s) {
  if (!s) return '—';
  return new Date(toUTC(s)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

module.exports = { todayISO, isValidISODate, daysBetween, statusFor, prettyDate };