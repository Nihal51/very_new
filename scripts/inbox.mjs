/**
 * DriveBuddy Inbox — a live screen for the leads coming off the website.
 *
 *     npm run inbox
 *
 * Opens a page in your browser that lists every booking request and every driver
 * application, newest at the top, with a NEW badge on anything you have not looked
 * at yet. It refreshes itself, so a booking made while the page is open appears on
 * its own — with a beep and a desktop notification. It also keeps
 * `exports/drivebuddy-leads-latest.xlsx` up to date automatically, so the
 * spreadsheet is always current without running anything.
 *
 * WHY A LOCAL PAGE AND NOT A PAGE ON THE WEBSITE
 * `firestore.rules` denies every read from the browser on purpose, so that a
 * leaked public API key can never be used to dump customers' names, mobile numbers
 * and home addresses. This server holds the service-account key on your own
 * machine and never sends it to the browser, so the data goes Firestore -> your PC
 * -> your screen and nowhere else. The public site keeps its read-denied posture
 * exactly as it is, and there is no login page for anyone to attack.
 *
 * HOW IT IS LOCKED DOWN
 *  - It listens on 127.0.0.1 only, so nothing on your wifi or the internet can
 *    reach it — not even another device in the same house.
 *  - Every request must carry a random key generated fresh at startup. Without it
 *    the server answers 401 and nothing else.
 *  - The Host header is checked against an allow-list. That blocks DNS rebinding,
 *    where a website you visit tries to make *your* browser read localhost for it.
 *  - Cross-site requests are refused outright, and no CORS headers are ever sent.
 *  - Customer text is put on the page as text, never as HTML, so a name or note
 *    containing markup cannot execute anything.
 *  - Nothing here writes to Firestore. It is read-only by construction.
 *
 * SETUP is the same key as `npm run leads` — see scripts/export-leads.mjs.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildWorkbook,
  getAccessToken,
  listCollection,
  loadServiceAccount,
  normaliseBooking,
  normaliseDriver,
} from './export-leads.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'exports');
const LATEST_XLSX = path.join(OUT_DIR, 'drivebuddy-leads-latest.xlsx');

const CONFIG_DIR = path.join(homedir(), '.drivebuddy');
const STATE_FILE = path.join(CONFIG_DIR, 'inbox-state.json');
const NOTIFY_FILE = path.join(CONFIG_DIR, 'notify.json');

const PORT = Number(process.env.INBOX_PORT) || 4321;
const HOST = '127.0.0.1';
/** How often to ask Firestore for new leads. 15s is well inside the free quota. */
const POLL_MS = 15_000;

/** Single-use key for this run. A rebinding attacker cannot guess it. */
const KEY = randomBytes(24).toString('base64url');

/* ------------------------------------------------------------------- state */

/**
 * `lastSeenAt` per tab is all that is needed to answer "which of these is new":
 * anything created after it is new. Kept outside the repo, next to the key, and
 * holds no customer data — only two timestamps.
 */
let state = { bookings: { lastSeenAt: null }, drivers: { lastSeenAt: null } };

async function loadState() {
  try {
    const parsed = JSON.parse(await readFile(STATE_FILE, 'utf8'));
    for (const tab of ['bookings', 'drivers']) {
      const at = parsed?.[tab]?.lastSeenAt;
      if (typeof at === 'string' && !Number.isNaN(Date.parse(at))) {
        state[tab].lastSeenAt = at;
      }
    }
  } catch {
    // No state yet, or unreadable: first run treats everything as new, which is right.
  }
}

