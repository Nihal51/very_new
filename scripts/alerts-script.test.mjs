/**
 * apps-script/Code.js runs on Google's servers, not here — so this test loads it
 * into a sandbox with stand-ins for the Apps Script services, a small in-memory
 * Firestore that speaks the same REST shapes (runQuery, get, commit) and an
 * in-memory spreadsheet. It checks the whole robot: numbering, customer
 * records, timeline, alerts, the live Sheet copy, reminders, driver alerts, and
 * that nothing is alerted twice.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, test } from 'node:test';
import vm from 'node:vm';

const CODE = readFileSync(new URL('../apps-script/Code.js', import.meta.url), 'utf8');
const BASE = 'https://firestore.googleapis.com/v1/projects/drive-buddy-acc4c/databases/(default)/documents';
const PREFIX = 'projects/drive-buddy-acc4c/databases/(default)/documents/';

/* ------------------------------------------------- fake Firestore (REST) */

function makeStore() {
  const docs = new Map(); // path → fields (REST typed values)
  const val = (v) => {
    if (!v) return null;
    if ('timestampValue' in v) return Date.parse(v.timestampValue);
    if ('integerValue' in v) return Number(v.integerValue);
    if ('stringValue' in v) return v.stringValue;
    if ('booleanValue' in v) return v.booleanValue;
    return null;
  };
  const matches = (fields, where) => {
    if (!where) return true;
    if (where.compositeFilter) return where.compositeFilter.filters.every((f) => matches(fields, f));
    const { field, op, value } = where.fieldFilter;
    const a = val(fields[field.fieldPath]);
    const b = val(value);
    if (a === null) return false;
    return op === 'EQUAL' ? a === b : op === 'GREATER_THAN_OR_EQUAL' ? a >= b : op === 'LESS_THAN_OR_EQUAL' ? a <= b : false;
  };
  return {
    docs,
    queries: [],
    get(path) {
      return docs.has(path) ? { name: PREFIX + path, fields: docs.get(path) } : null;
    },
    runQuery(q) {
      this.queries.push(q);
      const col = q.from[0].collectionId;
      const by = q.orderBy[0].field.fieldPath;
      const dir = q.orderBy[0].direction === 'ASCENDING' ? 1 : -1;
      // Like Firestore: documents without the order-by field are left out.
      return [...docs.entries()]
        .filter(([p]) => p.startsWith(`${col}/`) && p.split('/').length === 2)
        .filter(([, f]) => f[by] !== undefined && matches(f, q.where))
        .sort(([, a], [, b]) => dir * (val(a[by]) - val(b[by])))
        .slice(0, q.limit)
        .map(([p, f]) => ({ document: { name: PREFIX + p, fields: f } }));
    },
    /** listDocuments: the documents directly inside a collection path. */
    list(collectionPath) {
      const depth = collectionPath.split('/').length + 1;
      return [...docs.entries()]
        .filter(([p]) => p.startsWith(`${collectionPath}/`) && p.split('/').length === depth)
        .map(([p, f]) => ({ name: PREFIX + p, fields: f }));
    },
    commit(writes) {
      for (const w of writes) {
        if (w.delete) {
          docs.delete(w.delete.replace(PREFIX, ''));
          continue;
        }
        const path = w.update.name.replace(PREFIX, '');
        const exists = docs.has(path);
        if (w.currentDocument?.exists === true && !exists) throw new Error(`precondition: ${path} missing`);
        if (w.currentDocument?.exists === false && exists) throw new Error(`precondition: ${path} exists`);
        const next = w.updateMask ? { ...(docs.get(path) ?? {}) } : {};
        for (const k of w.updateMask?.fieldPaths ?? Object.keys(w.update.fields)) next[k] = w.update.fields[k];
        for (const t of w.updateTransforms ?? []) {
          if (t.increment) next[t.fieldPath] = { integerValue: String((val(next[t.fieldPath]) ?? 0) + Number(t.increment.integerValue)) };
          if (t.appendMissingElements) {
            const cur = next[t.fieldPath]?.arrayValue?.values ?? [];
            const add = t.appendMissingElements.values.filter((v) => !cur.some((c) => c.stringValue === v.stringValue));
            next[t.fieldPath] = { arrayValue: { values: [...cur, ...add] } };
          }
        }
        docs.set(path, next);
      }
      return {};
    },
  };
}

