/**
 * Export every website lead to a spreadsheet you can open in Excel.
 *
 *     npm run leads
 *
 * Why a local script instead of a page on the website: firestore.rules deny ALL
 * reads from the browser, deliberately — so a leaked API key can never be used to
 * dump your customers' names, mobile numbers and home addresses. This script
 * authenticates as a Google service account instead, which is checked server-side,
 * so the data goes straight from Firestore to a file on your own machine and the
 * public site keeps its read-denied posture exactly as it is.
 *
 * ONE-TIME SETUP — get your key file:
 *   1. Firebase console -> gear icon -> Project settings -> "Service accounts"
 *   2. Press "Generate new private key" -> Generate key. A .json file downloads.
 *   3. Rename it to  serviceAccount.json  and put it in  <your home>/.drivebuddy/
 *      NOT in the project folder: this repo is public, and Google automatically
 *      disables any key it finds published, so a committed key dies within minutes.
 *      Treat it like a password. Never commit it, never email it, never paste it in chat.
 *
 * After that, any time you want the latest leads:  npm run leads
 */

import { createSign } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ExcelJS from 'exceljs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'exports');
const SCOPE = 'https://www.googleapis.com/auth/datastore';

/**
 * The key lives OUTSIDE the repo, in your home folder. That is deliberate: this
 * repo is public, and a key stored inside the project folder can be published by
 * one careless drag-and-drop or web upload — .gitignore does not protect against
 * uploading through github.com. Google disables keys it finds in public repos, so
 * a published key stops working anyway. Keeping it here makes that impossible.
 */
const KEY_FILE = path.join(homedir(), '.drivebuddy', 'serviceAccount.json');

/** India has no daylight saving, so a fixed +5:30 is exact all year. */
const IST_OFFSET_MIN = 330;

/** Mirrors `bookingPackages` in lib/content.ts — keep the two in step. */
const SERVICE_LABELS = {
  '1-hour-300': '1 Hour — ₹300',
  '3-hours-600': '3 Hours — ₹600',
  'local-full-day': 'Local Full Day, 8 hrs — ₹1000–1200',
  outstation: 'Outstation Trip — ₹1200–1500',
  'night-driver': 'Night Driver, 8 PM – 6 AM — from ₹500',
  'medical-emergency': 'Hospital / Emergency — priority',
};

/** Mirrors the licence values accepted by firestore.rules for /drivers. */
const LICENCE_LABELS = {
  commercial: 'Commercial',
  lmv: 'LMV (private)',
  both: 'Commercial + LMV',
};

/* ------------------------------------------------------------------ helpers */

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const dayName = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' });
const dayKey = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

/**
 * Excel has no concept of time zones: it stores a bare wall-clock serial number.
 * Shifting the instant by the IST offset makes the cell *display* IST, which is
 * what the dispatch team actually wants to read.
 */
const toIstWallClock = (date) => new Date(date.getTime() + IST_OFFSET_MIN * 60_000);

/** Turn Firestore's typed REST values into plain JS. */
function decodeValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields ?? {});
  return null;
}

function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decodeValue(v)]));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `2026-08-30T14:30` (what the form's datetime-local input produces) -> readable.
 * Parsed by hand rather than through `new Date`: the customer typed a wall-clock
 * time, so it must render back identically no matter where this script is run.
 */
function readablePreferredTime(raw) {
  if (!raw) return 'As soon as possible';
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(raw));
  if (!m) return String(raw);
  const [, y, mo, d, hh, mi] = m;
  const hour24 = Number(hh);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const suffix = hour24 < 12 ? 'am' : 'pm';
  return `${d} ${MONTHS[Number(mo) - 1]} ${y}, ${hour12}:${mi} ${suffix}`;
}

/* --------------------------------------------------------------------- auth */

const SETUP_HELP = `
Could not find your service-account key.

  1. Open  console.firebase.google.com  -> gear icon -> Project settings
  2. "Service accounts" tab -> "Generate new private key" -> Generate key
  3. Rename the downloaded file to  serviceAccount.json
  4. Put it in:  ${path.dirname(KEY_FILE)}

Do NOT put it in the project folder and do NOT upload it to GitHub — this repo is
public, and Google automatically disables any key it finds published, so the key
would stop working within minutes.

Then run  npm run leads  again.
`;

async function loadServiceAccount() {
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    KEY_FILE,
    // Older location, still honoured so an existing setup keeps working — but it
    // sits inside the repo, so loadServiceAccount warns when a key is found here.
    path.join(ROOT, 'serviceAccount.json'),
    path.join(ROOT, 'service-account.json'),
  ].filter(Boolean);

  for (const file of candidates) {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (parsed.client_email && parsed.private_key && parsed.project_id) {
        if (path.resolve(file).startsWith(ROOT + path.sep)) {
          console.warn(
            `\n!  Your key is inside the project folder, which is a public repo.\n` +
              `   Move it to  ${KEY_FILE}  so it cannot be published by accident.\n`,
          );
        }
        return { ...parsed, _file: file };
      }
      throw new Error(
        `${file} is not a service-account key (missing client_email / private_key / project_id).`,
      );
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  throw new Error(SETUP_HELP);
}

