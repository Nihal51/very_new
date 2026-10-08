/**
 * One-time setup for booking alerts and admin access.
 *
 *     npm run setup:alerts
 *
 * Asks four questions, checks each answer works, and stores them as secrets in
 * Google Secret Manager for the Cloud Functions (never in this repo):
 *
 *   TELEGRAM_BOT_TOKEN  from @BotFather — the script tests it
 *   TELEGRAM_CHAT_ID    found automatically when you message your bot
 *   GMAIL_APP_PASSWORD  a Gmail "app password" for the alert email, or skip
 *   ADMIN_EMAILS        the Google account(s) allowed into /admin
 *
 * Needs: `npx firebase-tools login` done once on this computer.
 * Run it again any time to change an answer, then `npm run deploy:backend`.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

const ROOT = path.resolve(import.meta.dirname, '..');
const PROJECT = JSON.parse(readFileSync(path.join(ROOT, '.firebaserc'), 'utf8')).projects.default;
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, fallback = '') => (await rl.question(q)).trim() || fallback;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const say = (s = '') => console.log(s);
const step = (n, s) => say(`\n\x1b[1m${n}. ${s}\x1b[0m`);
const ok = (s) => say(`   \x1b[32m✓\x1b[0m ${s}`);
const bad = (s) => say(`   \x1b[31m✗\x1b[0m ${s}`);

async function tg(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

function setSecret(name, value) {
  const dir = mkdtempSync(path.join(tmpdir(), 'db-secret-'));
  const file = path.join(dir, 'value');
  try {
    writeFileSync(file, value, { mode: 0o600 });
    // On Windows npx needs a shell, and a shell splits paths with spaces (C:\Users\Nihal C\…).
    const quote = (s) => (process.platform === 'win32' ? `"${s}"` : s);
    const r = spawnSync(
      'npx',
      ['--yes', 'firebase-tools@15', 'functions:secrets:set', name, '--data-file', quote(file), '--project', PROJECT, '--force'],
      { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', encoding: 'utf8' },
    );
    if (r.status !== 0) throw new Error((r.stderr || r.stdout || '').trim().split('\n').slice(-3).join('\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

say(`\nDriveBuddy alerts setup — Firebase project: ${PROJECT}`);
say('Press Enter to accept a default shown in [brackets].');

/* -------------------------------------------------------------- Telegram -- */

step(1, 'Telegram bot');
say('   In Telegram, open @BotFather, send /newbot, pick a name (e.g. DriveBuddy Alerts)');
say('   and a username ending in "bot". BotFather replies with a token like 123456:ABC-xyz.');
let token = '';
let botName = '';
for (;;) {
  token = await ask('   Paste the bot token: ');
  const me = await tg(token, 'getMe').catch(() => ({ ok: false }));
  if (me.ok) {
    botName = me.result.username;
    ok(`Bot found: @${botName}`);
    break;
  }
  bad('That token did not work. Copy it again from BotFather (the whole line).');
}

step(2, 'Connect your phone to the bot');
say(`   On your phone, open https://t.me/${botName} , tap START and send "hi".`);
say('   (To alert a whole team, add the bot to a Telegram group and send "hi" there.)');
say('   Waiting for your message…');
const chats = new Map();
const started = Date.now();
while (chats.size === 0 && Date.now() - started < 180_000) {
  const upd = await tg(token, 'getUpdates', { timeout: 0 }).catch(() => ({ ok: false }));
  for (const u of upd.result ?? []) {
    const chat = u.message?.chat ?? u.my_chat_member?.chat;
    if (chat) chats.set(String(chat.id), chat.title ?? [chat.first_name, chat.last_name].filter(Boolean).join(' '));
  }
  if (chats.size === 0) await sleep(2000);
}
if (chats.size === 0) {
  bad('No message arrived in 3 minutes. Run `npm run setup:alerts` again.');
  process.exit(1);
}
for (const [id, name] of chats) ok(`Found chat: ${name} (${id})`);
const chatIds = [...chats.keys()].join(',');
const test = await Promise.all(
  [...chats.keys()].map((chat_id) =>
    tg(token, 'sendMessage', { chat_id, text: '✅ DriveBuddy alerts are connected. New bookings will appear here.' }),
  ),
);
if (test.every((t) => t.ok)) ok('Test message sent — check Telegram.');
else bad('Could not send the test message; continuing anyway.');

/* ----------------------------------------------------------------- Email -- */

step(3, 'Email alerts (optional)');
say('   Alerts are emailed to and from drivebuddyind@gmail.com (change ALERT_EMAIL in functions/.env).');
say('   Gmail needs an "app password": Google Account → Security → 2-Step Verification (turn on)');
say('   → App passwords → create one named "DriveBuddy". It is 16 letters.');
let gmail = await ask('   Paste the app password, or press Enter to skip email alerts: ', 'none');
gmail = gmail === 'none' ? 'none' : gmail.replace(/\s+/g, '');
if (gmail !== 'none' && !/^[a-z]{16}$/i.test(gmail)) bad('That does not look like a 16-letter app password, but it will be saved as typed.');
ok(gmail === 'none' ? 'Email alerts off (Telegram only).' : 'App password noted.');

/* ----------------------------------------------------------------- Admins -- */

step(4, 'Who can open the admin panel (thedrivebuddy.in/admin)');
say('   Google account email(s). Separate several with commas.');
const admins = (await ask('   Admin emails [drivebuddyind@gmail.com]: ', 'drivebuddyind@gmail.com'))
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)
  .join(',');
ok(`Admins: ${admins}`);

/* ---------------------------------------------------------------- Save -- */

step(5, 'Saving to Google Secret Manager');
try {
  for (const [name, value] of [
    ['TELEGRAM_BOT_TOKEN', token],
    ['TELEGRAM_CHAT_ID', chatIds],
    ['GMAIL_APP_PASSWORD', gmail],
    ['ADMIN_EMAILS', admins],
  ]) {
    setSecret(name, value);
    ok(name);
  }
} catch (err) {
  bad('Saving failed:');
  say(`   ${String(err.message).replace(/\n/g, '\n   ')}`);
  say('\n   Most often: not logged in (run `npx firebase-tools login`) or the project is not on the Blaze plan.');
  process.exit(1);
}

say('\nAll set. Now deploy the backend:   npm run deploy:backend\n');
rl.close();
