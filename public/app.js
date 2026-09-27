// DocGuard front-end (plain JavaScript, no framework).
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUS_LABEL = { valid: 'VALID', soon: 'EXPIRING SOON', critical: 'RENEW NOW', expired: 'EXPIRED' };
const REMIND_OPTIONS = [180, 90, 60, 30, 14, 7, 3, 1];
const IDLE_LOCK_MS = 10 * 60 * 1000;

const state = { user: null, docs: [], types: [], filter: 'all', search: '', editingId: null };

// ---------- Talking to the server ----------
async function api(method, url, body, { raw = false } = {}) {
  const res = await fetch('/api' + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && state.user) { lockApp('Your session ended. Please log in again.'); throw new Error('Please log in.'); }
  if (raw && res.ok) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 3200);
}

// Disable a button while a request runs, and show errors as pop-up messages.
async function busy(button, fn) {
  if (button) button.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { if (button) button.disabled = false; }
}

const prettyDate = (s) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

// ---------- Screens ----------
function showAuth() {
  $('#app-view').hidden = true;
  $('#auth-view').hidden = false;
}

async function showApp() {
  $('#auth-view').hidden = true;
  $('#app-view').hidden = false;
  if (!state.types.length) state.types = (await api('GET', '/documents/types')).types;
  $('#doc-form select[name=type]').innerHTML = state.types.map((t) => `<option>${esc(t)}</option>`).join('');
  navigate('home');
  resetIdle();
}

function navigate(view) {
  $('#home-view').hidden = view !== 'home';
  $('#settings-view').hidden = view !== 'settings';
  window.scrollTo(0, 0);
  if (view === 'home') loadDocuments();
  if (view === 'settings') renderSettings();
}

// ---------- Login / sign-up ----------
$$('[data-auth-tab]').forEach((tab) => tab.addEventListener('click', () => {
  $$('[data-auth-tab]').forEach((t) => t.classList.toggle('active', t === tab));
  $('#login-form').hidden = tab.dataset.authTab !== 'login';
  $('#register-form').hidden = tab.dataset.authTab !== 'register';
}));

$('#login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  busy(e.submitter, async () => {
    state.user = (await api('POST', '/auth/login', { email: f.get('email'), password: f.get('password') })).user;
    e.target.reset();
    showApp();
  });
});

$('#register-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  busy(e.submitter, async () => {
    state.user = (await api('POST', '/auth/register', Object.fromEntries(f))).user;
    e.target.reset();
    toast('Welcome to DocGuard! 🎉');
    showApp();
  });
});

function lockApp(message) {
  state.user = null;
  state.docs = [];
  $('#doc-list').innerHTML = '';
  $$('dialog[open]').forEach((d) => d.close());
  showAuth();
  if (message) toast(message);
}

$('#logout-btn').addEventListener('click', async () => {
  await api('POST', '/auth/logout').catch(() => {});
  lockApp('Logged out.');
});

// Auto-lock after 10 minutes without activity
let idleTimer;
function resetIdle() {
  clearTimeout(idleTimer);
  if (state.user) idleTimer = setTimeout(async () => {
    await api('POST', '/auth/logout').catch(() => {});
    lockApp('Locked after 10 minutes of inactivity.');
  }, IDLE_LOCK_MS);
}
['click', 'keydown', 'touchstart', 'scroll'].forEach((ev) => addEventListener(ev, resetIdle, { passive: true }));

// Hide contents when the app goes to the background (app switcher previews)
document.addEventListener('visibilitychange', () => { $('#privacy-screen').hidden = !(document.hidden && state.user); });

// ---------- Document list ----------
async function loadDocuments() {
  const { documents } = await api('GET', '/documents');
  state.docs = documents;
  renderDocuments();
}