async function saveState() {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

/* -------------------------------------------------------------------- data */

/** Cached OAuth token. Google's are valid an hour; renew with five minutes to spare. */
let tokenCache = { value: null, expiresAt: 0 };

let serviceAccount = null;

async function freshToken() {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;
  const value = await getAccessToken(serviceAccount);
  tokenCache = { value, expiresAt: Date.now() + 55 * 60_000 };
  return value;
}

/** Latest snapshot, served to the browser. Refreshed by the poller. */
let snapshot = { bookings: [], drivers: [], fetchedAt: null, error: null };

/** Newest createdAt seen so far, per tab — used to detect genuinely new arrivals. */
let highWater = { bookings: 0, drivers: 0 };

async function refresh({ notify }) {
  const token = await freshToken();
  const [rawBookings, rawDrivers] = await Promise.all([
    listCollection(serviceAccount.project_id, token, 'bookings'),
    listCollection(serviceAccount.project_id, token, 'drivers'),
  ]);

  const bookings = rawBookings.map(normaliseBooking);
  const drivers = rawDrivers.map(normaliseDriver);

  // listCollection already sorts newest-first, so index 0 is the high-water mark.
  const newestOf = (rows) => (rows[0]?.created ? rows[0].created.getTime() : 0);
  const arrived = {
    bookings: bookings.filter((b) => b.created.getTime() > highWater.bookings),
    drivers: drivers.filter((d) => d.created.getTime() > highWater.drivers),
  };

  const changed =
    newestOf(bookings) !== highWater.bookings ||
    newestOf(drivers) !== highWater.drivers ||
    snapshot.bookings.length !== bookings.length ||
    snapshot.drivers.length !== drivers.length;

  const firstRun = snapshot.fetchedAt === null;
  highWater = { bookings: newestOf(bookings), drivers: newestOf(drivers) };
  snapshot = { bookings, drivers, fetchedAt: new Date().toISOString(), error: null };

  if (changed) await writeLatestWorkbook(rawBookings, rawDrivers);

  // Never announce the backlog on startup — only leads that land while we watch.
  if (notify && !firstRun) {
    for (const b of arrived.bookings) await sendAlert('booking', b);
    for (const d of arrived.drivers) await sendAlert('driver', d);
  }
}

async function writeLatestWorkbook(rawBookings, rawDrivers) {
  try {
    await mkdir(OUT_DIR, { recursive: true });
    await buildWorkbook(rawBookings, rawDrivers).xlsx.writeFile(LATEST_XLSX);
  } catch (err) {
    // Excel holds an exclusive lock on an open file; that must not kill the server.
    console.warn(`   (could not update the spreadsheet: ${err.message})`);
  }
}

/* ---------------------------------------------------------------- alerting */

/**
 * Optional WhatsApp / webhook alert, configured in ~/.drivebuddy/notify.json.
 * Absent by default, in which case the browser's own desktop notification is the
 * only alert. Customer name, phone and address are left OUT of the message unless
 * `includeDetails` is explicitly true: the alert travels through someone else's
 * server, the details do not need to.
 */
let notifyConfig = null;

async function loadNotifyConfig() {
  try {
    notifyConfig = JSON.parse(await readFile(NOTIFY_FILE, 'utf8'));
  } catch {
    notifyConfig = null;
  }
}

function alertText(kind, row) {
  const time = row.created.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
  });
  const head =
    kind === 'booking'
      ? `New booking — ${row.city || 'city not given'} · ${row.service || 'service not given'}`
      : `New driver application — ${row.city || 'city not given'}`;
  const details = notifyConfig?.includeDetails ? `\n${row.name} · ${row.phone}` : '';
  return `${head}\n${time} IST${details}\nOpen your DriveBuddy inbox.`;
}