/** Exchange the key for a short-lived OAuth token (RFC 7523 JWT bearer flow). Exported for tests. */
export async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const unsigned = [
    b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
    b64url(
      JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 }),
    ),
  ].join('.');

  const signature = createSign('RSA-SHA256')
    .update(unsigned)
    .sign(sa.private_key.replace(/\\n/g, '\n'), 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const detail = body.error_description || body.error || '';
    // "Invalid JWT Signature" means the maths was fine but Google has no matching
    // public key on file — i.e. this key has been deleted or disabled, not mistyped.
    const revoked = /signature/i.test(detail);
    throw new Error(
      `Google rejected the key (HTTP ${res.status}). ${detail}\n` +
        `  key id   ${sa.private_key_id ?? '(unknown)'}\n` +
        `  account  ${sa.client_email}\n\n` +
        (revoked
          ? 'This key is no longer active on Google\'s side — it was deleted or disabled.\n' +
            'The usual cause is the key being published: Google scans public repos and\n' +
            'disables any key it finds, so a key committed to GitHub dies within minutes.\n\n' +
            'Get a fresh one:\n' +
            '  console.firebase.google.com -> gear -> Project settings -> Service accounts\n' +
            '  -> "Generate new private key"\n' +
            `Save it as  ${KEY_FILE}\n` +
            'Do not put it in the project folder and do not upload it to GitHub.'
          : 'Generate a new key and replace your serviceAccount.json.'),
    );
  }
  return body.access_token;
}

/* -------------------------------------------------------------------- fetch */

/** Page through a whole collection. Newest first; sorted here so no Firestore index is needed. */
async function listCollection(projectId, token, collectionName) {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionName}`;
  const rows = [];
  let pageToken;

  do {
    const url = new URL(base);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Could not read /${collectionName} (HTTP ${res.status}). ${detail.slice(0, 300)}`);
    }
    const body = await res.json();

    for (const doc of body.documents ?? []) {
      rows.push({
        id: doc.name.split('/').pop(),
        ...decodeFields(doc.fields ?? {}),
        // Firestore's own createTime is the reliable fallback if createdAt is ever absent.
        _created: decodeValue(doc.fields?.createdAt) ?? new Date(doc.createTime),
      });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);

  return rows.sort((a, b) => b._created - a._created);
}

/* ----------------------------------------------------------------- workbook */

const DATE_FMT = 'dd mmm yyyy  h:mm AM/PM';

/** Bold header, frozen top row, filter arrows — the sheet is usable the moment it opens. */
function styleSheet(sheet, columns) {
  sheet.columns = columns;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FF0C0A09' } };
  header.height = 22;
  header.alignment = { vertical: 'middle' };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFFCD34D' } } };
  });
  sheet.autoFilter = { from: 'A1', to: { row: 1, column: columns.length } };
}