function renderDocuments() {
  const u = state.user;
  const hour = new Date().getHours();
  $('#greeting-text').textContent = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, ${u.name.split(' ')[0]}`;
  const urgent = state.docs.filter((d) => d.status === 'expired' || d.status === 'critical').length;
  $('#greeting-sub').textContent = !state.docs.length ? 'Let’s add your first document.'
    : urgent ? `${urgent} document${urgent > 1 ? 's need' : ' needs'} your attention.` : 'Everything is up to date. 👍';
  $('#sms-banner').hidden = u.phoneVerified;

  const counts = { all: state.docs.length, expired: 0, critical: 0, soon: 0, valid: 0 };
  state.docs.forEach((d) => counts[d.status]++);
  Object.entries(counts).forEach(([k, n]) => ($(`#count-${k}`).textContent = n));
  $$('.stat').forEach((s) => s.classList.toggle('active', s.dataset.filter === state.filter));

  const q = state.search.toLowerCase();
  const list = state.docs.filter((d) =>
    (state.filter === 'all' || d.status === state.filter) &&
    (!q || d.title.toLowerCase().includes(q) || d.type.toLowerCase().includes(q)));

  $('#empty-state').hidden = state.docs.length > 0;
  $('#report-btn').hidden = state.docs.length === 0;
  $('#doc-list').innerHTML = list.map((d) => `
    <button class="doc-card s-${d.status}" data-id="${d.id}">
      <div class="top">
        <div>
          <div class="title">${esc(d.title)}</div>
          <div class="type">${esc(d.type)}${d.numberMasked ? ' · ' + esc(d.numberMasked) : ''}</div>
        </div>
        <div class="days"><b>${Math.abs(d.daysLeft)}</b><span>${d.daysLeft >= 0 ? 'days left' : 'days ago'}</span></div>
      </div>
      <div class="bar"><i data-progress="${d.status === 'expired' ? 100 : d.progress ?? ''}"></i></div>
      <div class="meta"><span class="pill">${STATUS_LABEL[d.status]}</span><span>${d.daysLeft < 0 ? 'Expired' : 'Expires'} ${prettyDate(d.expiryDate)}</span></div>
    </button>`).join('') || (state.docs.length ? '<p class="muted">No documents match.</p>' : '');
  // The security rules block inline styles, so bar widths are set from JavaScript
  $$('#doc-list .bar i').forEach((i) => {
    if (i.dataset.progress === '') i.parentElement.hidden = true;
    else i.style.width = i.dataset.progress + '%';
  });
}

$('#doc-list').addEventListener('click', (e) => {
  const card = e.target.closest('.doc-card');
  if (card) openDetail(Number(card.dataset.id));
});
$('#summary').addEventListener('click', (e) => {
  const s = e.target.closest('.stat');
  if (!s) return;
  state.filter = state.filter === s.dataset.filter ? 'all' : s.dataset.filter;
  renderDocuments();
});
$('#search').addEventListener('input', (e) => { state.search = e.target.value; renderDocuments(); });
document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) navigate(nav.dataset.nav);
  if (e.target.closest('[data-action=add]')) openForm();
  if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
});

// ---------- Add / edit form ----------
function openForm(doc = null) {
  const form = $('#doc-form');
  form.reset();
  state.editingId = doc?.id ?? null;
  $('#doc-form-title').textContent = doc ? 'Edit document' : 'Add document';
  if (doc) {
    for (const k of ['type', 'title', 'expiryDate', 'issueDate', 'number', 'holder', 'issuer', 'notes']) form.elements[k].value = doc[k] ?? '';
  }
  $('#doc-form-dialog').showModal();
}

$('#doc-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  busy(e.submitter, async () => {
    if (state.editingId) await api('PUT', `/documents/${state.editingId}`, body);
    else await api('POST', '/documents', body);
    $('#doc-form-dialog').close();
    $('#doc-detail-dialog').close();
    toast(state.editingId ? 'Document updated.' : 'Document saved and encrypted. 🔒');
    loadDocuments();
  });
});