async function sendAlert(kind, row) {
  const label = kind === 'booking' ? 'booking' : 'driver application';
  console.log(`   * new ${label} from ${row.city || 'unknown city'} at ${row.created.toISOString()}`);
  if (!notifyConfig?.channel) return;

  const message = alertText(kind, row);
  try {
    if (notifyConfig.channel === 'callmebot') {
      const url = new URL('https://api.callmebot.com/whatsapp.php');
      url.searchParams.set('phone', notifyConfig.phone);
      url.searchParams.set('apikey', notifyConfig.apikey);
      url.searchParams.set('text', message);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } else if (notifyConfig.channel === 'cloudapi') {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${notifyConfig.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${notifyConfig.accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: notifyConfig.to,
            type: 'text',
            text: { body: message },
          }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    } else if (notifyConfig.channel === 'webhook') {
      const res = await fetch(notifyConfig.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, message, city: row.city, service: row.service ?? null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } else {
      throw new Error(`unknown channel "${notifyConfig.channel}"`);
    }
    console.log('     WhatsApp alert sent.');
  } catch (err) {
    console.warn(`     alert failed: ${err.message}`);
  }
}

/* ------------------------------------------------------------------ server */

/** Constant-time compare so the key cannot be recovered by timing the response. */
function keyMatches(given) {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
};

function send(res, status, type, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': type });
  res.end(body);
}

/** Rows plus the one flag the page needs to draw a NEW badge. */
function tabPayload(tab) {
  const since = state[tab].lastSeenAt ? Date.parse(state[tab].lastSeenAt) : 0;
  return snapshot[tab].map((row) => ({
    ...row,
    created: row.created.toISOString(),
    isNew: row.created.getTime() > since,
  }));
}

const server = createServer(async (req, res) => {
  // A DNS-rebinding attack arrives with the attacker's hostname in Host, so an
  // allow-list here is what stops a web page from reading this data through you.
  if (!ALLOWED_HOSTS.has(String(req.headers.host))) {
    return send(res, 403, 'text/plain; charset=utf-8', 'Forbidden host.\n');
  }
  // Belt and braces for browsers that send it: refuse anything cross-site.
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    return send(res, 403, 'text/plain; charset=utf-8', 'Cross-site requests are refused.\n');
  }

  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
  if (!keyMatches(url.searchParams.get('k'))) {
    // Opening plain http://localhost:4321 in a browser is the normal way in, so hand
    // the key over on the front page rather than showing a dead end. This is only
    // reachable once the Host allow-list above has passed, which is what actually
    // stops a remote page from getting here; the key still guards the data routes
    // against anything else running on this machine.
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(302, { ...SECURITY_HEADERS, location: `/?k=${KEY}` });
      return res.end();
    }
    return send(res, 401, 'text/plain; charset=utf-8', 'Missing or wrong key.\n');
  }

  try {
    switch (url.pathname) {
      case '/':
        return send(res, 200, 'text/html; charset=utf-8', PAGE);

      case '/app.js':
        return send(res, 200, 'text/javascript; charset=utf-8', CLIENT_JS);

      case '/api/leads':
        return send(
          res,
          200,
          'application/json; charset=utf-8',
          JSON.stringify({
            bookings: tabPayload('bookings'),
            drivers: tabPayload('drivers'),
            fetchedAt: snapshot.fetchedAt,
            error: snapshot.error,
            spreadsheet: LATEST_XLSX,
          }),
        );

      case '/api/seen': {
        if (req.method !== 'POST') return send(res, 405, 'text/plain', 'POST only.\n');
        const tab = url.searchParams.get('tab');
        if (tab !== 'bookings' && tab !== 'drivers') {
          return send(res, 400, 'text/plain', 'Unknown tab.\n');
        }
        state[tab].lastSeenAt = new Date().toISOString();
        await saveState();
        return send(res, 200, 'application/json', JSON.stringify({ ok: true }));
      }

      default:
        return send(res, 404, 'text/plain; charset=utf-8', 'Not found.\n');
    }
  } catch (err) {
    console.error(err);
    return send(res, 500, 'text/plain; charset=utf-8', 'Server error.\n');
  }
});

/* -------------------------------------------------------------------- page */