/* ------------------------------------------------- fake spreadsheet */

function makeSheet(name) {
  const grid = []; // grid[row][col], 0-based
  const cell = (r, c) => grid[r]?.[c] ?? '';
  const set = (r, c, v) => {
    while (grid.length <= r) grid.push([]);
    grid[r][c] = v;
  };
  const key = (v) => (v instanceof Date ? v.getTime() : v === '' ? -Infinity : v);
  return {
    grid,
    getName: () => name,
    getLastRow: () => grid.length,
    getLastColumn: () => Math.max(0, ...grid.map((r) => r.length)),
    getMaxRows: () => 1000,
    insertRowsAfter() {},
    appendRow: (row) => grid.push([...row]),
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r - 1 + i, c - 1 + j))),
        setValues: (vals) => vals.forEach((row, i) => row.forEach((v, j) => set(r - 1 + i, c - 1 + j, v))),
        setValue: (v) => set(r - 1, c - 1, v),
        sort({ column, ascending }) {
          const part = grid.slice(r - 1, r - 1 + nr);
          part.sort((a, b) => {
            const x = key(a[column - 1] ?? ''), y = key(b[column - 1] ?? '');
            return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1);
          });
          grid.splice(r - 1, nr, ...part);
        },
      };
    },
  };
}

/* --------------------------------------------------- the sandbox */

function load() {
  const store = makeStore();
  const props = new Map([
    ['TELEGRAM_BOT_TOKEN', '123:abc'],
    ['TELEGRAM_CHAT_ID', '555'],
    ['ADMIN_EMAILS', 'owner@example.com'],
  ]);
  const telegram = [];
  const mail = [];
  const sheets = new Map();
  const pushes = []; // every message sent to Expo's push service
  const whatsapps = []; // every WhatsApp Cloud API request
  const warnings = [];
  const deadTokens = new Set(); // tokens Expo answers with DeviceNotRegistered

  const response = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
  const ctx = {
    console: { log() {}, warn: (m) => warnings.push(String(m)), error(e) { throw new Error(`robot logged an error: ${e}`); } },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => props.get(k) ?? null,
        setProperty: (k, v) => props.set(k, v),
      }),
    },
    ScriptApp: { getOAuthToken: () => 'token', getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create() {} }) }) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    CacheService: (() => {
      const c = new Map();
      return { getScriptCache: () => ({ get: (k) => c.get(k) ?? null, put: (k, v) => c.set(k, v), clear: () => c.clear() }) };
    })(),
    ContentService: { createTextOutput: (t) => ({ text: t }) },
    Utilities: { getUuid: () => Math.random().toString(16).slice(2) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    MailApp: { sendEmail: (m) => mail.push(m) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => sheets.get(n) ?? null,
        insertSheet: (n) => {
          const s = makeSheet(n);
          sheets.set(n, s);
          return s;
        },
      }),
    },
    UrlFetchApp: {
      fetch(url, opts = {}) {
        const body = opts.payload ? JSON.parse(opts.payload) : null;
        if (url.startsWith('https://api.telegram.org/')) {
          if (url.endsWith('/sendMessage')) telegram.push(body);
          return response(200, { ok: true, result: [] });
        }
        if (url === 'https://exp.host/--/api/v2/push/send') {
          pushes.push(...body);
          return response(200, {
            data: body.map((m) =>
              deadTokens.has(m.to) ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'r' },
            ),
          });
        }
        if (url.startsWith('https://graph.facebook.com/')) {
          whatsapps.push({ url, auth: opts.headers?.Authorization, body });
          return response(200, { messages: [{ id: 'wamid.1' }] });
        }
        if (url.startsWith(`${BASE}/`) && url.includes('?pageSize=')) {
          return response(200, { documents: store.list(url.slice(BASE.length + 1).split('?')[0]) });
        }
        if (url === `${BASE}:runQuery`) return response(200, store.runQuery(body.structuredQuery));
        if (url === `${BASE}:commit`) return response(200, store.commit(body.writes));
        const doc = store.get(url.slice(BASE.length + 1));
        return doc ? response(200, doc) : response(404, {});
      },
    },
    module: { exports: {} },
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);

  /** The sheet as [{ heading: value }], top to bottom. */
  const table = (name) => {
    const g = sheets.get(name)?.grid ?? [];
    const [head = [], ...rows] = g;
    return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
  };
  return { ctx, store, props, telegram, mail, sheets, table, pushes, whatsapps, warnings, deadTokens };
}

