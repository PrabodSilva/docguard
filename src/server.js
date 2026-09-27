// Entry point: `npm start` runs this file.
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const express = require('express');
const helmet = require('helmet');
const config = require('./config');
require('./db');
const auth = require('./auth');
const documents = require('./documents');
const { startScheduler } = require('./reminders');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

// Security headers (Content-Security-Policy, no sniffing, no framing, ...)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: config.secureCookies ? [] : null,
    },
  },
  strictTransportSecurity: config.secureCookies,
}));
app.use(express.json({ limit: '20kb' }));

// Never let browsers or proxies cache personal data
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/api', auth.router);
app.use('/api/documents', documents.router);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use(express.static(path.join(config.root, 'public'), { index: 'index.html' }));

// Error handler: log details on the server, send a simple message to the browser
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

function lanAddress() {
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets || []) if (n.family === 'IPv4' && !n.internal) return n.address;
  }
  return null;
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* no browser */ }
}

app.listen(config.port, () => {
  const local = `http://localhost:${config.port}`;
  const lan = lanAddress();
  console.log('\n🛡️  DocGuard is running\n');
  console.log(`   On this computer:  ${local}`);
  if (lan) console.log(`   On your phone:     http://${lan}:${config.port}   (same Wi-Fi)`);
  console.log(`   SMS mode:          ${config.sms.provider}${config.sms.provider === 'console' ? ' (messages appear here in the terminal)' : ''}`);
  if (config.createdEnv) console.log('\n   ✔ First run: created .env with new secret keys. Keep that file private!');
  console.log('\n   Press Ctrl+C to stop.\n');
  startScheduler();
  if (config.openBrowser) openBrowser(local);
});