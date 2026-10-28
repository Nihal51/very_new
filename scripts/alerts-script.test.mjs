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
  const rail = { calls: [], answer: () => ({ code: 404, body: { success: false } }) }; // RailRadar stand-in

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
    ContentService: {
      createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }),
      MimeType: { JSON: 'application/json' },
    },
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
      fetchAll(requests) {
        return requests.map((r) => {
          rail.calls.push({ url: r.url, auth: r.headers?.Authorization });
          const { code, body } = rail.answer(r.url);
          return { getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)) };
        });
      },
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
  return { ctx, store, props, telegram, mail, sheets, table, pushes, whatsapps, warnings, deadTokens, rail };
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

describe('trip clock', () => {
  let env;
  beforeEach(() => (env = load()));
  const at = (iso) => ({ timestampValue: new Date(iso).toISOString() });
  const KEY = 'Ab3dEf6hJk9mNp2qRs5tUv8wXy';
  function seedLink(fields) {
    env.store.docs.set(`tripLinks/${KEY}`, {
      bookingId: s('b1'), ref: s('DB-1042'), to: s('Bengaluru'), kind: s('one-way'), nonstop: { booleanValue: true },
      driverName: s('Suresh Verma'), closed: { booleanValue: false }, createdAt: ts(3_600_000), updatedAt: ts(1000), ...fields,
    });
  }

  test('each tap is copied to the booking and told to Telegram once', () => {
    seedBooking(env.store, 'b1', { extra: { ref: s('DB-1042'), status: s('assigned'), package: s('one-way-drop') } });
    const before = env.store.docs.get('bookings/b1').updatedAt;
    seedLink({ startAt: at('2026-10-29T02:15:00Z'), updatedAt: ts(2000) });
    env.ctx.syncTripClocks_();
    let b = env.store.docs.get('bookings/b1');
    assert.equal(b.clock.mapValue.fields.startAt.timestampValue, '2026-10-29T02:15:00.000Z');
    assert.equal(b.updatedAt, before, 'the robot never touches updatedAt');
    assert.equal(env.telegram.length, 1);
    assert.match(env.telegram[0].text, /DB-1042: trip started/);
    assert.match(env.telegram[0].text, /Suresh Verma left for Bengaluru – Thu 29 Oct, 7:45 AM/);
    assert.match(env.telegram[0].reply_markup.inline_keyboard[0][0].url, /\/admin\/\?b=b1$/);

    env.ctx.syncTripClocks_(); // next minute, nothing new
    assert.equal(env.telegram.length, 1);

    seedLink({ startAt: at('2026-10-29T02:15:00Z'), dropAt: at('2026-10-30T07:10:00Z'), updatedAt: ts(500) });
    env.ctx.syncTripClocks_();
    b = env.store.docs.get('bookings/b1');
    assert.equal(b.clock.mapValue.fields.dropAt.timestampValue, '2026-10-30T07:10:00.000Z');
    assert.equal(env.telegram.length, 2);
    assert.match(env.telegram[1].text, /car dropped in Bengaluru<\/b>\nFri 30 Oct, 12:40 PM – 28 h 55 m after the start/);

    seedLink({ startAt: at('2026-10-29T02:15:00Z'), dropAt: at('2026-10-30T07:10:00Z'), homeAt: at('2026-10-31T20:50:00Z'), updatedAt: ts(100) });
    env.ctx.syncTripClocks_();
    assert.equal(env.telegram.length, 3);
    assert.match(env.telegram[2].text, /Suresh Verma is home<\/b>\nSun 1 Nov, 2:20 AM\. The final bill is ready/);
  });

  test('an admin undoing a tap clears it from the booking, without a Telegram', () => {
    seedBooking(env.store, 'b1', { extra: { clock: { mapValue: { fields: { startAt: at('2026-10-29T02:15:00Z'), dropAt: at('2026-10-29T03:00:00Z') } } } } });
    seedLink({ startAt: at('2026-10-29T02:15:00Z'), updatedAt: ts(100) });
    env.ctx.syncTripClocks_();
    const c = env.store.docs.get('bookings/b1').clock.mapValue.fields;
    assert.ok(c.startAt && !c.dropAt);
    assert.equal(env.telegram.length, 0);
  });

  test('pure helpers', () => {
    const d = (iso) => new Date(iso);
    // (Arrays from the sandbox: compared as plain copies.)
    assert.deepEqual([...env.ctx.tripClockNews({ startAt: d('2026-10-29T02:15:00Z') }, { startAt: d('2026-10-29T02:15:00Z'), dropAt: d('2026-10-30T07:10:00Z') })], ['drop']);
    assert.deepEqual([...env.ctx.tripClockNews(null, { startAt: d('2026-10-29T02:15:00Z') })], ['start']);
    assert.equal(env.ctx.sameClock({ startAt: d('2026-10-29T02:15:00Z') }, { startAt: d('2026-10-29T02:15:00Z') }), true);
    assert.equal(env.ctx.sameClock({}, { startAt: d('2026-10-29T02:15:00Z') }), false);
    assert.equal(env.ctx.hoursText(104_100_000), '28 h 55 m');
    const round = env.ctx.tripTelegram({
      link: { kind: 'round', driverName: 'Raju', to: 'Puri', ref: '', homeAt: d('2026-11-04T05:40:00Z') }, step: 'home', booking: null, id: 'b9', siteUrl: 'https://x',
    });
    assert.match(round.text, /b9: trip over – Raju is back/);
    // Customer text cannot inject markup.
    const evil = env.ctx.tripTelegram({ link: { driverName: '<b>x</b>', to: '<i>', startAt: d('2026-10-29T02:15:00Z') }, step: 'start', booking: { ref: 'DB-1' }, id: 'b1', siteUrl: 'https://x' });
    assert.doesNotMatch(evil.text, /<i>|<b>x/);
  });
});