const ts = (msAgo) => ({ timestampValue: new Date(Date.now() - msAgo).toISOString() });
const s = (v) => ({ stringValue: v });
function seedBooking(store, id, { msAgo = 60_000, phone = '9111473929', extra = {} } = {}) {
  store.docs.set(`bookings/${id}`, {
    name: s('Ramesh Sahu'), phone: s(phone), city: s('Raipur'), package: s('3-hours-600'),
    pickup: s('Shankar Nagar'), preferredTime: s(''), notes: s(''), status: s('new'), source: s('website'),
    createdAt: ts(msAgo), ...extra,
  });
}

/* --------------------------------------------------- tests */

describe('the alerts robot', () => {
  let env;
  beforeEach(() => (env = load()));

  test('numbers a new booking, records the customer and timeline, alerts once', () => {
    seedBooking(env.store, 'b1');
    env.ctx.processBookings_();

    const b = env.store.docs.get('bookings/b1');
    assert.equal(b.ref.stringValue, 'DB-1001');
    assert.equal(b.alerts.mapValue.fields.telegram.stringValue, 'sent');
    assert.ok(b.updatedAt, 'updatedAt set so the Sheet sync picks it up');
    assert.equal(env.store.docs.get('meta/counters').bookings.integerValue, '1');
    assert.equal(env.store.docs.get('customers/9111473929').bookingsCount.integerValue, '1');
    assert.ok([...env.store.docs.keys()].some((p) => p.startsWith('bookings/b1/events/')));
    assert.equal(env.telegram.length, 1);
    assert.ok(env.telegram[0].text.includes('DB-1001'));
    assert.ok(env.telegram[0].text.includes('New customer'));
    assert.equal(env.mail.length, 1);

    env.ctx.processBookings_(); // next minute: nothing new
    assert.equal(env.telegram.length, 1);
  });

  test('a second booking from the same phone is DB-1002 and flagged returning', () => {
    seedBooking(env.store, 'b1', { msAgo: 120_000 });
    seedBooking(env.store, 'b2', { msAgo: 60_000, extra: { customerUid: s('uid-7') } });
    env.ctx.processBookings_();

    assert.equal(env.store.docs.get('bookings/b2').ref.stringValue, 'DB-1002');
    const c = env.store.docs.get('customers/9111473929');
    assert.equal(c.bookingsCount.integerValue, '2');
    assert.deepEqual(c.uids.arrayValue.values, [{ stringValue: 'uid-7' }]);
    assert.ok(env.telegram[1].text.includes('Returning customer (1 earlier booking)'));
    assert.ok(env.telegram[1].text.includes('Booked while logged in'));
  });

  test('bookings older than the bookmark are left alone', () => {
    env.props.set('lastBookingMs', String(Date.now() - 30_000));
    seedBooking(env.store, 'old', { msAgo: 10 * 60_000 });
    env.ctx.processBookings_();
    assert.equal(env.telegram.length, 0);
    assert.equal(env.store.docs.get('bookings/old').ref, undefined);
  });

  test('a flood of bookings is numbered in full but alerted once, not 15 times', () => {
    for (let i = 0; i < 15; i++) seedBooking(env.store, `spam${i}`, { msAgo: 60_000 - i, phone: `98765000${String(i).padStart(2, '0')}` });
    env.ctx.processBookings_();
    const numbered = [...env.store.docs.keys()].filter((p) => /^bookings\/spam\d+$/.test(p) && env.store.docs.get(p).ref);
    assert.equal(numbered.length, 15, 'every booking still gets a DB-number and reaches the admin panel');
    assert.equal(env.telegram.length, 3 + 1, 'three individual alerts and one summary');
    assert.ok(env.telegram[3].text.includes('15 new bookings at once'));
    assert.equal(env.mail.length, 3 + 1);
    const held = env.store.docs.get('bookings/spam14').alerts.mapValue.fields.telegram.stringValue;
    assert.equal(held, 'held-flood');
  });

  test('normal traffic is alerted one by one', () => {
    for (let i = 0; i < 5; i++) seedBooking(env.store, `b${i}`, { msAgo: 60_000 - i });
    env.ctx.processBookings_();
    assert.equal(env.telegram.length, 5);
  });

  test('a booking still new after 10 minutes gets exactly one reminder', () => {
    seedBooking(env.store, 'late', { msAgo: 15 * 60_000, extra: { ref: s('DB-1009') } });
    seedBooking(env.store, 'handled', { msAgo: 15 * 60_000, extra: { ref: s('DB-1008'), status: s('confirmed') } });
    seedBooking(env.store, 'fresh', { msAgo: 2 * 60_000, extra: { ref: s('DB-1010') } });
    env.ctx.remindUnhandled_();
    env.ctx.remindUnhandled_();
    assert.equal(env.telegram.length, 1);
    assert.ok(env.telegram[0].text.includes('Not handled yet: DB-1009'));
    assert.ok(env.store.docs.get('bookings/late').reminderSentAt);
  });

  test('the website ping sends the alert at once, and a burst of pings is one run', () => {
    seedBooking(env.store, 'b1');
    const out = env.ctx.doPost();
    assert.equal(out.text, 'ok');
    assert.equal(env.telegram.length, 1);
    assert.equal(env.store.docs.get('bookings/b1').ref.stringValue, 'DB-1001');
    assert.equal(env.table('Bookings')[0].Ref, 'DB-1001');

    seedBooking(env.store, 'b2', { msAgo: 1_000 });
    const queriesBefore = env.store.queries.length;
    env.ctx.doPost(); // within 3 seconds: merged, nothing runs
    assert.equal(env.store.queries.length, queriesBefore);
    env.ctx.tick(); // the minute check still catches it
    assert.equal(env.telegram.length, 2);
  });

  test('every query is on one field only, so Firestore needs no composite index', () => {
    seedBooking(env.store, 'b1');
    env.ctx.tick();
    env.ctx.remindUnhandled_();
    const fieldsOf = (w) =>
      !w ? [] : w.compositeFilter ? w.compositeFilter.filters.flatMap(fieldsOf) : [w.fieldFilter.field.fieldPath];
    for (const q of env.store.queries) {
      const fields = new Set([...fieldsOf(q.where), q.orderBy[0].field.fieldPath]);
      assert.equal(fields.size, 1, JSON.stringify(q));
    }
  });

  test('a driver application is alerted once and lands in the Drivers sheet', () => {
    env.store.docs.set('drivers/d1', {
      name: s('Suresh Verma'), phone: s('9893302783'), city: s('Bhilai'), experienceYears: { integerValue: '7' },
      licence: s('lmv'), about: s(''), status: s('new'), source: s('website'), createdAt: ts(30_000),
    });
    env.ctx.tick();
    env.ctx.tick();
    assert.equal(env.telegram.length, 1);
    assert.ok(env.telegram[0].text.includes('New driver application'));
    assert.ok(env.telegram[0].text.includes('LMV (private car)'));
    const rows = env.table('Drivers');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].Name, 'Suresh Verma');
    assert.equal(rows[0].Status, 'Applied');
    assert.equal(rows[0].Phone, '98933 02783');
  });
});