const PAGE = `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>DriveBuddy Inbox</title>
<style>
  :root{
    --bg:#0c0a09; --panel:#161311; --panel-2:#1f1a17; --line:#2c2522;
    --fg:#f5f1ed; --muted:#a89f97; --subtle:#7c736c;
    --amber:#fbbf24; --amber-dim:#78350f; --green:#34d399; --blue:#60a5fa;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);
    font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  header{position:sticky;top:0;z-index:5;background:rgba(12,10,9,.92);
    backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:14px 20px}
  .bar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;max-width:1180px;margin:0 auto}
  h1{margin:0;font-size:17px;letter-spacing:-.01em}
  h1 span{color:var(--amber)}
  .tabs{display:flex;gap:6px;margin-left:auto}
  .tab{background:var(--panel);border:1px solid var(--line);color:var(--muted);
    padding:7px 14px;border-radius:9px;cursor:pointer;font:inherit;font-weight:600;font-size:14px}
  .tab[aria-selected=true]{background:var(--amber);border-color:var(--amber);color:#231a06}
  .tab .n{opacity:.75;font-weight:500}
  .pill{background:#7f1d1d;color:#fecaca;border-radius:999px;padding:1px 8px;
    font-size:12px;font-weight:700;margin-left:6px}
  .ctrls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;max-width:1180px;
    margin:12px auto 0}
  input[type=search]{flex:1;min-width:200px;background:var(--panel);color:var(--fg);
    border:1px solid var(--line);border-radius:9px;padding:8px 12px;font:inherit}
  input[type=search]::placeholder{color:var(--subtle)}
  .btn{background:var(--panel);border:1px solid var(--line);color:var(--fg);
    padding:8px 13px;border-radius:9px;cursor:pointer;font:inherit;font-size:14px;font-weight:600}
  .btn:hover{background:var(--panel-2)}
  .btn.go{background:var(--amber);border-color:var(--amber);color:#231a06}
  main{max-width:1180px;margin:0 auto;padding:18px 20px 60px}
  .stat{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}
  .stat div{background:var(--panel);border:1px solid var(--line);border-radius:11px;
    padding:10px 14px;min-width:104px}
  .stat b{display:block;font-size:21px;letter-spacing:-.02em}
  .stat i{font-style:normal;color:var(--subtle);font-size:12px;text-transform:uppercase;
    letter-spacing:.06em}
  ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px}
  li{background:var(--panel);border:1px solid var(--line);border-left:3px solid transparent;
    border-radius:11px;overflow:hidden}
  li.fresh{border-left-color:var(--amber);background:linear-gradient(90deg,#1c1509,var(--panel) 320px)}
  .row{display:grid;grid-template-columns:1fr auto;gap:8px 16px;padding:12px 15px;cursor:pointer;
    align-items:center}
  .who{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;min-width:0}
  .who b{font-size:15.5px;letter-spacing:-.01em}
  .new{background:var(--amber);color:#231a06;border-radius:5px;padding:1px 6px;
    font-size:10.5px;font-weight:800;letter-spacing:.05em}
  .meta{color:var(--muted);font-size:13.5px;margin-top:3px;
    display:flex;gap:7px;flex-wrap:wrap;align-items:center}
  .meta .dot{color:var(--subtle)}
  .when{text-align:right;color:var(--muted);font-size:13px;white-space:nowrap}
  .when b{display:block;color:var(--fg);font-weight:600;font-size:13.5px}
  .tel{font-variant-numeric:tabular-nums;color:var(--blue);font-weight:600}
  .detail{display:none;border-top:1px solid var(--line);padding:13px 15px;background:var(--panel-2)}
  li.open .detail{display:block}
  dl{margin:0;display:grid;grid-template-columns:132px 1fr;gap:7px 14px;font-size:14px}
  dt{color:var(--subtle)}
  dd{margin:0}
  .acts{display:flex;gap:8px;margin-top:13px;flex-wrap:wrap}
  a.act{text-decoration:none;background:var(--amber);color:#231a06;padding:8px 14px;
    border-radius:9px;font-weight:700;font-size:14px}
  a.act.alt{background:var(--panel);color:var(--fg);border:1px solid var(--line)}
  .note{color:var(--subtle);font-size:13px;margin:0 auto;max-width:1180px;padding:0 20px}
  .empty{color:var(--subtle);text-align:center;padding:48px 20px}
  .err{background:#450a0a;border:1px solid #7f1d1d;color:#fecaca;padding:12px 15px;
    border-radius:11px;margin-bottom:15px;font-size:14px}
  @media (max-width:620px){
    .row{grid-template-columns:1fr}
    .when{text-align:left}
    dl{grid-template-columns:1fr;gap:2px 0}
    dt{margin-top:8px}
  }
</style>
</head>
<body>
<header>
  <div class="bar">
    <h1>Drive<span>Buddy</span> Inbox</h1>
    <div class="tabs" role="tablist">
      <button class="tab" role="tab" id="tab-bookings" aria-selected="true">
        Bookings <span class="n" id="n-bookings"></span><span class="pill" id="p-bookings" hidden></span>
      </button>
      <button class="tab" role="tab" id="tab-drivers" aria-selected="false">
        Drivers <span class="n" id="n-drivers"></span><span class="pill" id="p-drivers" hidden></span>
      </button>
    </div>
  </div>
  <div class="ctrls">
    <input type="search" id="q" placeholder="Search name, mobile, city, address…" autocomplete="off">
    <button class="btn go" id="seen">Mark all as read</button>
    <button class="btn" id="bell">Enable alerts</button>
    <button class="btn" id="xls">Open spreadsheet folder</button>
  </div>
</header>
<main>
  <div id="err"></div>
  <div class="stat" id="stat"></div>
  <ul id="list"></ul>
</main>
<p class="note" id="foot"></p>
<script src="/app.js?k=${KEY}"></script>
</body>
</html>`;

