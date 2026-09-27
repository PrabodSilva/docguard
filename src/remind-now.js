// `npm run remind` — run the SMS reminder check immediately (ignores sending hours).
const { runReminderCheck } = require('./reminders');

runReminderCheck({ force: true }).then((r) => {
  console.log(`Reminder check finished: ${r.sent} SMS sent.`);
  process.exit(0);
});