describe('the live Sheet copy', () => {
  let env;
  beforeEach(() => (env = load()));

  test('a new booking appears in the Bookings sheet in the same minute', () => {
    seedBooking(env.store, 'b1');
    env.ctx.tick();
    const rows = env.table('Bookings');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].Ref, 'DB-1001');
    assert.equal(rows[0].Status, 'New');
    assert.equal(rows[0].Customer, 'Ramesh Sahu');
    assert.equal(rows[0].Phone, '91114 73929');
    assert.equal(rows[0].Package, '3 hours');
    assert.equal(rows[0]['Trip time'], 'As soon as possible');
    assert.equal(rows[0].ID, 'b1');
    assert.ok(rows[0]['Booked at'] instanceof Date || Object.prototype.toString.call(rows[0]['Booked at']) === '[object Date]');
  });

  test('status and driver changes from the admin panel update the same row', () => {
    seedBooking(env.store, 'b1');
    env.ctx.tick();
    // An admin assigns a driver (the admin panel stamps updatedAt with server time).
    const doc = env.store.docs.get('bookings/b1');
    env.store.docs.set('bookings/b1', {
      ...doc,
      status: s('assigned'),
      assignedDriver: { mapValue: { fields: { id: s('d1'), name: s('Suresh Verma'), phone: s('9893302783') } } },
      updatedAt: { timestampValue: new Date(Date.now() + 5_000).toISOString() },
    });
    env.ctx.tick();
    const rows = env.table('Bookings');
    assert.equal(rows.length, 1, 'updated in place, not duplicated');
    assert.equal(rows[0].Status, 'Driver assigned');
    assert.equal(rows[0].Driver, 'Suresh Verma');
    assert.equal(rows[0]['Driver phone'], '98933 02783');

    env.ctx.tick(); // nothing changed since: no rewrite needed, still one row
    assert.equal(env.table('Bookings').length, 1);
  });

  test('newest bookings are on top, and a column you add yourself is never touched', () => {
    seedBooking(env.store, 'old', { msAgo: 5 * 60_000 });
    env.ctx.tick();
    const sheet = env.sheets.get('Bookings');
    const head = sheet.grid[0];
    head.push('Paid?'); // the owner adds their own column…
    sheet.grid[1][head.length - 1] = 'Yes'; // …and fills it in

    seedBooking(env.store, 'new', { msAgo: 60_000, phone: '9827012345' });
    env.ctx.tick();
    const rows = env.table('Bookings');
    assert.deepEqual(rows.map((r) => r.ID), ['new', 'old']);
    assert.equal(rows[1]['Paid?'], 'Yes', 'the note moved with its booking when the sheet re-sorted');
    assert.equal(rows[0]['Paid?'], '');
  });

  test('a change in the same millisecond as the last one copied is not missed, and nothing is copied twice', () => {
    const t = { timestampValue: new Date(Date.now() - 30_000).toISOString() };
    seedBooking(env.store, 'a', { extra: { ref: s('DB-1001'), updatedAt: t } });
    assert.equal(env.ctx.syncBookingsSheet_(), 1);
    seedBooking(env.store, 'b', { extra: { ref: s('DB-1002'), updatedAt: t } });
    assert.equal(env.ctx.syncBookingsSheet_(), 1);
    assert.equal(env.ctx.syncBookingsSheet_(), 0);
    assert.deepEqual(env.table('Bookings').map((r) => r.ID).sort(), ['a', 'b']);
  });

  test('fillSheet copies every existing booking, including old ones with no DB-number', () => {
    seedBooking(env.store, 'legacy', { msAgo: 30 * 86_400_000 });
    seedBooking(env.store, 'b2', { msAgo: 60_000, extra: { ref: s('DB-1002'), updatedAt: ts(30_000) } });
    env.ctx.fillSheet();
    env.ctx.fillSheet(); // safe to run twice
    const rows = env.table('Bookings');
    assert.deepEqual(rows.map((r) => r.ID), ['b2', 'legacy']);
    assert.equal(rows[1].Ref, '');
  });

  test('customer text is written as text, never as a formula', () => {
    seedBooking(env.store, 'evil', { extra: { name: s('=HYPERLINK("http://x","y")'), notes: s('+91 call me') } });
    env.ctx.tick();
    const [row] = env.table('Bookings');
    assert.ok(row.Customer.startsWith("'="));
    assert.ok(row['Customer notes'].startsWith("'+"));
  });

  test('a cancelled booking shows its reason in the notes column', () => {
    const rec = env.ctx.bookingRecord('x', { status: 'cancelled', cancelReason: 'Customer changed plans', notes: '', name: 'A', phone: '9111473929', package: 'outstation' });
    assert.equal(rec.Status, 'Cancelled');
    assert.equal(rec['Customer notes'], 'Cancelled: Customer changed plans');
  });
});