const CLIENT_JS = String.raw`
/* The page key travels in the URL; every fetch reuses it. */
const KEY = new URLSearchParams(location.search).get('k') || '';
const api = (p, q = '') => p + '?k=' + encodeURIComponent(KEY) + q;

let tab = 'bookings';
let data = { bookings: [], drivers: [], fetchedAt: null, error: null, spreadsheet: '' };
let open = new Set();
let knownIds = new Set();
let primed = false;

const $ = (id) => document.getElementById(id);

/* ---- formatting ------------------------------------------------------- */

const IST = { timeZone: 'Asia/Kolkata' };
const fmtTime = new Intl.DateTimeFormat('en-IN', { ...IST, hour: 'numeric', minute: '2-digit' });
const fmtDate = new Intl.DateTimeFormat('en-IN', { ...IST, day: '2-digit', month: 'short' });
const fmtFull = new Intl.DateTimeFormat('en-IN', {
  ...IST, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  hour: 'numeric', minute: '2-digit',
});

function ago(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) { const h = Math.floor(s / 3600); return h + (h === 1 ? ' hour ago' : ' hours ago'); }
  const d = Math.floor(s / 86400);
  if (d === 1) return 'yesterday';
  if (d < 30) return d + ' days ago';
  return fmtDate.format(new Date(iso));
}

/** Build an element and set its text through textContent — never innerHTML. */
function el(kind, cls, text) {
  const n = document.createElement(kind);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null && text !== '') n.textContent = String(text);
  return n;
}

const telHref = (p) => 'tel:+91' + String(p).replace(/\D/g, '').slice(-10);
function waHref(phone, name, kind) {
  const num = '91' + String(phone).replace(/\D/g, '').slice(-10);
  const first = String(name || '').trim().split(/\s+/)[0] || 'there';
  const msg = kind === 'bookings'
    ? 'Hello ' + first + ', DriveBuddy here about your driver booking. When would you like the driver?'
    : 'Hello ' + first + ', DriveBuddy here about your driver application. Is now a good time to talk?';
  return 'https://wa.me/' + num + '?text=' + encodeURIComponent(msg);
}

/* ---- rendering -------------------------------------------------------- */

function matches(row, q) {
  if (!q) return true;
  return Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(q));
}

function render() {
  const rows = data[tab] || [];
  const q = $('q').value.trim().toLowerCase();
  const shown = rows.filter((r) => matches(r, q));

  $('err').replaceChildren();
  if (data.error) $('err').append(el('div', 'err', data.error));

  for (const t of ['bookings', 'drivers']) {
    const all = data[t] || [];
    const fresh = all.filter((r) => r.isNew).length;
    $('n-' + t).textContent = '(' + all.length + ')';
    const pill = $('p-' + t);
    pill.hidden = fresh === 0;
    pill.textContent = fresh + ' new';
    $('tab-' + t).setAttribute('aria-selected', String(t === tab));
  }

  const freshNow = (data[tab] || []).filter((r) => r.isNew).length;
  document.title = (freshNow ? '(' + freshNow + ') ' : '') + 'DriveBuddy Inbox';

  const today = new Date().toLocaleDateString('en-IN', IST);
  const countToday = (t) =>
    (data[t] || []).filter((r) => new Date(r.created).toLocaleDateString('en-IN', IST) === today).length;

  const stat = $('stat');
  stat.replaceChildren();
  for (const [label, value] of [
    ['Bookings today', countToday('bookings')],
    ['Drivers today', countToday('drivers')],
    ['Bookings total', (data.bookings || []).length],
    ['Drivers total', (data.drivers || []).length],
    ['Unread here', freshNow],
  ]) {
    const box = el('div');
    box.append(el('b', '', value), el('i', '', label));
    stat.append(box);
  }

  const list = $('list');
  list.replaceChildren();

  if (shown.length === 0) {
    const li = el('li');
    li.append(el('div', 'empty',
      rows.length === 0 ? 'Nothing here yet.' : 'Nothing matches that search.'));
    list.append(li);
    return;
  }

  for (const row of shown) list.append(card(row));
}

function card(row) {
  const li = el('li');
  if (row.isNew) li.classList.add('fresh');
  if (open.has(row.id)) li.classList.add('open');

  const head = el('div', 'row');
  const left = el('div');
  const who = el('div', 'who');
  who.append(el('b', '', row.name || '(no name)'));
  if (row.isNew) who.append(el('span', 'new', 'NEW'));
  left.append(who);

  const meta = el('div', 'meta');
  const bits = tab === 'bookings'
    ? [row.phone, row.city, row.service]
    : [row.phone, row.city, row.licence, row.years !== '' ? row.years + ' yrs exp' : ''];
  bits.filter(Boolean).forEach((bit, i) => {
    if (i) meta.append(el('span', 'dot', '·'));
    meta.append(el('span', i === 0 ? 'tel' : '', bit));
  });
  left.append(meta);

  const when = el('div', 'when');
  when.append(el('b', '', ago(row.created)), el('span', '', fmtTime.format(new Date(row.created))));

  head.append(left, when);
  head.addEventListener('click', () => {
    if (open.has(row.id)) open.delete(row.id); else open.add(row.id);
    li.classList.toggle('open');
  });

  const detail = el('div', 'detail');
  const dl = el('dl');
  const pairs = tab === 'bookings'
    ? [['Received', fmtFull.format(new Date(row.created))],
       ['Mobile', row.phone], ['City', row.city], ['Service', row.service],
       ['Pickup address', row.pickup], ['Wanted for', row.preferred],
       ['Notes', row.notes || '—'], ['Status', row.status], ['Booking ID', row.id]]
    : [['Received', fmtFull.format(new Date(row.created))],
       ['Mobile', row.phone], ['City', row.city],
       ['Experience', row.years === '' ? '—' : row.years + ' years'],
       ['Licence', row.licence], ['About', row.about || '—'],
       ['Status', row.status], ['Application ID', row.id]];
  for (const [k, v] of pairs) dl.append(el('dt', '', k), el('dd', '', v || '—'));
  detail.append(dl);

  if (row.phone) {
    const acts = el('div', 'acts');
    const call = el('a', 'act', 'Call ' + row.phone);
    call.href = telHref(row.phone);
    const wa = el('a', 'act alt', 'WhatsApp');
    wa.href = waHref(row.phone, row.name, tab);
    wa.target = '_blank';
    wa.rel = 'noopener noreferrer';
    acts.append(call, wa);
    detail.append(acts);
  }

  li.append(head, detail);
  return li;
}

/* ---- alerts ----------------------------------------------------------- */

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine'; osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    osc.start(); osc.stop(ctx.currentTime + 0.46);
  } catch { /* audio blocked until the page is interacted with; not worth reporting */ }
}

function announce(row, kind) {
  beep();
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const title = kind === 'bookings' ? 'New booking request' : 'New driver application';
  const where = [row.city, kind === 'bookings' ? row.service : row.licence].filter(Boolean).join(' · ');
  new Notification(title, { body: (row.name || 'Someone') + (where ? ' — ' + where : ''), tag: row.id });
}

/* ---- polling ---------------------------------------------------------- */

async function poll() {
  try {
    const res = await fetch(api('/api/leads'), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const next = await res.json();

    // On the first load, remember what was already there so we do not alert on it.
    const ids = new Set();
    for (const t of ['bookings', 'drivers']) for (const r of next[t] || []) ids.add(t + ':' + r.id);
    if (primed) {
      for (const t of ['bookings', 'drivers']) {
        for (const r of next[t] || []) {
          if (!knownIds.has(t + ':' + r.id)) announce(r, t);
        }
      }
    }
    knownIds = ids;
    primed = true;

    data = next;
    render();
    $('foot').textContent =
      'Updated ' + new Date().toLocaleTimeString('en-IN', IST) +
      ' · refreshes by itself · spreadsheet kept current at ' + (next.spreadsheet || '');
  } catch (err) {
    $('foot').textContent = 'Could not reach the local server (' + err.message +
      '). Is "npm run inbox" still running?';
  }
}

/* ---- wiring ----------------------------------------------------------- */

$('q').addEventListener('input', render);
for (const t of ['bookings', 'drivers']) {
  $('tab-' + t).addEventListener('click', () => { tab = t; open.clear(); render(); });
}
$('seen').addEventListener('click', async () => {
  await fetch(api('/api/seen', '&tab=' + tab), { method: 'POST' });
  await poll();
});
$('bell').addEventListener('click', async () => {
  if (typeof Notification === 'undefined') { $('bell').textContent = 'Not supported'; return; }
  const p = await Notification.requestPermission();
  $('bell').textContent = p === 'granted' ? 'Alerts on' : 'Alerts blocked';
  if (p === 'granted') beep();
});
$('xls').addEventListener('click', () => {
  $('foot').textContent = 'Spreadsheet: ' + (data.spreadsheet || 'not written yet');
});

poll();
setInterval(poll, 10000);
`;

