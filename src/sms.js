// Sends SMS through the provider chosen in .env (SMS_PROVIDER).
const config = require('./config');

// Turn "077 123 4567" / "+94771234567" / "0771234567" into "94771234567".
function normalizePhone(input) {
  let digits = String(input || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = config.defaultCountryCode + digits.slice(1);
  digits = digits.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

const maskPhone = (p) => (p ? '+' + p.slice(0, 2) + ' ••• ••' + p.slice(-4) : '');

const providers = {
  async console(to, message) {
    console.log('\n📱 ─── SMS (console mode – not really sent) ───');
    console.log(`   To: +${to}`);
    console.log(`   ${message}`);
    console.log('   ───────────────────────────────────────────\n');
    return { ok: true };
  },

  async notifylk(to, message) {
    const { userId, apiKey, senderId } = config.sms.notifylk;
    if (!userId || !apiKey) throw new Error('Notify.lk is not configured (NOTIFYLK_USER_ID / NOTIFYLK_API_KEY).');
    const url = new URL('https://app.notify.lk/api/v1/send');
    url.search = new URLSearchParams({ user_id: userId, api_key: apiKey, sender_id: senderId, to, message });
    const res = await fetch(url, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.status !== 'success') throw new Error('Notify.lk error: ' + JSON.stringify(body));
    return { ok: true };
  },

  async twilio(to, message) {
    const { sid, token, from } = config.sms.twilio;
    if (!sid || !token || !from) throw new Error('Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM).');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: '+' + to, From: from, Body: message }),
    });
    if (!res.ok) throw new Error('Twilio error: ' + (await res.text()));
    return { ok: true };
  },
};

async function sendSMS(to, message) {
  const send = providers[config.sms.provider];
  if (!send) throw new Error(`Unknown SMS_PROVIDER "${config.sms.provider}"`);
  return send(to, message);
}

module.exports = { sendSMS, normalizePhone, maskPhone };