describe('customer updates', () => {
  let env;
  beforeEach(() => (env = load()));

  const driver = (id, name, phone) => ({ mapValue: { fields: { id: s(id), name: s(name), phone: s(phone) } } });
  let clock = 0;
  /** An admin action in the panel: new fields and a fresh updatedAt. */
  const adminSets = (id, fields) => {
    clock += 5_000;
    env.store.docs.set(`bookings/${id}`, {
      ...env.store.docs.get(`bookings/${id}`),
      ...fields,
      updatedAt: { timestampValue: new Date(Date.now() + clock).toISOString() },
    });
  };
  const device = (uid, id, token, language) =>
    env.store.docs.set(`users/${uid}/devices/${id}`, { token: s(token), platform: s('android'), language: s(language) });

  test('an app customer hears about each step once, on every phone, in each phone’s language', () => {
    seedBooking(env.store, 'b1', { extra: { ref: s('DB-1001'), customerUid: s('u1') } });
    device('u1', 'p1', 'ExponentPushToken[hindiPhone01]', 'hi');
    device('u1', 'p2', 'ExponentPushToken[englishPhone2]', 'en');

    adminSets('b1', { status: s('confirmed') });
    env.ctx.tick();
    assert.equal(env.pushes.length, 2);
    const [hi, en] = env.pushes;
    assert.equal(hi.to, 'ExponentPushToken[hindiPhone01]');
    assert.equal(hi.title, 'बुकिंग कन्फ़र्म');
    assert.equal(en.title, 'Booking confirmed');
    assert.ok(en.body.startsWith('DB-1001'));
    assert.deepEqual(en.data, { bookingId: 'b1' });
    assert.equal(en.channelId, 'bookings');

    env.ctx.tick(); // nothing new: nothing sent
    assert.equal(env.pushes.length, 2);

    adminSets('b1', { status: s('assigned'), assignedDriver: driver('d1', 'Suresh Verma', '9893302783') });
    env.ctx.tick();
    assert.equal(env.pushes.length, 4);
    assert.equal(env.pushes[3].title, 'Driver assigned');
    assert.ok(env.pushes[3].body.includes('Suresh Verma will drive for DB-1001'));
    assert.equal(env.store.docs.get('bookings/b1').pushedKey.stringValue, 'assigned:d1');

    adminSets('b1', { assignedDriver: driver('d2', 'Manoj Patel', '9893300000') }); // a different driver
    env.ctx.tick();
    assert.equal(env.pushes.length, 6);
    assert.ok(env.pushes[5].body.includes('Manoj Patel'));
  });

  test('guests, new bookings and customers without the app get no push', () => {
    seedBooking(env.store, 'guest', { extra: { ref: s('DB-1001') } });
    seedBooking(env.store, 'fresh', { extra: { ref: s('DB-1002'), customerUid: s('u1') } });
    seedBooking(env.store, 'webOnly', { extra: { ref: s('DB-1003'), customerUid: s('u2') } });
    device('u1', 'p1', 'ExponentPushToken[somePhone0001]', 'en');
    adminSets('guest', { status: s('confirmed') });
    adminSets('fresh', { status: s('new') });
    adminSets('webOnly', { status: s('confirmed') });
    env.ctx.tick();
    assert.equal(env.pushes.length, 0);
    assert.equal(env.store.docs.get('bookings/webOnly').pushedKey.stringValue, 'confirmed', 'remembered, not retried every minute');
  });

  test('a phone that uninstalled the app is forgotten', () => {
    seedBooking(env.store, 'b1', { extra: { ref: s('DB-1001'), customerUid: s('u1') } });
    device('u1', 'old', 'ExponentPushToken[uninstalled01]', 'en');
    device('u1', 'new', 'ExponentPushToken[currentPhone1]', 'en');
    env.deadTokens.add('ExponentPushToken[uninstalled01]');
    adminSets('b1', { status: s('confirmed') });
    env.ctx.tick();
    assert.equal(env.store.docs.has('users/u1/devices/old'), false);
    assert.equal(env.store.docs.has('users/u1/devices/new'), true);
  });

  test('customer updates never touch updatedAt, so the Sheet is not rewritten for them', () => {
    seedBooking(env.store, 'b1', { extra: { ref: s('DB-1001'), customerUid: s('u1') } });
    device('u1', 'p1', 'ExponentPushToken[somePhone0001]', 'en');
    adminSets('b1', { status: s('confirmed') });
    const before = env.store.docs.get('bookings/b1').updatedAt.timestampValue;
    env.ctx.tick();
    assert.equal(env.store.docs.get('bookings/b1').updatedAt.timestampValue, before);
  });

  test('WhatsApp stays off until it is set up, then sends the driver details once', () => {
    seedBooking(env.store, 'b1', { extra: { ref: s('DB-1001'), name: s('Ramesh Kumar Sahu'), preferredTime: s('2026-10-09T09:30') } });
    adminSets('b1', { status: s('assigned'), assignedDriver: driver('d1', 'Suresh Verma', '9893302783') });
    env.ctx.tick();
    assert.equal(env.whatsapps.length, 0);
    assert.equal(env.store.docs.get('bookings/b1').whatsappKey, undefined);

    env.props.set('WHATSAPP_TOKEN', 'EAAG-test');
    env.props.set('WHATSAPP_PHONE_ID', '1234567890');
    adminSets('b1', { assignedDriver: driver('d2', 'Manoj Patel', '9893300000') });
    env.ctx.tick();
    env.ctx.tick();
    assert.equal(env.whatsapps.length, 1);
    const w = env.whatsapps[0];
    assert.equal(w.url, 'https://graph.facebook.com/v23.0/1234567890/messages');
    assert.equal(w.auth, 'Bearer EAAG-test');
    assert.equal(w.body.to, '919111473929');
    assert.equal(w.body.template.name, 'driver_assigned');
    assert.equal(w.body.template.language.code, 'en');
    assert.deepEqual(
      w.body.template.components[0].parameters.map((p) => p.text),
      ['Ramesh', 'DB-1001', 'Manoj Patel', '+91 98933 00000', 'Fri 9 Oct, 9:30 AM'],
    );
    const b = env.store.docs.get('bookings/b1');
    assert.equal(b.whatsappAssigned.stringValue, 'sent');
    assert.equal(b.whatsappKey.stringValue, 'assigned:d2');
  });

  test('the app booking is labelled in Telegram and in the timeline', () => {
    seedBooking(env.store, 'b1', { extra: { source: s('app') } });
    env.ctx.processBookings_();
    assert.ok(env.telegram[0].text.includes('Booked in the DriveBuddy app'));
    const event = [...env.store.docs.entries()].find(([p]) => p.startsWith('bookings/b1/events/'))[1];
    assert.equal(event.note.stringValue, 'Booking received from the app');
  });
});