/* -------------------------------------------------------------------- boot */

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      // The empty "" is the window title argument; without it `start` eats the URL.
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // Printing the URL is the fallback, and it is printed either way.
  }
}

async function main() {
  serviceAccount = await loadServiceAccount();
  await Promise.all([loadState(), loadNotifyConfig()]);

  console.log(`key    ${serviceAccount._file}`);
  console.log(
    `       id ${serviceAccount.private_key_id ?? '(unknown)'}  project ${serviceAccount.project_id}`,
  );
  console.log(
    notifyConfig?.channel
      ? `alerts ${notifyConfig.channel}${notifyConfig.includeDetails ? ' (with customer details)' : ' (no customer details)'}`
      : 'alerts desktop only — see the WhatsApp setup notes to add phone alerts',
  );

  await refresh({ notify: false });
  console.log(`read   ${snapshot.bookings.length} bookings, ${snapshot.drivers.length} driver applications`);

  const url = `http://${HOST}:${PORT}/?k=${KEY}`;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, resolve);
  });

  console.log(`\nInbox  ${url}`);
  console.log('       This link only works on this computer, and only until you stop the server.');
  console.log('       Press Ctrl+C to stop.\n');
  // Only pop a browser window when a human is watching a real terminal. Under a
  // pipe (CI, a task runner, a log file) an unexpected window is just noise.
  if (process.stdout.isTTY) openBrowser(url);

  setInterval(() => {
    refresh({ notify: true }).catch((err) => {
      snapshot = { ...snapshot, error: `Could not refresh: ${err.message}` };
      console.warn(`   refresh failed: ${err.message}`);
    });
  }, POLL_MS);
}

main().catch((err) => {
  console.error(`\n${err.message}\n`);
  process.exitCode = 1;
});