// ---------- Document details ----------
async function openDetail(id) {
  const { document: d } = await api('GET', `/documents/${id}`).catch((e) => { toast(e.message, true); return {}; });
  if (!d) return;
  const field = (label, value, full = false) => `<div class="${full ? 'full' : ''}"><dt>${label}</dt><dd>${esc(value) || '—'}</dd></div>`;
  $('#doc-detail').className = `s-${d.status}`;
  $('#doc-detail').innerHTML = `
    <header class="sheet-head"><div><h3>${esc(d.title)}</h3><span class="muted">${esc(d.type)}</span></div>
      <button class="icon-btn" data-close aria-label="Close">✕</button></header>
    <div class="detail-hero">
      <span class="pill">${STATUS_LABEL[d.status]}</span>
      <div class="big">${Math.abs(d.daysLeft)} <small>${d.daysLeft >= 0 ? 'days left' : 'days since expiry'}</small></div>
      <div>${esc(d.remainingText)}</div>
      ${d.progress !== null || d.status === 'expired' ? `<div class="bar"><i data-progress="${d.status === 'expired' ? 100 : d.progress}"></i></div>
      <small>${d.status === 'expired' ? 100 : d.progress}% of the validity period used</small>` : ''}
    </div>
    <dl class="fields">
      <div class="full"><dt>Document number</dt><dd class="secret"><span id="doc-number">${esc(d.number) || '—'}</span>
        ${d.number ? '<button class="btn small" id="reveal-btn">Show</button>' : ''}</dd></div>
      ${field('Expiry date', prettyDate(d.expiryDate))}
      ${field('Issue date', prettyDate(d.issueDate))}
      ${field('Name on document', d.holder)}
      ${field('Issued by', d.issuer)}
      ${d.notes ? field('Notes', d.notes, true) : ''}
    </dl>
    <div class="row wrap">
      <button class="btn primary" id="pdf-btn">⬇ Download PDF</button>
      <button class="btn" id="edit-btn">Edit</button>
      <button class="btn danger-outline" id="delete-btn">Delete</button>
    </div>`;
  $$('#doc-detail .bar i').forEach((i) => (i.style.width = i.dataset.progress + '%'));

  $('#reveal-btn')?.addEventListener('click', async (e) => {
    const span = $('#doc-number');
    if (e.target.textContent === 'Hide') { span.textContent = d.number; e.target.textContent = 'Show'; return; }
    const password = await askPassword('Enter your password to see the full document number.');
    if (!password) return;
    busy(e.target, async () => {
      const { number } = await api('POST', `/documents/${d.id}/reveal`, { password });
      span.textContent = number;
      e.target.textContent = 'Hide';
      setTimeout(() => { if (span.isConnected) { span.textContent = d.number; e.target.textContent = 'Show'; } }, 30000);
    });
  });
  $('#pdf-btn').addEventListener('click', (e) => downloadPDF(`/documents/${d.id}/pdf`, e.target));
  $('#edit-btn').addEventListener('click', async (e) => {
    // Editing needs the real number, so confirm the password first if there is one.
    let number = '';
    if (d.number) {
      const password = await askPassword('Enter your password to edit this document.');
      if (!password) return;
      const r = await busy(e.target, () => api('POST', `/documents/${d.id}/reveal`, { password }));
      if (!r) return;
      number = r.number;
    }
    openForm({ ...d, number });
  });
  $('#delete-btn').addEventListener('click', (e) => {
    if (!confirm(`Delete "${d.title}"? This can't be undone.`)) return;
    busy(e.target, async () => {
      await api('DELETE', `/documents/${d.id}`);
      $('#doc-detail-dialog').close();
      toast('Document deleted.');
      loadDocuments();
    });
  });
  $('#doc-detail-dialog').showModal();
}

// ---------- Password pop-up ----------
function askPassword(message, { title = "Confirm it's you", okText = 'Continue', danger = false } = {}) {
  return new Promise((resolve) => {
    const dlg = $('#password-dialog'), form = $('#password-form');
    form.reset();
    $('#password-title').textContent = title;
    $('#password-msg').textContent = message;
    $('#password-ok').textContent = okText;
    $('#password-ok').className = 'btn ' + (danger ? 'danger' : 'primary');
    const onSubmit = (e) => { e.preventDefault(); done(form.elements.password.value); };
    const onClose = () => done(null);
    function done(value) {
      form.removeEventListener('submit', onSubmit);
      dlg.removeEventListener('close', onClose);
      if (dlg.open) dlg.close();
      resolve(value);
    }
    form.addEventListener('submit', onSubmit);
    dlg.addEventListener('close', onClose);
    dlg.showModal();
  });
}

async function downloadPDF(url, button) {
  const password = await askPassword('The PDF will be locked with your account password. Enter it to continue.', { okText: 'Download' });
  if (!password) return;
  busy(button, async () => {
    const res = await api('POST', url, { password }, { raw: true });
    const name = (res.headers.get('Content-Disposition') || '').match(/filename="(.+)"/)?.[1] || 'DocGuard.pdf';
    const blob = await res.blob();
    const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    toast('PDF downloaded. Open it with your password.');
  });
}
$('#report-btn').addEventListener('click', (e) => downloadPDF('/documents/report/pdf', e.target));