describe('formatting', () => {
  const { ctx } = load();
  test('India time is read as written, never shifted', () => {
    assert.equal(ctx.formatWhen('2026-10-08T15:30'), 'Thu 8 Oct, 3:30 PM');
    assert.equal(ctx.formatWhen(''), 'As soon as possible');
    assert.equal(ctx.formatIst(new Date(Date.UTC(2026, 9, 8, 10, 0))), 'Thu 8 Oct, 3:30 PM');
  });
  test('customer text cannot inject markup into alerts', () => {
    const msg = ctx.bookingTelegram({
      booking: { name: '<b>x</b>', phone: '9111473929', city: 'Raipur', package: 'medical-emergency', pickup: 'a', preferredTime: '', notes: '' },
      id: 'i', ref: 'DB-1001', previousBookings: 0, siteUrl: 'https://thedrivebuddy.in',
    });
    assert.ok(msg.text.startsWith('🚨'));
    assert.ok(msg.text.includes('&lt;b&gt;x&lt;/b&gt;'));
    assert.equal(msg.reply_markup.inline_keyboard[0][0].url, 'https://thedrivebuddy.in/admin/?b=i');
  });
  test('rupees in Indian grouping', () => {
    assert.equal(ctx.inr(950), '950');
    assert.equal(ctx.inr(2450), '2,450');
    assert.equal(ctx.inr(125000), '1,25,000');
  });
  test('an outstation trip shows in the alert, the email and the Sheet', () => {
    const trip = { to: 'Nagpur', destId: 'nagpur', kind: 'one-way', km: 284, days: 1, returnDays: 1, estFrom: 2450, estTo: 2650 };
    const booking = { name: 'A', phone: '9111473929', city: 'Raipur', package: 'one-way-drop', pickup: 'a', preferredTime: '', notes: 'Swift', trip };
    const line = 'Raipur → Nagpur · one-way drop · ~284 km · 1 driving day + 1 return day · est. ₹2,450–2,650';
    assert.equal(ctx.tripLine(booking), line);
    const c = { booking, id: 'i', ref: 'DB-1001', previousBookings: 0, siteUrl: 'https://thedrivebuddy.in' };
    assert.ok(ctx.bookingTelegram(c).text.includes('<b>Trip:</b> ' + line));
    assert.ok(ctx.bookingEmail(c).body.includes('Trip: ' + line + '\nNotes: Swift'));
    assert.equal(ctx.bookingRecord('i', booking)['Customer notes'], 'Trip: ' + line + ' | Swift');

    const round = { ...booking, package: 'outstation', trip: { ...trip, kind: 'round', days: 2, returnDays: 0, estFrom: 2900, estTo: 3300 } };
    assert.equal(ctx.tripLine(round), 'Raipur → Nagpur · round trip · ~284 km · 2 days · est. ₹2,900–3,300');
    const elsewhere = { ...booking, trip: { ...trip, to: 'Jaipur', destId: '', km: 0, returnDays: 0, estFrom: 0, estTo: 0 } };
    assert.equal(ctx.tripLine(elsewhere), 'Raipur → Jaipur (not in our list) · one-way drop · 1 driving day · quote on the call');
    assert.equal(ctx.tripLine({ ...booking, trip: undefined }), '');
  });
  test('column letters', () => {
    assert.equal(ctx.columnLetter(1), 'A');
    assert.equal(ctx.columnLetter(15), 'O');
    assert.equal(ctx.columnLetter(27), 'AA');
  });
  test('Firestore values round-trip', () => {
    const d = new Date('2026-10-08T10:00:00.000Z');
    const back = ctx.fromFields(ctx.toFields({ a: 'x', n: 3, f: 1.5, t: d, z: null, arr: ['p'], m: { k: true } }));
    assert.equal(back.a, 'x');
    assert.equal(back.n, 3);
    assert.equal(back.f, 1.5);
    assert.equal(back.t.getTime(), d.getTime());
    assert.equal(back.z, null);
    assert.equal(back.arr[0], 'p');
    assert.equal(back.m.k, true);
  });
});