describe('train lookup (RailRadar proxy)', () => {
  let env;
  beforeEach(() => {
    env = load();
    env.props.set('RAILRADAR_API_KEY', 'rr_live_SECRET123');
  });
  // RailRadar's documented example shape (docs/trains-between-stations).
  const sample = (from, to, trains) => ({
    success: true,
    data: { from: { code: from, name: `${from} Jn` }, to: { code: to, name: `${to} Jn` }, count: trains.length, trains },
    meta: { traceId: 't', timestamp: '2026-10-30T10:00:00Z', executionTime: 5, source: 'database' },
  });
  const train = (number, dep, depDay, arr, arrDay, duration, extra = {}) => ({
    train: { number, name: `Train ${number}`, type: 'Express', runDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
    from: { departure: dep, day: depDay, sequence: 1 },
    to: { arrival: arr, day: arrDay, sequence: 20 },
    distance: 1000, duration, totalHaltsBetween: 10, ...extra,
  });
  const now = Date.parse('2026-10-30T10:00:00+05:30');
  const get = (q, live = '0') => {
    const out = env.ctx.doGet({ parameter: { action: 'trains', q, live } });
    return JSON.parse(out.text);
  };

  test('asks RailRadar with the key in the header only, and passes on the documented fields', () => {
    env.rail.answer = () => ({ code: 200, body: sample('YPR', 'R', [train('12251', '23:40', 1, '00:05', 3, 1465)]) });
    const res = JSON.parse(env.ctx.jsonOut_(env.ctx.trainsLookup_({ q: 'YPR-R-2026-10-31' }, now)).text);
    assert.equal(res.ok, true);
    assert.equal(res.source, 'RailRadar');
    assert.equal(env.rail.calls.length, 1);
    assert.equal(env.rail.calls[0].url, 'https://api.railradar.in/v1/trains/between/YPR/R?date=2026-10-31');
    assert.equal(env.rail.calls[0].auth, 'Bearer rr_live_SECRET123');
    const r = res.results[0];
    assert.equal(r.ok, true);
    assert.equal(r.q, 'YPR-R-2026-10-31');
    assert.equal(r.checkedAt, new Date(now).toISOString());
    assert.deepEqual({ ...r.trains[0], runDays: [...r.trains[0].runDays] }, {
      number: '12251', name: 'Train 12251', type: 'Express', runDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      dep: '23:40', depDay: 1, arr: '00:05', arrDay: 3, duration: 1465, live: null,
    });
    assert.doesNotMatch(JSON.stringify(res), /SECRET123/, 'the key never leaves the robot');
  });

  test('a search is cached for 6 hours: the second visitor costs no call', () => {
    env.rail.answer = () => ({ code: 200, body: sample('YPR', 'R', [train('12251', '23:40', 1, '00:05', 3, 1465)]) });
    env.ctx.trainsLookup_({ q: 'YPR-R-2026-10-31' }, now);
    const again = env.ctx.trainsLookup_({ q: 'YPR-R-2026-10-31' }, now + 60_000);
    assert.equal(env.rail.calls.length, 1);
    assert.equal(again.results[0].checkedAt, new Date(now).toISOString(), 'a cached answer keeps the time it was fetched');
  });

  test('live status only for a run today, and only when asked', () => {
    env.rail.answer = () => ({ code: 200, body: sample('NGP', 'R', [train('12105', '20:00', 1, '23:55', 1, 235, { live: { type: 'upcoming', delayMinutes: 25 } })]) });
    const res = env.ctx.trainsLookup_({ q: 'NGP-R-2026-10-30,NGP-R-2026-11-02', live: '1' }, now);
    assert.equal(env.rail.calls[0].url, 'https://api.railradar.in/v1/trains/between/NGP/R?date=2026-10-30&live=true');
    assert.equal(env.rail.calls[1].url, 'https://api.railradar.in/v1/trains/between/NGP/R?date=2026-11-02');
    assert.equal(res.results[0].live, true);
    assert.equal(res.results[0].trains[0].live.delayMinutes, 25);
    assert.equal(res.results[1].live, false);
    assert.equal(res.results[1].trains[0].live, null, 'a later run never carries a delay');
  });

  test('errors are named, never turned into trains', () => {
    const codes = { YPR: 404, SBC: 429, SMVB: 503, NGP: 401, PUNE: 200 };
    env.rail.answer = (url) => {
      const from = url.split('/between/')[1].split('/')[0];
      return { code: codes[from], body: from === 'PUNE' ? '<html>oops</html>' : { success: false, error: { code: 'X', message: 'x' } } };
    };
    const res = env.ctx.trainsLookup_({ q: 'YPR-R-2026-10-31,SBC-R-2026-10-31,SMVB-R-2026-10-31,NGP-R-2026-10-31,PUNE-R-2026-10-31' }, now);
    assert.deepEqual([...res.results.map((r) => r.error)], ['not-found', 'rate-limited', 'unavailable', 'not-configured', 'bad-response']);
    assert.ok(res.results.every((r) => r.ok === false && !r.trains));
  });

  test('the per-minute and per-day caps stop calls (and say "busy")', () => {
    env.props.set('RAIL_MINUTE_LIMIT', '3');
    env.props.set('RAIL_DAILY_LIMIT', '5');
    env.rail.answer = () => ({ code: 200, body: sample('X', 'R', []) });
    let res = env.ctx.trainsLookup_({ q: 'SC-R-2026-10-31,HYB-R-2026-10-31,KCG-R-2026-10-31,SC-R-2026-11-01' }, now);
    assert.equal(env.rail.calls.length, 3);
    assert.deepEqual([...res.results.map((r) => r.ok)], [true, true, true, false]);
    assert.equal(res.results[3].error, 'busy');
    // Next minute: two more allowed today, then the day is used up.
    res = env.ctx.trainsLookup_({ q: 'SC-R-2026-11-01,HYB-R-2026-11-01,KCG-R-2026-11-01' }, now + 61_000);
    assert.equal(env.rail.calls.length, 5);
    assert.deepEqual([...res.results.map((r) => r.error ?? 'ok')], ['ok', 'ok', 'busy']);
  });

  test('bad or oversized requests and a missing key cost nothing', () => {
    env.rail.answer = () => assert.fail('no call expected');
    for (const q of ['', 'ypr-R-2026-10-31', 'YPR-R-2026-13-01', 'YPR-R-2026-02-30', 'YPR-YPR-2026-10-31', 'YPR-R-2020-01-01', 'YPR-R-2027-12-01', Array(13).fill('YPR-R-2026-10-31').join(',')])
      assert.equal(env.ctx.trainsLookup_({ q }, now).error, 'bad-request', q);
    env.props.delete('RAILRADAR_API_KEY');
    assert.deepEqual({ ...env.ctx.trainsLookup_({ q: 'YPR-R-2026-10-31' }, now) }, { ok: false, error: 'not-configured' });
    assert.equal(env.rail.calls.length, 0);
  });

  test('the doorbell still works on GET without action=trains', () => {
    const out = env.ctx.doGet({ parameter: {} });
    assert.equal(out.text, 'ok');
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
    const trip = { to: 'Delhi', destId: 'delhi', kind: 'one-way', km: 1214, days: 2, returnHours: 38, estFrom: 5620, estTo: 5820 };
    const booking = { name: 'A', phone: '9111473929', city: 'Raipur', package: 'one-way-drop', pickup: 'a', preferredTime: '', notes: 'Swift', trip };
    const line = 'Raipur → Delhi · one-way drop · ~1214 km · 2 days + 38 h getting home · est. ₹5,620–5,820';
    assert.equal(ctx.tripLine(booking), line);
    const c = { booking, id: 'i', ref: 'DB-1001', previousBookings: 0, siteUrl: 'https://thedrivebuddy.in' };
    assert.ok(ctx.bookingTelegram(c).text.includes('<b>Trip:</b> ' + line));
    assert.ok(ctx.bookingEmail(c).body.includes('Trip: ' + line + '\nNotes: Swift'));
    assert.equal(ctx.bookingRecord('i', booking)['Customer notes'], 'Trip: ' + line + ' | Swift');

    const round = { ...booking, package: 'outstation', trip: { ...trip, to: 'Nagpur', destId: 'nagpur', km: 284, kind: 'round', days: 2, returnHours: 0, estFrom: 2900, estTo: 3300 } };
    assert.equal(ctx.tripLine(round), 'Raipur → Nagpur · round trip · ~284 km · 2 days · est. ₹2,900–3,300');
    const nagpur = { ...booking, trip: { ...trip, to: 'Nagpur', destId: 'nagpur', km: 284, days: 1, returnHours: 6, estFrom: 1440, estTo: 1440 } };
    assert.equal(ctx.tripLine(nagpur), 'Raipur → Nagpur · one-way drop · ~284 km · 1 day + 6 h getting home · est. ₹1,440');
    const elsewhere = { ...booking, trip: { ...trip, to: 'Jaipur', destId: '', km: 0, days: 1, returnHours: 0, estFrom: 0, estTo: 0 } };
    assert.equal(ctx.tripLine(elsewhere), 'Raipur → Jaipur (not in our list) · one-way drop · 1 day · quote on the call');
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