// ---------- Settings ----------
function renderSettings() {
  const u = state.user;
  const changing = !!$('#phone-none').dataset.changing;
  $('#phone-none').hidden = !!u.phone && !changing;
  $('#phone-verify').hidden = !(u.phone && !u.phoneVerified && !changing);
  $('#phone-done').hidden = !(u.phoneVerified && !changing);
  $('#verify-to').textContent = u.phone;
  $('#phone-masked').textContent = u.phone;
  $('#sms-mode-hint').hidden = u.smsProvider !== 'console';

  $('#remind-days').innerHTML = REMIND_OPTIONS.map((n) => `
    <label class="chip"><input type="checkbox" name="days" value="${n}" ${u.remindDays.includes(n) ? 'checked' : ''}>
    <span>${n === 1 ? '1 day' : n + ' days'} before</span></label>`).join('');
  $('#settings-form').elements.smsEnabled.checked = u.smsEnabled;
  $('#activity').hidden = true;
}

$('#phone-form').addEventListener('submit', (e) => {
  e.preventDefault();
  busy(e.submitter, async () => {
    const { sentTo } = await api('POST', '/me/phone', { phone: e.target.elements.phone.value });
    delete $('#phone-none').dataset.changing;
    state.user = (await api('GET', '/me')).user;
    e.target.reset();
    renderSettings();
    toast(`Code sent to ${sentTo}`);
    $('#verify-form input').focus();
  });
});

$('#verify-form').addEventListener('submit', (e) => {
  e.preventDefault();
  busy(e.submitter, async () => {
    state.user = (await api('POST', '/me/phone/verify', { code: e.target.elements.code.value })).user;
    e.target.reset();
    renderSettings();
    toast('Phone number verified ✅');
  });
});

$('#change-phone').addEventListener('click', () => { $('#phone-none').dataset.changing = '1'; renderSettings(); });

$('#remove-phone').addEventListener('click', (e) => {
  if (!confirm('Remove your phone number? You will stop getting SMS reminders.')) return;
  busy(e.target, async () => { state.user = (await api('DELETE', '/me/phone')).user; renderSettings(); toast('Phone number removed.'); });
});

$('#test-sms').addEventListener('click', (e) => busy(e.target, async () => {
  await api('POST', '/me/test-sms');
  toast(state.user.smsProvider === 'console' ? 'Test SMS printed in the terminal.' : 'Test SMS sent!');
}));

$('#settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const remindDays = $$('input[name=days]:checked', e.target).map((i) => Number(i.value));
  busy(e.submitter, async () => {
    state.user = (await api('PUT', '/me/settings', { remindDays, smsEnabled: e.target.elements.smsEnabled.checked })).user;
    toast('Reminder settings saved.');
  });
});

$('#logout-all').addEventListener('click', async (e) => {
  if (!confirm('Log out on every phone and computer?')) return;
  await busy(e.target, () => api('POST', '/auth/logout-all'));
  lockApp('Logged out of all devices.');
});

$('#show-activity').addEventListener('click', (e) => busy(e.target, async () => {
  const list = $('#activity');
  if (!list.hidden) { list.hidden = true; return; }
  const { activity } = await api('GET', '/me/activity');
  list.innerHTML = activity.map((a) => `<li><span>${esc(a.action)}${a.detail ? ` <span class="muted">– ${esc(a.detail)}</span>` : ''}</span>
    <time>${new Date(a.at.replace(' ', 'T') + 'Z').toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</time></li>`).join('');
  list.hidden = false;
}));

$('#delete-account').addEventListener('click', async (e) => {
  const password = await askPassword('This permanently deletes your account and all documents. Enter your password to confirm.',
    { title: 'Delete account?', okText: 'Delete forever', danger: true });
  if (!password) return;
  busy(e.target, async () => {
    await api('DELETE', '/me', { password });
    lockApp('Your account and all data were deleted.');
  });
});

// ---------- Start ----------
(async function start() {
  try {
    state.user = (await fetch('/api/session').then((r) => r.json())).user || null;
  } catch { state.user = null; }
  if (state.user) { showApp(); resetIdle(); } else showAuth();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();