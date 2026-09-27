// Loads settings from .env. On the very first run it creates .env with
// freshly generated secret keys, so the app works with zero setup.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');

function firstRunSetup() {
  if (fs.existsSync(ENV_PATH)) return false;
  const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const filled = example
    .replace('DATA_KEY=', 'DATA_KEY=' + crypto.randomBytes(32).toString('base64'))
    .replace('SESSION_SECRET=', 'SESSION_SECRET=' + crypto.randomBytes(32).toString('base64'));
  fs.writeFileSync(ENV_PATH, filled, { mode: 0o600 });
  return true;
}

const created = firstRunSetup();
process.loadEnvFile(ENV_PATH);

const env = process.env;
const config = {
  createdEnv: created,
  root: ROOT,
  port: Number(env.PORT || 3000),
  dbFile: path.resolve(ROOT, env.DB_FILE || 'data/docguard.db'),
  dataKey: Buffer.from(env.DATA_KEY || '', 'base64'),
  sessionSecret: env.SESSION_SECRET || '',
  sessionDays: Number(env.SESSION_DAYS || 7),
  secureCookies: env.SECURE_COOKIES === 'true',
  openBrowser: env.OPEN_BROWSER !== 'false',
  defaultCountryCode: (env.DEFAULT_COUNTRY_CODE || '94').replace(/\D/g, ''),
  reminderHourStart: Number(env.REMINDER_HOUR_START || 8),
  reminderHourEnd: Number(env.REMINDER_HOUR_END || 20),
  sms: {
    provider: (env.SMS_PROVIDER || 'console').toLowerCase(),
    notifylk: { userId: env.NOTIFYLK_USER_ID, apiKey: env.NOTIFYLK_API_KEY, senderId: env.NOTIFYLK_SENDER_ID || 'NotifyDEMO' },
    twilio: { sid: env.TWILIO_ACCOUNT_SID, token: env.TWILIO_AUTH_TOKEN, from: env.TWILIO_FROM },
  },
};

if (config.dataKey.length !== 32) {
  console.error('DATA_KEY in .env must be 32 random bytes (base64). Delete .env and restart to regenerate.');
  process.exit(1);
}
if (config.sessionSecret.length < 32) {
  console.error('SESSION_SECRET in .env is missing or too short. Delete .env and restart to regenerate.');
  process.exit(1);
}

module.exports = config;