function addBookingsSheet(workbook, bookings) {
  const sheet = workbook.addWorksheet('Bookings', { properties: { defaultRowHeight: 18 } });
  styleSheet(sheet, [
    { header: '#', key: 'n', width: 6 },
    { header: 'Received (IST)', key: 'received', width: 23, style: { numFmt: DATE_FMT } },
    { header: 'Day', key: 'day', width: 7 },
    { header: 'Name', key: 'name', width: 22 },
    { header: 'Mobile', key: 'phone', width: 15 },
    { header: 'City', key: 'city', width: 11 },
    { header: 'Service booked', key: 'service', width: 34 },
    { header: 'Pickup address', key: 'pickup', width: 38 },
    { header: 'Wanted for', key: 'preferred', width: 22 },
    { header: 'Notes', key: 'notes', width: 32 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Booking ID', key: 'id', width: 24 },
  ]);

  bookings.forEach((b, i) => {
    sheet.addRow({
      n: i + 1,
      received: toIstWallClock(b._created),
      day: dayName.format(b._created),
      name: b.name ?? '',
      phone: b.phone ? `${b.phone}` : '',
      city: b.city ?? '',
      service: SERVICE_LABELS[b.package] ?? b.package ?? '',
      pickup: b.pickup ?? '',
      preferred: readablePreferredTime(b.preferredTime),
      notes: b.notes || '—',
      status: b.status ?? '',
      id: b.id,
    });
  });

  sheet.getColumn('pickup').alignment = { wrapText: true, vertical: 'top' };
  sheet.getColumn('notes').alignment = { wrapText: true, vertical: 'top' };
  return sheet;
}

function addDriversSheet(workbook, drivers) {
  const sheet = workbook.addWorksheet('Driver applications', {
    properties: { defaultRowHeight: 18 },
  });
  styleSheet(sheet, [
    { header: '#', key: 'n', width: 6 },
    { header: 'Received (IST)', key: 'received', width: 23, style: { numFmt: DATE_FMT } },
    { header: 'Day', key: 'day', width: 7 },
    { header: 'Name', key: 'name', width: 22 },
    { header: 'Mobile', key: 'phone', width: 15 },
    { header: 'City', key: 'city', width: 11 },
    { header: 'Experience (yrs)', key: 'years', width: 16 },
    { header: 'Licence', key: 'licence', width: 18 },
    { header: 'About', key: 'about', width: 44 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Application ID', key: 'id', width: 24 },
  ]);

  drivers.forEach((d, i) => {
    sheet.addRow({
      n: i + 1,
      received: toIstWallClock(d._created),
      day: dayName.format(d._created),
      name: d.name ?? '',
      phone: d.phone ? `${d.phone}` : '',
      city: d.city ?? '',
      years: d.experienceYears ?? '',
      licence: LICENCE_LABELS[d.licence] ?? d.licence ?? '',
      about: d.about || '—',
      status: d.status ?? '',
      id: d.id,
    });
  });

  sheet.getColumn('about').alignment = { wrapText: true, vertical: 'top' };
  return sheet;
}

/** Count occurrences of a field, most common first. */
function tally(rows, pick) {
  const counts = new Map();
  for (const row of rows) {
    const key = pick(row) || '(not set)';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function addSummarySheet(workbook, bookings, drivers) {
  const sheet = workbook.addWorksheet('Summary', { properties: { defaultRowHeight: 18 } });
  sheet.columns = [
    { key: 'a', width: 40 },
    { key: 'b', width: 14 },
  ];

  const title = sheet.addRow(['DriveBuddy — leads summary']);
  title.font = { bold: true, size: 14 };
  sheet.addRow(['Generated', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })]);
  sheet.addRow([]);

  const block = (heading, pairs) => {
    const head = sheet.addRow([heading]);
    head.font = { bold: true };
    head.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFEF3C7' },
    };
    if (pairs.length === 0) sheet.addRow(['(none yet)', '']);
    for (const [label, value] of pairs) sheet.addRow([label, value]);
    sheet.addRow([]);
  };

  const newest = bookings[0]?._created;
  const oldest = bookings.at(-1)?._created;
  const dayStamp = (d) => (d ? dayKey.format(d) : '—');

  block('Totals', [
    ['Booking requests', bookings.length],
    ['Driver applications', drivers.length],
    ['Most recent booking', dayStamp(newest)],
    ['First booking', dayStamp(oldest)],
  ]);
  block(
    'Bookings by city',
    tally(bookings, (b) => b.city),
  );
  block(
    'Bookings by service',
    tally(bookings, (b) => SERVICE_LABELS[b.package] ?? b.package),
  );
  block(
    'Bookings by day (IST)',
    tally(bookings, (b) => dayKey.format(b._created)).slice(0, 21),
  );
  return sheet;
}

/** Exported for scripts/export-leads.test.mjs — pure, no network. */
export function buildWorkbook(bookings, drivers) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DriveBuddy';
  workbook.created = new Date();
  addSummarySheet(workbook, bookings, drivers);
  addBookingsSheet(workbook, bookings);
  addDriversSheet(workbook, drivers);
  return workbook;
}

/* --------------------------------------------------------------------- main */

async function main() {
  const sa = await loadServiceAccount();
  console.log(`key    ${path.basename(sa._file)}  (project ${sa.project_id})`);

  const token = await getAccessToken(sa);
  const [bookings, drivers] = await Promise.all([
    listCollection(sa.project_id, token, 'bookings'),
    listCollection(sa.project_id, token, 'drivers'),
  ]);
  console.log(`read   ${bookings.length} bookings, ${drivers.length} driver applications`);

  await mkdir(OUT_DIR, { recursive: true });
  const stamp = new Date(Date.now() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 16).replace('T', '_').replace(':', '');
  const file = path.join(OUT_DIR, `drivebuddy-leads_${stamp}.xlsx`);

  await buildWorkbook(bookings, drivers).xlsx.writeFile(file);
  console.log(`\nSaved  ${file}\nOpen it in Excel — the Bookings sheet is newest first.`);
}

// Only run when invoked directly, so the test can import buildWorkbook cleanly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\n${err.message}\n`);
    // Set the code rather than calling process.exit(): exiting while stderr is
    // still flushing trips a libuv assertion on Windows, which buries the
    // message we just printed under a C stack trace.
    process.exitCode = 1;
  });
}
