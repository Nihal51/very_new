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
import { createHash } from 'node:crypto';
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
  /** A field by its dotted path ("payment.status"), as Firestore reads map fields. */
  const at = (fields, path) =>
    path.split('.').reduce((f, k, i) => (i === 0 ? f?.[k] : f?.mapValue?.fields?.[k]), fields);
  const matches = (fields, where) => {
    if (!where) return true;
    if (where.compositeFilter) return where.compositeFilter.filters.every((f) => matches(fields, f));
    const { field, op, value } = where.fieldFilter;
    const a = val(at(fields, field.fieldPath));
    const b = val(value);
    if (a === null) return false;
    return op === 'EQUAL' ? a === b : op === 'GREATER_THAN_OR_EQUAL' ? a >= b : op === 'LESS_THAN_OR_EQUAL' ? a <= b : false;
  };
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
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
        .filter(([, f]) => at(f, by) !== undefined && matches(f, q.where))
        .sort(([, a], [, b]) => dir * cmp(val(at(a, by)), val(at(b, by))))
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
  // Every HTTP request the robot makes (each one inside fetchAll too): Apps Script's daily UrlFetch quota.
  const http = { n: 0, urls: [] };
  // Telegram's other methods: getUpdates serves `updates` (from `offset`), the rest are recorded.
  const tg = { updates: [], calls: [] };
  // Razorpay stand-in: links it made, by id; `status` is what a GET answers.
  const rzp = { calls: [], links: new Map(), createCode: 200, n: 0 };
  // Message Central stand-in: logs in, sends code 123456, accepts only that code.
  const mc = {
    calls: [],
    sendCode: 200,
    answer(url, method) {
      if (url.includes('/auth/v1/authentication/token')) return { code: 200, body: { status: 200, token: 'mc-token-1' } };
      if (url.includes('/verification/v3/send')) {
        return this.sendCode === 200
          ? { code: 200, body: { responseCode: 200, message: 'SUCCESS', data: { verificationId: '987654', timeout: '60' } } }
          : { code: this.sendCode, body: { responseCode: this.sendCode, message: 'FAILED' } };
      }
      if (url.includes('/verification/v3/validateOtp')) {
        return /[?&]code=123456(&|$)/.test(url)
          ? { code: 200, body: { responseCode: 200, message: 'SUCCESS', data: { verificationStatus: 'VERIFICATION_COMPLETED' } } }
          : { code: 400, body: { responseCode: 702, message: 'WRONG_OTP_PROVIDED', data: { responseCode: 702 } } };
      }
      return { code: 404, body: {} };
    },
  };

  const response = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
  const ctx = {
    console: { log() {}, warn: (m) => warnings.push(String(m)), error(e) { throw new Error(`robot logged an error: ${e}`); } },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => props.get(k) ?? null,
        setProperty: (k, v) => props.set(k, v),
      }),
    },
    ScriptApp: (() => {
      const made = [];
      const at = (t) => ({
        create: () => made.push(t),
        nearMinute: (m) => ({ create: () => made.push({ ...t, minute: m }) }),
      });
      const timeBased = (fn) => ({
        everyMinutes: () => ({ create: () => made.push({ fn, every: 'minute' }) }),
        everyDays: () => ({ atHour: (h) => at({ fn, every: 'day', hour: h }) }),
        onWeekDay: (day) => ({ atHour: (h) => at({ fn, every: 'week', day, hour: h }) }),
      });
      return {
        made,
        WeekDay: { MONDAY: 'MONDAY' },
        getOAuthToken: () => 'token',
        getProjectTriggers: () => [],
        deleteTrigger() {},
        newTrigger: (fn) => ({ timeBased: () => timeBased(fn) }),
      };
    })(),
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }), getDocumentLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    CacheService: (() => {
      const c = new Map();
      return { getScriptCache: () => ({ get: (k) => c.get(k) ?? null, put: (k, v) => c.set(k, v), clear: () => c.clear() }) };
    })(),
    ContentService: {
      createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }),
      MimeType: { JSON: 'application/json' },
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      sleep() {},
      base64Encode: (t) => Buffer.from(String(t)).toString('base64'),
      base64EncodeWebSafe: (v) => Buffer.from(typeof v === 'string' ? v : Uint8Array.from(v)).toString('base64url') + '==',
      computeRsaSha256Signature: (input, key) => {
        if (!String(key).includes('PRIVATE KEY')) throw new Error('bad key');
        return [...createHash('sha256').update(input).digest()];
      },
    },
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
          if (!r.url.startsWith('https://api.railradar.in/')) return ctx.UrlFetchApp.fetch(r.url, r);
          http.n++;
          http.urls.push(r.url);
          rail.calls.push({ url: r.url, auth: r.headers?.Authorization });
          const { code, body } = rail.answer(r.url);
          return { getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)) };
        });
      },
      fetch(url, opts = {}) {
        http.n++;
        http.urls.push(url.replace(BASE, 'fs') + (opts.payload && url.endsWith(':runQuery') ? ' ' + JSON.parse(opts.payload).structuredQuery.from[0].collectionId : ''));
        const body = opts.payload ? JSON.parse(opts.payload) : null;
        if (url.startsWith('https://api.telegram.org/')) {
          if (url.endsWith('/sendMessage')) telegram.push(body);
          else tg.calls.push({ method: url.split('/').pop(), body });
          if (url.endsWith('/getUpdates') && body) {
            return response(200, { ok: true, result: tg.updates.filter((u) => u.update_id >= (body.offset || 0)) });
          }
          return response(200, { ok: true, result: [] });
        }
        if (url.startsWith('https://api.razorpay.com/v1/payment_links')) {
          rzp.calls.push({ url, method: opts.method, auth: opts.headers?.Authorization, body });
          if (opts.method === 'post') {
            if (rzp.createCode !== 200) return response(rzp.createCode, { error: { code: 'BAD_REQUEST_ERROR', description: 'The contact number is invalid' } });
            const id = `plink_${++rzp.n}`;
            rzp.links.set(id, { id, short_url: `https://rzp.io/i/${id}`, status: 'created', amount: body.amount });
            return response(200, rzp.links.get(id));
          }
          const link = rzp.links.get(url.split('/').pop());
          return link ? response(200, link) : response(404, { error: { description: 'not found' } });
        }
        if (url === 'https://exp.host/--/api/v2/push/send') {
          pushes.push(...body);
          return response(200, {
            data: body.map((m) =>
              deadTokens.has(m.to) ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'r' },
            ),
          });
        }
        if (url.endsWith('/app-config.json')) {
          return response(200, {
            prices: { oneHour: 300, threeHours: 600, twelveHours: 1400, fullDay: { from: 1000, to: 1200 }, nightFrom: 500, localExtraHour: 150 },
            google: { profile: 'https://maps.app.goo.gl/x', writeReview: 'https://search.google.com/local/writereview?placeid=P1' },
            payments: { cashLimit: 2000 },
            // The train check at the drop: a destination's stations (the site publishes every one).
            destinations: [{ id: 'ranchi', name: 'Ranchi', rail: { stations: ['RNC', 'HTE'], hubs: [] } }],
          });
        }
        if (url.startsWith('https://cpaas.messagecentral.com/')) {
          mc.calls.push({ url, method: opts.method, auth: opts.headers?.authToken });
          const { code, body } = mc.answer(url, opts.method);
          return response(code, body);
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
        if (url === `${BASE}:batchGet`) {
          return response(200, body.documents.map((name) => {
            const doc = store.get(name.replace(PREFIX, ''));
            return doc ? { found: doc } : { missing: name };
          }));
        }
        const doc = store.get(url.slice(BASE.length + 1));
        return doc ? response(200, doc) : response(404, {});
      },
    },
    module: { exports: {} },
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  // The robot's schedule reads the minute from nowDate_: the tests set it (default: an even minute, when
  // the app steps run; see "schedule" in Code.js), never the real clock.
  const clock = { minute: 0 };
  ctx.nowDate_ = () => {
    const d = new Date();
    d.setMinutes(clock.minute);
    return d;
  };

  /** The sheet as [{ heading: value }], top to bottom. */
  const table = (name) => {
    const g = sheets.get(name)?.grid ?? [];
    const [head = [], ...rows] = g;
    return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
  };
  return { ctx, store, props, telegram, mail, sheets, table, pushes, whatsapps, warnings, deadTokens, rail, mc, tg, rzp, http, clock };
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
    env.clock.minute = 1; // applications are looked at every ~5 minutes (and at once on the website's doorbell)
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
    // (A full day: a logged-in 1 hour / 3 hours would be confirmed by the robot at once.)
    seedBooking(env.store, 'fresh', { extra: { ref: s('DB-1002'), customerUid: s('u1'), package: s('local-full-day') } });
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

  test('a whole timetable (no date): one call answers every date, cached for 6 hours', () => {
    env.rail.answer = () => ({
      code: 200,
      body: sample('SBC', 'R', [train('12251', '23:40', 1, '00:05', 3, 1465, { train: { number: '12251', name: 'Korba Exp', type: 'Express', runDays: ['wed', 'sat'] } })]),
    });
    const res = env.ctx.trainsLookup_({ q: 'SBC-R,SBC-NGP', live: '1' }, now);
    assert.equal(env.rail.calls[0].url, 'https://api.railradar.in/v1/trains/between/SBC/R', 'no date, and never live');
    assert.equal(env.rail.calls.length, 2);
    const r = res.results[0];
    assert.deepEqual([r.ok, r.q, r.timetable, r.live], [true, 'SBC-R', true, false]);
    assert.deepEqual([...r.trains[0].runDays], ['wed', 'sat']);
    // Another visitor, any date: no call.
    env.ctx.trainsLookup_({ q: 'SBC-R' }, now + 3_600_000);
    assert.equal(env.rail.calls.length, 2);
    // A dated search is still a search of its own.
    assert.equal(env.ctx.trainsLookup_({ q: 'SBC-R-2026-11-04' }, now).results[0].timetable, false);
    assert.equal(env.ctx.parseTrainQueries('SBC-SBC', now), null);
  });

  describe('saved timetables (the Sheet)', () => {
    const tt = (from, n = 1) =>
      sample(from, 'R', Array.from({ length: n }, (_, i) => train(String(12000 + i), '23:40', 1, '00:05', 3, 1465)));
    const coldCache = () => env.ctx.CacheService.getScriptCache().clear();
    const day = 86_400_000;

    test('a fetched timetable is saved, and read back from the Sheet with no call', () => {
      env.rail.answer = () => ({ code: 200, body: tt('JBP', 3) });
      env.ctx.trainsLookup_({ q: 'JBP-R' }, now);
      assert.equal(env.rail.calls.length, 1);
      const rows = env.table('Train timetables');
      assert.deepEqual([rows.length, rows[0].Pair, rows[0].Trains], [1, 'JBP-R', 3]);
      coldCache(); // six hours later: the cache is empty
      const res = env.ctx.trainsLookup_({ q: 'JBP-R' }, now + 6 * 3_600_000);
      assert.equal(env.rail.calls.length, 1, 'answered from the Sheet');
      assert.deepEqual([res.results[0].ok, res.results[0].trains.length, res.results[0].saved], [true, 3, undefined]);
      assert.equal(res.results[0].checkedAt, new Date(now).toISOString(), 'keeps the day it was checked');
    });

    test('a week-old timetable is asked again; if RailRadar fails or is busy, the saved one is used', () => {
      env.rail.answer = () => ({ code: 200, body: tt('JBP', 2) });
      env.ctx.trainsLookup_({ q: 'JBP-R,NGP-R' }, now);
      coldCache();
      env.rail.answer = () => ({ code: 503, body: {} });
      let res = env.ctx.trainsLookup_({ q: 'JBP-R' }, now + 8 * day);
      assert.equal(env.rail.calls.length, 3, 'asked again after a week');
      assert.deepEqual([res.results[0].ok, res.results[0].saved, res.results[0].trains.length], [true, true, 2]);
      coldCache();
      env.props.set('RAIL_DAILY_LIMIT', '1'); // used up by the call above, the same day
      res = env.ctx.trainsLookup_({ q: 'NGP-R,SBC-R' }, now + 8 * day);
      assert.equal(env.rail.calls.length, 3, 'no budget: no call');
      assert.deepEqual([res.results[0].ok, res.results[0].saved], [true, true]);
      assert.deepEqual([res.results[1].ok, res.results[1].error], [false, 'busy'], 'nothing saved: still busy');
      assert.equal(env.telegram.filter((m) => /limit of 1 RailRadar calls is used up/.test(m.text)).length, 1, 'warned once that the day is used up');
    });

    test('a saved timetable older than 60 days is not used', () => {
      env.rail.answer = () => ({ code: 200, body: tt('JBP') });
      env.ctx.trainsLookup_({ q: 'JBP-R' }, now);
      coldCache();
      env.rail.answer = () => ({ code: 503, body: {} });
      const res = env.ctx.trainsLookup_({ q: 'JBP-R' }, now + 61 * day);
      assert.deepEqual([res.results[0].ok, res.results[0].error], [false, 'unavailable']);
    });

    test('if fetching itself throws, the saved timetable is used — and the answer is never an error page', () => {
      env.rail.answer = () => ({ code: 200, body: tt('JBP', 2) });
      env.ctx.trainsLookup_({ q: 'JBP-R' }, now);
      coldCache();
      env.ctx.UrlFetchApp.fetchAll = () => { throw new Error('Address unavailable'); };
      const res = env.ctx.trainsLookup_({ q: 'JBP-R,NGP-R' }, now + 8 * day);
      assert.deepEqual([res.results[0].ok, res.results[0].saved], [true, true]);
      assert.deepEqual([res.results[1].ok, res.results[1].error], [false, 'unavailable']);
      env.ctx.trainsLookup_ = () => { throw new Error('boom'); };
      const out = JSON.parse(env.ctx.doGet({ parameter: { action: 'trains', q: 'JBP-R' } }).text);
      assert.deepEqual({ ...out }, { ok: false, error: 'unavailable' });
    });

    test('a refused key warns on Telegram once a day', () => {
      env.rail.answer = () => ({ code: 401, body: { success: false } });
      env.ctx.trainsLookup_({ q: 'JBP-R' }, now);
      env.ctx.trainsLookup_({ q: 'NGP-R' }, now);
      const warn = env.telegram.filter((m) => /RailRadar refused the key/.test(m.text));
      assert.equal(warn.length, 1);
    });

    test('a big timetable is split over cells and reads back whole', () => {
      const r = env.ctx.railResult({ from: 'NDLS', to: 'R', date: '' }, 200, tt('NDLS', 400), now, false);
      const row = env.ctx.railRow(r);
      assert.ok(row[4].length > 0, 'more than one cell');
      assert.deepEqual(JSON.parse(JSON.stringify(env.ctx.railFromRow(row))), JSON.parse(JSON.stringify(r)));
      assert.equal(env.ctx.railFromRow(['NDLS-R', '', 0, '{bad']), null);
    });

    test('the nightly run refreshes only timetables older than 3 days, and tick sets it up once', () => {
      env.rail.answer = (url) => ({ code: 200, body: tt(url.split('/between/')[1].split('/')[0]) });
      env.ctx.trainsLookup_({ q: 'JBP-R' }, Date.now() - 4 * day);
      env.ctx.trainsLookup_({ q: 'NGP-R' }, Date.now() - day);
      env.rail.calls.length = 0;
      assert.equal(env.ctx.refreshTrainTimetables(), 1);
      assert.deepEqual(env.rail.calls.map((c) => c.url), ['https://api.railradar.in/v1/trains/between/JBP/R']);
      env.ctx.ensureRailTrigger_();
      env.ctx.ensureRailTrigger_();
      assert.deepEqual(env.ctx.ScriptApp.made.filter((t) => t.fn === 'refreshTrainTimetables').map((t) => [t.every, t.hour]), [['day', 3]]);
    });
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
    // A place from the list of all India: no id, but its km (from the map) and an estimate.
    const fromMap = { ...elsewhere, trip: { ...elsewhere.trip, to: 'Gaya, Bihar', km: 681, days: 2, returnHours: 15, estFrom: 3150, estTo: 3150 } };
    assert.equal(ctx.tripLine(fromMap), 'Raipur → Gaya, Bihar (km from the map) · one-way drop · ~681 km · 2 days + 15 h getting home · est. ₹3,150');
    assert.equal(ctx.tripLine({ ...booking, trip: undefined }), '');
  });
  test('the pinned pickup spot: a Google Maps link in the alert, the email and the Sheet', () => {
    const booking = { name: 'Ravi', phone: '9111473929', city: 'Raipur', package: '3-hours-600', pickup: 'Shankar Nagar', preferredTime: '', notes: '', pickupGeo: { lat: 21.251384, lng: 81.629641, acc: 15 } };
    const c = { booking, id: 'i', ref: 'DB-1001', previousBookings: 0, siteUrl: 'https://thedrivebuddy.in' };
    const link = 'https://www.google.com/maps?q=21.251384,81.629641';
    const msg = ctx.bookingTelegram(c);
    assert.ok(msg.text.includes('<b>Pickup:</b> Shankar Nagar\n📍 <b>Pickup on the map:</b> <a href="' + link + '">Open in Google Maps</a> (±15 m)'));
    assert.deepEqual({ ...msg.reply_markup.inline_keyboard[0][0] }, { text: '📍 Pickup on Google Maps', url: link });
    assert.equal(msg.reply_markup.inline_keyboard.length, 3);
    assert.ok(ctx.bookingEmail(c).body.includes('Pickup: Shankar Nagar\nPickup on the map: ' + link + ' (±15 m)\nWhen:'));
    assert.equal(ctx.bookingRecord('i', booking)['Pickup map'], link);
    // A pin placed by hand has no accuracy.
    const hand = { ...booking, pickupGeo: { lat: 21.25, lng: 81.63 } };
    assert.ok(ctx.bookingTelegram({ ...c, booking: hand }).text.includes('(pinned on the map)'));
    // None, or nonsense: no map line, no map button.
    for (const b of [{ ...booking, pickupGeo: undefined }, { ...booking, pickupGeo: { lat: 51.5, lng: -0.1 } }, { ...booking, pickupGeo: { lat: '21', lng: '81' } }]) {
      const m = ctx.bookingTelegram({ ...c, booking: b });
      assert.ok(!m.text.includes('Pickup on the map'));
      assert.equal(m.reply_markup.inline_keyboard[0][0].text, 'Open in admin panel');
      assert.equal(ctx.bookingRecord('i', b)['Pickup map'], '');
    }
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

/* --------------------------------------------- driver app login (OTP) */

describe('driver login', () => {
  let env;
  const post = (body) => JSON.parse(env.ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  const seedDriver = (id, phone, status, name = 'Suresh Verma') =>
    env.store.docs.set(`drivers/${id}`, { name: s(name), phone: s(phone), status: s(status), createdAt: ts(1000) });
  const claimsOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).claims;

  beforeEach(() => {
    env = load();
    env.props.set('MC_CUSTOMER_ID', 'C-123');
    env.props.set('MC_PASSWORD', 'secret');
    env.props.set('FIREBASE_SA_EMAIL', 'firebase-adminsdk@drive-buddy-acc4c.iam.gserviceaccount.com');
    env.props.set('FIREBASE_SA_KEY', '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n');
    seedDriver('d1', '9893302783', 'active');
  });

  test('pure helpers: phone numbers, the 24-hour window, the driver record, the verdict', () => {
    const { driverPhone, otpWindow, loginDriver, mcVerdict } = env.ctx;
    assert.equal(driverPhone('+91 98933-02783'), '9893302783');
    assert.equal(driverPhone('09893302783'), '9893302783');
    assert.equal(driverPhone('5893302783'), '');
    assert.equal(driverPhone(null), '');
    const h = 3600e3;
    const now = 100 * 24 * h;
    assert.equal(otpWindow([now - 25 * h, now - 2 * h], now, 3).allowed, true);
    const full = otpWindow([now - 3 * h, now - 2 * h, now - h], now, 3);
    assert.equal(full.allowed, false);
    assert.equal(full.retryAt, now - 3 * h + 24 * h);
    assert.equal(loginDriver([{ id: 'a', data: { status: 'verified', name: 'A' } }, { id: 'b', data: { status: 'active', name: 'B' } }]).id, 'b');
    assert.equal(loginDriver([{ id: 'a', data: { status: 'rejected' } }, { id: 'c', data: { status: 'inactive' } }]), null);
    assert.equal(mcVerdict(200, { data: { verificationStatus: 'VERIFICATION_COMPLETED' } }), 'ok');
    assert.equal(mcVerdict(400, { data: { responseCode: 702 } }), 'wrong-code');
    assert.equal(mcVerdict(400, { responseCode: 705 }), 'expired');
    assert.equal(mcVerdict(500, {}), 'failed');
  });

  test('an active driver gets a code, logs in with it, and the token carries his number', () => {
    const sent = post({ action: 'driver-otp', phone: '+91 98933 02783' });
    assert.equal(sent.ok, true);
    assert.equal(sent.left, 2);
    assert.ok(env.mc.calls.some((c) => c.url.includes('/verification/v3/send') && c.url.includes('mobileNumber=9893302783') && c.auth === 'mc-token-1'));
    assert.ok(!JSON.stringify(sent).includes('987654'), 'the verification id stays on the server');

    const wrong = post({ action: 'driver-verify', session: sent.session, code: '111111' });
    assert.deepEqual({ ...wrong }, { ok: false, error: 'wrong-code', triesLeft: 4 });

    const ok = post({ action: 'driver-verify', session: sent.session, code: '123456' });
    assert.equal(ok.ok, true);
    assert.equal(ok.name, 'Suresh Verma');
    const parts = ok.token.split('.');
    assert.equal(parts.length, 3);
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    assert.equal(payload.uid, 'driver-9893302783');
    assert.equal(payload.aud, 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit');
    assert.equal(payload.exp - payload.iat, 3600);
    assert.deepEqual({ ...claimsOf(ok.token) }, { role: 'driver', driverPhone: '9893302783', driverId: 'd1' });

    // The session is spent.
    assert.equal(post({ action: 'driver-verify', session: sent.session, code: '123456' }).error, 'expired');
  });

  test('no code for numbers that are not Verified or Active drivers', () => {
    seedDriver('d2', '9111473929', 'rejected');
    assert.equal(post({ action: 'driver-otp', phone: '9111473929' }).error, 'not-a-driver');
    assert.equal(post({ action: 'driver-otp', phone: '9000000000' }).error, 'not-a-driver');
    assert.equal(post({ action: 'driver-otp', phone: '12345' }).error, 'bad-phone');
    assert.equal(env.mc.calls.length, 0, 'no SMS credit spent');
  });

  test('at most 3 codes per number in 24 hours, and a daily cap for all numbers', () => {
    for (let i = 0; i < 3; i++) assert.equal(post({ action: 'driver-otp', phone: '9893302783' }).ok, true);
    const fourth = post({ action: 'driver-otp', phone: '9893302783' });
    assert.equal(fourth.error, 'limit');
    assert.ok(fourth.retryAt > Date.now());

    env.props.set('OTP_DAILY_LIMIT', '4');
    seedDriver('d3', '9425212345', 'verified');
    assert.equal(post({ action: 'driver-otp', phone: '9425212345' }).ok, true);
    assert.equal(post({ action: 'driver-otp', phone: '9425212345' }).error, 'busy');
    assert.equal(env.telegram.length, 1, 'Telegram hears about the cap once');
    post({ action: 'driver-otp', phone: '9425212345' });
    assert.equal(env.telegram.length, 1);
  });

  test('five wrong tries and the session is closed', () => {
    const { session } = post({ action: 'driver-otp', phone: '9893302783' });
    for (let i = 0; i < 5; i++) assert.equal(post({ action: 'driver-verify', session, code: '000000' }).error, 'wrong-code');
    assert.equal(post({ action: 'driver-verify', session, code: '123456' }).error, 'too-many-tries');
  });

  test('the Play reviewer number logs in with its fixed code, no SMS, no limit', () => {
    env.props.set('REVIEW_PHONE', '9999900001');
    env.props.set('REVIEW_CODE', '246810');
    for (let i = 0; i < 4; i++) {
      const { session, ok } = post({ action: 'driver-otp', phone: '9999900001' });
      assert.equal(ok, true);
      if (i === 3) {
        const res = post({ action: 'driver-verify', session, code: '246810' });
        assert.equal(res.ok, true);
        assert.equal(claimsOf(res.token).driverPhone, '9999900001');
      }
    }
    assert.equal(env.mc.calls.length, 0);
  });

  test('off until Message Central is set up; failures never leak an error page', () => {
    env.props.delete('MC_PASSWORD');
    assert.equal(post({ action: 'driver-otp', phone: '9893302783' }).error, 'not-configured');
    env.props.set('MC_PASSWORD', 'secret');
    env.mc.sendCode = 500;
    assert.equal(post({ action: 'driver-otp', phone: '9893302783' }).error, 'sms-failed');
    assert.equal(post({ action: 'driver-verify', session: 'nope', code: '123456' }).error, 'bad-request');
    // No service account: the code is right but no token can be signed → 'unavailable', not a crash.
    env.mc.sendCode = 200;
    env.props.delete('FIREBASE_SA_KEY');
    const { session } = post({ action: 'driver-otp', phone: '9893302783' });
    assert.equal(post({ action: 'driver-verify', session, code: '123456' }).error, 'unavailable');
  });

  test('the website doorbell still works: a POST without JSON just pings', () => {
    assert.equal(env.ctx.doPost({}).text, 'ok');
    assert.equal(env.ctx.doPost({ postData: { contents: 'not json' } }).text, 'ok');
  });
});

/* --------------------------------------- job dispatch (automatic offers) */

describe('job dispatch', () => {
  let env;
  const n = (v) => ({ integerValue: String(v) });
  const d = (v) => ({ doubleValue: v });
  const b = (v) => ({ booleanValue: v });
  const at = (msAgo) => ts(msAgo);
  const online = (id, name, lat, lng, extra = {}) =>
    env.store.docs.set(`availability/${id}`, {
      online: b(true), city: s('Raipur'), name: s(name), phone: s('9' + String(id).padStart(9, '0')),
      lat: d(lat), lng: d(lng), pushToken: s(`ExponentPushToken[${id}]`), at: at(60_000), ...extra,
    });
  const confirm = (id, pkg = '3-hours-600', extra = {}) =>
    seedBooking(env.store, id, { extra: { ref: s('DB-1042'), status: s('confirmed'), package: s(pkg), pickup: s('12, Shankar Nagar, Raipur'), updatedAt: ts(1000), ...extra } });
  const pushedTo = () => env.pushes.map((p) => p.to);
  const alertDoc = (id) => env.store.docs.get(`offerAlerts/${id}`);
  const age = (id, ms) => { alertDoc(id).stageAt = ts(ms); };

  beforeEach(() => {
    env = load();
    // Spot of the pickup: Shankar Nagar. Drivers at increasing distances.
    online('d1', 'Near One', 21.252, 81.630);
    online('d2', 'Near Two', 21.26, 81.64);
    online('d3', 'Near Three', 21.28, 81.66);
    online('d4', 'Far Four', 21.35, 81.75);
    online('d5', 'Stale', 21.251, 81.629, { at: at(30 * 60_000) }); // last seen 30 min ago
    online('d6', 'Offline', 21.251, 81.629, { online: b(false) });
  });

  test('pure: distance, ranking, the steps', () => {
    const { distanceKm, rankDrivers, dispatchStep, driverPayOf, offerAreaOf } = env.ctx;
    assert.ok(Math.abs(distanceKm({ lat: 21.2514, lng: 81.6296 }, { lat: 21.1938, lng: 81.3509 }) - 29.6) < 1, 'Raipur–Bhilai ≈ 30 km');
    const now = Date.now();
    const rows = [...env.store.docs.entries()].filter(([k]) => k.startsWith('availability/')).map(([k, f]) => ({ id: k.split('/')[1], data: env.ctx.fromFields(f) }));
    assert.deepEqual(rankDrivers(rows, { lat: 21.2514, lng: 81.6296 }, now).map((x) => x.id), ['d1', 'd2', 'd3', 'd4']);
    assert.equal(dispatchStep(null, [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'e' }], now).send.length, 3);
    assert.equal(dispatchStep({ stage: 1, stageAt: new Date(now - 30_000), alerted: ['a'] }, [{ id: 'a' }, { id: 'b' }], now), null);
    assert.deepEqual(dispatchStep({ stage: 1, stageAt: new Date(now - 61_000), alerted: ['a'] }, [{ id: 'a' }, { id: 'b' }], now).send, [{ id: 'b' }]);
    assert.equal(dispatchStep({ stage: 2, stageAt: new Date(now - 5 * 60_000), alerted: ['a'] }, [{ id: 'a' }], now).alarm, true);
    assert.equal(driverPayOf(600, 25), 450);
    assert.equal(driverPayOf(1350, 30), 940);
    assert.equal(offerAreaOf('12, Shankar Nagar, Raipur'), 'Shankar Nagar, Raipur');
  });

  test('a confirmed 3-hour booking is offered by itself at the site price, starting at a 30% cut', () => {
    confirm('b1');
    env.ctx.autoOffers_();
    const o = env.ctx.fromFields(env.store.docs.get('offers/b1'));
    assert.equal(o.status, 'open');
    assert.equal(o.price, 600);
    assert.equal(o.cutPercent, 30);
    assert.equal(o.driverPay, 420);
    assert.equal(o.area, 'Shankar Nagar, Raipur');
    assert.equal(o.takenBy, null);
    assert.equal(o.by, 'robot');
    // Once only.
    env.store.docs.get('offers/b1').price = n(999);
    env.ctx.autoOffers_();
    assert.equal(env.store.docs.get('offers/b1').price.integerValue, '999');
  });

  test('any package with a price saved on the call goes out at that price', () => {
    confirm('q1', 'one-way-drop', { quote: { mapValue: { fields: { amount: n(2400) } } } });
    env.ctx.autoOffers_();
    const o = env.ctx.fromFields(env.store.docs.get('offers/q1'));
    assert.equal(o.price, 2400);
    assert.equal(o.driverPay, 1680); // 70% of 2,400
    // The quote wins over the site price for 1 hour / 3 hours too.
    confirm('q2', '3-hours-600', { quote: { mapValue: { fields: { amount: n(700) } } } });
    env.ctx.autoOffers_();
    assert.equal(env.ctx.fromFields(env.store.docs.get('offers/q2')).price, 700);
  });

  test('a confirmed full-day booking is offered by itself at the estimate (top of the range), starting at a 30% cut', () => {
    confirm('f1', 'local-full-day');
    env.ctx.autoOffers_();
    const o = env.ctx.fromFields(env.store.docs.get('offers/f1'));
    assert.deepEqual([o.status, o.price, o.cutPercent, o.driverPay, o.by], ['open', 1200, 30, 840, 'robot']);
    assert.deepEqual([...o.cities], ['Raipur', 'Bhilai', 'Durg']);
  });

  test('night driver at its from-price; outstation and one-way at the trip estimate; none without one', () => {
    confirm('n1', 'night-driver');
    const trip = (estTo) => ({ mapValue: { fields: { to: s('Nagpur'), kind: s('one-way'), estFrom: n(1440), estTo: n(estTo) } } });
    confirm('t1', 'one-way-drop', { trip: trip(1600) });
    confirm('t2', 'outstation', { trip: trip(3300) });
    confirm('t3', 'outstation'); // no estimate: the office prices it on the call
    confirm('w1', 'wedding-event');
    confirm('m1', 'monthly-basic');
    env.ctx.autoOffers_();
    const price = (id) => (env.store.docs.has(`offers/${id}`) ? env.ctx.fromFields(env.store.docs.get(`offers/${id}`)).price : null);
    assert.deepEqual(['n1', 't1', 't2', 't3', 'w1', 'm1'].map(price), [500, 1600, 3300, null, null, null]);
    assert.equal(env.ctx.fromFields(env.store.docs.get('offers/t1')).to, 'Nagpur');
  });

  test('pure: every basis, the order, and the none cases', () => {
    const est = (b, prices = { oneHour: 300, threeHours: 600, fullDay: { from: 1000, to: 1200 }, nightFrom: 500 }) => JSON.parse(JSON.stringify(env.ctx.estimateOf(b, prices)));
    assert.deepEqual(est({ package: '3-hours-600', quote: { amount: 700 } }), { amount: 700, basis: 'quote' });
    assert.deepEqual(est({ package: 'outstation', quote: { amount: 3100 }, acceptedPrice: { amount: 3300 }, trip: { estTo: 3500 } }), { amount: 3100, basis: 'quote' }, 'the quote beats everything');
    assert.deepEqual(est({ package: 'outstation', acceptedPrice: { amount: 3300 }, trip: { estTo: 3500 } }), { amount: 3300, basis: 'accepted' });
    assert.deepEqual(est({ package: '1-hour-300' }), { amount: 300, basis: 'fixed' });
    assert.deepEqual(est({ package: '3-hours-600' }), { amount: 600, basis: 'fixed' });
    assert.deepEqual(est({ package: 'local-12-hours' }, { twelveHours: 1400 }), { amount: 1400, basis: 'fixed' });
    assert.deepEqual(est({ package: 'local-full-day' }), { amount: 1200, basis: 'fullDay' });
    assert.deepEqual(est({ package: 'night-driver' }), { amount: 500, basis: 'night' });
    assert.deepEqual(est({ package: 'one-way-drop', trip: { estTo: 1600 } }), { amount: 1600, basis: 'trip' });
    assert.deepEqual(est({ package: 'outstation', trip: { estTo: 3500 } }), { amount: 3500, basis: 'trip' });
    const none = { amount: 0, basis: '' };
    for (const pkg of ['medical-emergency', 'monthly-basic', 'monthly-premium', 'wedding-event']) assert.deepEqual(est({ package: pkg }), none, pkg);
    assert.deepEqual(est({ package: 'outstation' }), none, 'a trip without an estimate');
    assert.deepEqual(est({ package: 'outstation', trip: { estTo: 99 } }), none, 'below 100');
    assert.deepEqual(est({ package: 'one-way-drop', trip: { estTo: 500001 } }), none, 'above 500000');
    assert.deepEqual(est({ package: 'one-way-drop', trip: { estTo: 1600.5 } }), none, 'whole rupees only');
    assert.deepEqual(est({ package: '3-hours-600', quote: { amount: 50 } }), { amount: 600, basis: 'fixed' }, 'an odd quote is passed over');
    assert.deepEqual(est({ package: 'medical-emergency', quote: { amount: 900 } }), { amount: 900, basis: 'quote' }, 'priced on the call: offered at that');
    assert.deepEqual(est({ package: 'local-full-day' }, {}), none, 'no site prices');
    assert.deepEqual(est({ package: 'night-driver' }, { nightFrom: '500' }), { amount: 500, basis: 'night' }, 'a number as text still counts');
  });

  test('pure: the cut steps and the automatic price', () => {
    const { autoCuts, autoCutAt } = env.ctx;
    const autoPriceOf = (b, prices) => env.ctx.estimateOf(b, prices).amount;
    assert.deepEqual([...autoCuts('')], [30, 25, 20]);
    assert.deepEqual([...autoCuts('20, 30,25,99')], [30, 25, 20]);
    assert.deepEqual([...autoCuts('nonsense')], [30, 25, 20]);
    const m = 60_000;
    assert.equal(autoCutAt(0, [30, 25, 20], 2 * m), 30);
    assert.equal(autoCutAt(2 * m + 1, [30, 25, 20], 2 * m), 25);
    assert.equal(autoCutAt(60 * m, [30, 25, 20], 2 * m), 20);
    assert.equal(autoPriceOf({ package: '1-hour-300' }, { oneHour: 300 }), 300);
    assert.equal(autoPriceOf({ package: 'local-full-day' }, { oneHour: 300 }), 0, 'no full-day price on the site: none');
    assert.equal(autoPriceOf({ package: 'local-full-day', quote: { amount: 1100 } }, {}), 1100);
    assert.equal(autoPriceOf({ package: 'outstation', quote: { amount: 50 } }, {}), 0);
  });

  test('nobody takes it: the cut drops 30% → 25% → 20%, everyone hears the new pay, then Telegram', () => {
    confirm('b1');
    env.ctx.autoOffers_();
    env.ctx.dispatchOffers_();
    assert.equal(env.pushes.length, 3, 'first wave: the nearest 3');
    assert.ok(env.pushes[0].body.includes('₹420'));
    const created = (msAgo) => { env.store.docs.get('offers/b1').createdAt = ts(msAgo); };

    created(2 * 60_000 + 5000);
    env.ctx.dispatchOffers_();
    let o = env.ctx.fromFields(env.store.docs.get('offers/b1'));
    assert.equal(o.cutPercent, 25);
    assert.equal(o.driverPay, 450);
    const raised = env.pushes.slice(3);
    assert.deepEqual(raised.map((p) => p.to), ['ExponentPushToken[d1]', 'ExponentPushToken[d2]', 'ExponentPushToken[d3]', 'ExponentPushToken[d4]']);
    assert.ok(raised[0].title.startsWith('Pay raised'));
    assert.ok(raised[0].body.includes('₹450'));

    env.ctx.dispatchOffers_(); // nothing new yet
    assert.equal(env.pushes.length, 7);

    created(4 * 60_000 + 5000);
    env.ctx.dispatchOffers_();
    o = env.ctx.fromFields(env.store.docs.get('offers/b1'));
    assert.equal(o.cutPercent, 20);
    assert.equal(o.driverPay, 480);
    assert.equal(env.pushes.length, 11);

    // At the top pay and still nobody: Telegram, once.
    const before = env.telegram.length;
    age('b1', 5 * 60_000);
    created(12 * 60_000); // at the top for 8 minutes: not yet widened to nearby cities
    env.ctx.dispatchOffers_();
    assert.equal(env.telegram.length, before + 1);
    assert.ok(env.telegram.at(-1).text.includes('₹480'));
  });

  describe('the private rate card (DRIVER_RATES)', () => {
    // Obviously generic test numbers — the real rates live only in the Script Properties.
    const RATES = { local8h: 500, local12h: 700, localExtraHour: 10, tripDay: 1000, returnHour: 100 };
    const useRates = () => env.props.set('DRIVER_RATES', JSON.stringify(RATES));
    const trip = (estTo, days, returnHours, km = 284) => ({ mapValue: { fields: { to: s('Nagpur'), kind: s('one-way'), km: n(km), estFrom: n(estTo), estTo: n(estTo), days: n(days), returnHours: n(returnHours) } } });
    const offerOf = (id) => (env.store.docs.has(`offers/${id}`) ? env.ctx.fromFields(env.store.docs.get(`offers/${id}`)) : null);

    test('pure: the property is read strictly — anything odd means no rate card', () => {
      const { driverRatesOf } = env.ctx;
      assert.deepEqual({ ...driverRatesOf(JSON.stringify(RATES)) }, RATES);
      for (const bad of [null, '', 'nonsense', '[]', '{}', JSON.stringify({ ...RATES, tripDay: undefined }), JSON.stringify({ ...RATES, tripDay: 0 }),
        JSON.stringify({ ...RATES, tripDay: 100001 }), JSON.stringify({ ...RATES, tripDay: 999.5 }), JSON.stringify({ ...RATES, tripDay: '1000' })]) {
        assert.equal(driverRatesOf(bad), null, String(bad));
      }
    });

    test('pure: what the rate card pays — full day, one-way (his whole time: the road + his way home), outstation; null otherwise', () => {
      const pay = (b, nearKm = 160) => env.ctx.rateCardPayOf(b, 9999, RATES, nearKm);
      assert.equal(pay({ package: 'local-full-day' }), 500);
      assert.equal(pay({ package: 'local-12-hours' }), 700, '12 hours: the 12-hour rate');
      // 600 km: 10.9 h of driving + 2 breaks = 12.1 h on the road (one day); home 27 h → 39.1 h = 1 day + 16 h (at most a day).
      assert.equal(pay({ package: 'one-way-drop', trip: { km: 600, days: 1, returnHours: 27 } }), 1000 + 1000);
      // Home 3 h: 15.1 h in all → 16 h × 100, at most a day.
      assert.equal(pay({ package: 'one-way-drop', trip: { km: 600, days: 1, returnHours: 3 } }), 1000);
      // 300 km: 5.5 h + 1 break = 6 h; home 2 h → 8.1 h → 9 h × 100, at least a day.
      assert.equal(pay({ package: 'one-way-drop', trip: { km: 300, days: 1, returnHours: 2 } }), 1000, 'at least one day');
      // 1,370 km: 24.9 h + 6 breaks = 28.4 h on the road, two nights' rest → drops at 52.4 h; home 35 h → 87.4 h = 3 days + 16 h.
      assert.equal(pay({ package: 'one-way-drop', trip: { km: 1370, days: 3, returnHours: 35 } }), 3 * 1000 + 1000);
      // Day and night (the booking's note): drops at 28.4 h; home 35 h → 63.4 h = 2 days + 16 h.
      const nonstop = { package: 'one-way-drop', notes: 'Day and night driving (non-stop). Two of us.', trip: { km: 1370, days: 2, returnHours: 35 } };
      assert.equal(pay(nonstop), 2 * 1000 + 1000);
      // 616 km, home 11 h: 12.4 h on the road + 11 h = 23.4 h → 24 h × 100, at most a day.
      assert.equal(pay({ package: 'one-way-drop', trip: { km: 616, days: 1, returnHours: 11 } }), 1000);
      assert.equal(pay({ package: 'outstation', trip: { km: 400, days: 3, returnHours: 0 } }), 3000);
      // Same-day drops and trips (up to the site's first nearby tier) and an unknown distance: the % cut.
      for (const km of [113, 160, 0, undefined]) {
        assert.equal(pay({ package: 'one-way-drop', trip: { km, days: 1, returnHours: 4 } }), null, `one-way ${km} km`);
        assert.equal(pay({ package: 'outstation', trip: { km, days: 1, returnHours: 0 } }), null, `outstation ${km} km`);
      }
      assert.equal(pay({ package: 'one-way-drop', trip: { km: 161, days: 1, returnHours: 4 } }), 1000);
      assert.equal(pay({ package: 'one-way-drop', trip: { km: 180, days: 1, returnHours: 4 } }, 200), null, 'the site’s own limit');
      assert.equal(env.ctx.nearKmOf({ outstationNear: [{ upToKm: 200, from: 1, to: 2 }] }), 200);
      assert.equal(env.ctx.nearKmOf({}), 160, 'no site config: 160');
      assert.equal(env.ctx.nearKmOf(null), 160);
      for (const b of [{ package: 'night-driver' }, { package: '1-hour-300' }, { package: '3-hours-600' }, { package: 'wedding-event' },
        { package: 'medical-emergency' }, { package: 'one-way-drop' }, { package: 'outstation' }]) {
        assert.equal(pay(b), null, b.package);
      }
      assert.equal(env.ctx.rateCardPayOf({ package: 'local-full-day' }, 1200, null), null, 'no rate card');
    });

    test('pure: a one-way drive’s timing (the site’s outstation.drive) and the pay for his whole time', () => {
      const { dropHoursOf, driveOf, wholeTimePay, DRIVE_DEFAULT } = env.ctx;
      assert.deepEqual({ ...driveOf(null) }, { ...DRIVE_DEFAULT });
      assert.deepEqual({ ...driveOf({ drive: { kmh: 60, breakEveryHours: 3, breakMinutes: 30, maxRoadHoursPerDay: 10 } }) },
        { kmh: 60, breakEveryHours: 3, breakMinutes: 30, maxRoadHoursPerDay: 10 });
      assert.equal(driveOf({ drive: { kmh: 'fast', breakEveryHours: 0 } }).kmh, DRIVE_DEFAULT.kmh, 'odd values: the default');
      const h = (km, nonstop = false) => Math.round(dropHoursOf(km, DRIVE_DEFAULT, nonstop) * 100) / 100;
      assert.equal(h(616), 12.37, '11.2 h + 2 × 35 min: within the day and its hour');
      assert.equal(h(1370), 52.41, 'two nights’ rest');
      assert.equal(h(1370, true), 28.41, 'day and night');
      assert.equal(h(110), 2, 'under 4 h: no break');
      assert.deepEqual([wholeTimePay(5, 1000, 100), wholeTimePay(9.5, 1000, 100), wholeTimePay(24, 1000, 100), wholeTimePay(24.1, 1000, 100), wholeTimePay(47.9, 1000, 100)],
        [1000, 1000, 1000, 1100, 2000]);
    });

    test('pure: the raise — a step at a time, at most the cap, never up to the price', () => {
      const up = (min, base, price) => JSON.parse(JSON.stringify(env.ctx.rateRaiseAt(min * 60_000, base, price, 2 * 60_000)));
      assert.deepEqual(up(0, 500, 1200), { pay: 500, top: false });
      assert.deepEqual(up(2, 500, 1200), { pay: 550, top: false });
      assert.deepEqual(up(4, 500, 1200), { pay: 600, top: false });
      assert.deepEqual(up(6, 500, 1200), { pay: 650, top: true });
      assert.deepEqual(up(60, 500, 1200), { pay: 650, top: true }, 'capped');
      assert.deepEqual(up(60, 1100, 1200), { pay: 1150, top: true }, 'never up to the price');
      assert.deepEqual(up(60, 1180, 1200), { pay: 1180, top: true });
      assert.deepEqual({ ...env.ctx.RATE_RAISE }, { step: 50, max: 150 });
    });

    test('a full day and a one-way drop go out at the driver’s rate (payBy rates, DriveBuddy’s share for reference)', () => {
      useRates();
      confirm('f1', 'local-full-day');
      confirm('t1', 'one-way-drop', { trip: trip(4000, 2, 27) });
      confirm('o1', 'outstation', { trip: { mapValue: { fields: { to: s('Puri'), kind: s('round'), km: n(500), estFrom: n(3600), estTo: n(3600), days: n(3), returnHours: n(0) } } } });
      confirm('h1', '3-hours-600');
      env.ctx.autoOffers_();
      const f = offerOf('f1');
      assert.deepEqual([f.price, f.driverPay, f.cutPercent, f.payBy], [1200, 500, 58, 'rates']);
      const t = offerOf('t1');
      // 284 km: 5.7 h on the road + 27 h home = 32.7 h → a day + 9 h.
      assert.deepEqual([t.price, t.driverPay, t.cutPercent, t.payBy], [4000, 1900, 53, 'rates']);
      assert.deepEqual([offerOf('o1').driverPay, offerOf('o1').payBy], [3000, 'rates']);
      const h = offerOf('h1');
      assert.deepEqual([h.price, h.driverPay, h.cutPercent, h.payBy], [600, 420, 30, 'cut'], 'not on the card: the % cut');
    });

    test('a short same-day drop stays on the % cut and is offered; a long one uses the rate card', () => {
      useRates();
      confirm('s1', 'one-way-drop', { trip: trip(1200, 1, 4, 113) }); // near-tier price, below a day's rate: still offered
      confirm('l1', 'one-way-drop', { trip: trip(2500, 1, 4, 284) });
      env.ctx.autoOffers_();
      const short = offerOf('s1');
      assert.deepEqual([short.price, short.driverPay, short.cutPercent, short.payBy], [1200, 840, 30, 'cut']);
      const long = offerOf('l1');
      assert.deepEqual([long.price, long.driverPay, long.payBy], [2500, 1000, 'rates']);
      assert.equal(env.telegram.filter((m) => /below the driver/.test(m.text)).length, 0);
    });

    test('the price below his rate: no offer, Telegram once — the office checks the price', () => {
      useRates();
      confirm('t2', 'one-way-drop', { trip: trip(1500, 2, 35) }); // his whole time 40.7 h: his rate 2000
      env.ctx.autoOffers_();
      env.store.docs.get('bookings/t2').updatedAt = ts(-1000);
      env.ctx.autoOffers_();
      assert.equal(offerOf('t2'), null);
      const warned = env.telegram.filter((m) => /below the driver/.test(m.text));
      assert.equal(warned.length, 1);
      assert.equal(warned[0].text, "⚠️ DB-1042: the price ₹1,500 is below the driver's rate ₹2,000 — check the price");
      confirm('t3', 'one-way-drop', { trip: trip(2000, 2, 35) }); // equal: still not below his rate
      env.ctx.autoOffers_();
      assert.equal(offerOf('t3'), null);
    });

    test('nobody takes it: his pay goes up by the step (Pay raised), up to the cap; then Telegram', () => {
      useRates();
      confirm('f1', 'local-full-day');
      env.ctx.autoOffers_();
      env.ctx.dispatchOffers_();
      assert.ok(env.pushes[0].body.includes('₹500'));
      const created = (msAgo) => { env.store.docs.get('offers/f1').createdAt = ts(msAgo); };
      const pays = [];
      for (const min of [2, 4, 6, 8]) {
        created(min * 60_000 + 5000);
        env.ctx.dispatchOffers_();
        const o = offerOf('f1');
        pays.push([o.driverPay, o.cutPercent]);
      }
      assert.deepEqual(pays, [[550, 54], [600, 50], [650, 46], [650, 46]]);
      const raised = env.pushes.filter((p) => p.title.startsWith('Pay raised'));
      assert.ok(raised.some((p) => p.body.includes('₹550')) && raised.some((p) => p.body.includes('₹650')));
      assert.equal(env.ctx.fromFields(env.store.docs.get('offerAlerts/f1')).basePay, 500);
      // At the top pay and still nobody: Telegram, once.
      const before = env.telegram.length;
      age('f1', 5 * 60_000);
      created(12 * 60_000);
      env.ctx.dispatchOffers_();
      assert.equal(env.telegram.length, before + 1);
      assert.ok(env.telegram.at(-1).text.includes('₹650'));
    });

    test('no property (or an invalid one): exactly the % cut as before', () => {
      confirm('f1', 'local-full-day');
      env.props.set('DRIVER_RATES', '{"local8h": "lots"}');
      confirm('f2', 'local-full-day', { ref: s('DB-1043') });
      env.ctx.autoOffers_();
      for (const id of ['f1', 'f2']) {
        const o = offerOf(id);
        assert.deepEqual([o.price, o.driverPay, o.cutPercent, o.payBy], [1200, 840, 30, 'cut'], id);
      }
      env.ctx.dispatchOffers_();
      env.store.docs.get('offers/f1').createdAt = ts(2 * 60_000 + 5000);
      env.ctx.dispatchOffers_();
      assert.equal(offerOf('f1').cutPercent, 25, 'the cut steps as before');
    });

    test('a rate-card job given back goes out again at his rate; the payout counts driverPay', () => {
      useRates();
      confirm('f1', 'local-full-day'); // back to confirmed, no driver: he gave it back
      const NEAR = { id: 'd1', name: 'Near One', phone: '9000000001' };
      env.store.docs.set('offers/f1', env.ctx.toFields({
        bookingId: 'f1', ref: 'DB-1042', city: 'Raipur', package: 'local-full-day', when: '', area: 'Shankar Nagar', to: '',
        price: 1200, cutPercent: 46, driverPay: 650, status: 'released', takenBy: NEAR, takenAt: new Date(), done: false, paid: false,
        paidAt: null, createdAt: new Date(Date.now() - 3600_000), updatedAt: new Date(), by: 'robot', cities: ['Raipur'], payBy: 'rates',
      }));
      env.ctx.watchChanges_();
      const o = offerOf('f1');
      assert.deepEqual([o.status, o.driverPay, o.cutPercent, o.payBy, o.takenBy], ['open', 500, 58, 'rates', null], 'his rate again, the raises start over');
      assert.equal(env.ctx.fromFields(env.store.docs.get('offerAlerts/f1')).basePay, 500);
      const [g] = env.ctx.payoutGroups([{ id: 'f1', data: { ...o, status: 'taken', done: true, takenBy: NEAR } }]);
      assert.equal(g.amount, 500, 'the payout is the offer’s driverPay');
      // Without the rate card any more: the % cut, marked so.
      env.props.delete('DRIVER_RATES');
      env.store.docs.get('offers/f1').status = s('released');
      env.store.docs.get('offers/f1').takenBy = env.ctx.toValue(NEAR);
      env.ctx.watchChanges_();
      assert.deepEqual([offerOf('f1').driverPay, offerOf('f1').cutPercent, offerOf('f1').payBy], [840, 30, 'cut']);
    });
  });

  test('an offer posted by hand keeps the cut the admin chose', () => {
    confirm('h1');
    env.ctx.autoOffers_();
    const doc = env.store.docs.get('offers/h1');
    doc.by = s('admin1');
    doc.cutPercent = n(28);
    doc.driverPay = n(430);
    doc.createdAt = ts(30 * 60_000);
    env.ctx.dispatchOffers_();
    assert.equal(env.ctx.fromFields(env.store.docs.get('offers/h1')).cutPercent, 28);
  });

  test('not for packages without a price, new or assigned bookings, or when switched off', () => {
    confirm('b2', 'medical-emergency');
    seedBooking(env.store, 'b3', { extra: { status: s('new'), updatedAt: ts(1000) } });
    confirm('b4', '1-hour-300', { assignedDriver: { mapValue: { fields: { id: s('d1'), name: s('X'), phone: s('9893302783') } } } });
    env.ctx.autoOffers_();
    assert.equal(env.store.docs.has('offers/b2'), false);
    assert.equal(env.store.docs.has('offers/b3'), false);
    assert.equal(env.store.docs.has('offers/b4'), false);
    env.props.set('AUTO_OFFERS', 'off');
    confirm('b5', '1-hour-300');
    env.ctx.autoOffers_();
    assert.equal(env.store.docs.has('offers/b5'), false);
  });

  test('nearest 3 online drivers first, everyone else a minute later, Telegram after 4 more minutes', () => {
    env.props.set('AUTO_OFFER_CUTS', '25'); // one step: the pay never changes here
    confirm('b1');
    env.ctx.autoOffers_();
    env.ctx.dispatchOffers_();
    assert.deepEqual(pushedTo(), ['ExponentPushToken[d1]', 'ExponentPushToken[d2]', 'ExponentPushToken[d3]']);
    assert.ok(env.pushes[0].body.includes('₹450'));
    assert.equal(env.pushes[0].channelId, 'jobs');

    env.ctx.dispatchOffers_(); // too early for the second wave
    assert.equal(env.pushes.length, 3);

    age('b1', 61_000);
    env.ctx.dispatchOffers_();
    assert.deepEqual(pushedTo().slice(3), ['ExponentPushToken[d4]'], 'stale and offline drivers are not alerted');

    age('b1', 5 * 60_000);
    const before = env.telegram.length;
    env.ctx.dispatchOffers_();
    assert.equal(env.telegram.length, before + 1);
    assert.ok(env.telegram.at(-1).text.includes('DB-1042'));
    env.ctx.dispatchOffers_();
    assert.equal(env.telegram.length, before + 1, 'Telegram hears once');

    // A driver who goes online later still hears about it.
    online('d7', 'Late', 21.25, 81.63);
    env.ctx.dispatchOffers_();
    assert.equal(pushedTo().at(-1), 'ExponentPushToken[d7]');
  });

  test('a taken offer alerts nobody', () => {
    confirm('b1');
    env.ctx.autoOffers_();
    env.store.docs.get('offers/b1').status = s('taken');
    env.ctx.dispatchOffers_();
    assert.equal(env.pushes.length, 0);
  });
});

/* ------------------------------------------- automation (spec items 1–12) */

describe('automation', () => {
  let env;
  const MIN = 60_000;
  const put = (path, obj) => env.store.docs.set(path, env.ctx.toFields(obj));
  const get = (path) => (env.store.docs.has(path) ? env.ctx.fromFields(env.store.docs.get(path)) : null);
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const ago = (ms) => new Date(Date.now() - ms);
  const RAJU = { id: 'd1', name: 'Raju Sahu', phone: '9893302783' };
  const events = (id) =>
    [...env.store.docs.entries()].filter(([p]) => p.startsWith(`bookings/${id}/events/`)).map(([, f]) => env.ctx.fromFields(f));
  const device = (uid, id, token, language = 'en') => put(`users/${uid}/devices/${id}`, { token, platform: 'android', language });
  const booking = (id, fields) =>
    put(`bookings/${id}`, {
      name: 'Ramesh Sahu', phone: '9111473929', city: 'Raipur', package: '3-hours-600', pickup: '12, Shankar Nagar, Raipur',
      preferredTime: '', notes: '', status: 'new', source: 'app', createdAt: ago(MIN), ref: 'DB-1042', ...fields,
    });
  const takenOffer = (id, extra = {}) =>
    put(`offers/${id}`, {
      bookingId: id, ref: 'DB-1042', city: 'Raipur', package: '3-hours-600', when: '', area: 'Shankar Nagar, Raipur', to: '',
      price: 600, cutPercent: 25, driverPay: 450, status: 'taken', takenBy: RAJU, takenAt: ago(30 * MIN), done: false,
      paid: false, paidAt: null, createdAt: ago(40 * MIN), updatedAt: ago(30 * MIN), by: 'robot', cities: ['Raipur'], ...extra,
    });

  beforeEach(() => {
    env = load();
    put('drivers/d1', { name: 'Raju Sahu', phone: RAJU.phone, city: 'Raipur', status: 'active', strikes: 1, createdAt: ago(86_400_000) });
  });

  describe('pure parts', () => {
    test('instant booking: logged-in 1 hour / 3 hours or an accepted price; never an emergency; off switch', () => {
      const ok = env.ctx.instantConfirmable;
      const b = { status: 'new', ref: 'DB-1', package: '3-hours-600', customerUid: 'u1' };
      assert.equal(ok(b, ''), true);
      assert.equal(ok({ ...b, package: '1-hour-300' }, ''), true);
      assert.equal(ok({ ...b, customerUid: undefined }, ''), false, 'a guest is called');
      assert.equal(ok({ ...b, package: 'local-full-day' }, ''), false);
      assert.equal(ok({ ...b, package: 'medical-emergency' }, ''), false);
      assert.equal(ok({ ...b, package: 'medical-emergency', acceptedPrice: { amount: 900 } }, ''), false, 'an emergency is always a call');
      assert.equal(ok({ ...b, package: 'outstation', customerUid: 'u1', acceptedPrice: { amount: 3300 } }, ''), true);
      assert.equal(ok({ ...b, ref: undefined }, ''), false, 'numbered first');
      assert.equal(ok({ ...b, status: 'confirmed' }, ''), false);
      assert.equal(ok(b, 'off'), false);
      assert.equal(ok(b, ' OFF '), false);
    });

    test('the automatic price: quote, then the accepted price, then the site price', () => {
      const autoPriceOf = (b, prices) => env.ctx.estimateOf(b, prices).amount;
      const prices = { oneHour: 300, threeHours: 600 };
      assert.equal(autoPriceOf({ package: 'outstation', quote: { amount: 3100 }, acceptedPrice: { amount: 3300 } }, prices), 3100);
      assert.equal(autoPriceOf({ package: 'outstation', acceptedPrice: { amount: 3300 } }, prices), 3300);
      assert.equal(autoPriceOf({ package: '3-hours-600', acceptedPrice: { amount: 50 } }, prices), 600, 'a nonsense price is ignored');
      assert.equal(autoPriceOf({ package: 'outstation' }, prices), 0);
    });

    test('hours used: whole hours, an hour counts after a 15-minute grace', () => {
      const h = (m) => env.ctx.usedHours(0, m * MIN, 15);
      assert.equal(h(0), 0);
      assert.equal(h(15), 0);
      assert.equal(h(16), 1);
      assert.equal(h(60), 1);
      assert.equal(h(3 * 60 + 15), 3);
      assert.equal(h(3 * 60 + 16), 4);
      assert.equal(h(3 * 60 + 14.99), 3);
    });

    test('the local bill: package price + each hour over the package at the extra-hour price', () => {
      const prices = { oneHour: 300, threeHours: 600, fullDay: { from: 1000, to: 1200 }, nightFrom: 500, localExtraHour: 150 };
      const t0 = new Date('2026-11-22T04:00:00Z');
      const taps = (min) => ({ leftAt: new Date(t0 - 20 * MIN), arrivedAt: t0, doneAt: new Date(+t0 + min * MIN) });
      const now = new Date();
      const bill = (pkg, min, extra = {}) => plain(env.ctx.localBillOf({ package: pkg, ...extra }, taps(min), prices, now));
      assert.deepEqual(bill('3-hours-600', 3 * 60 + 15), { amount: 600, baseHours: 3, usedHours: 3, extraHours: 0, extraHourRate: 150, at: now.toISOString() });
      assert.deepEqual(bill('3-hours-600', 3 * 60 + 16), { amount: 750, baseHours: 3, usedHours: 4, extraHours: 1, extraHourRate: 150, at: now.toISOString() });
      assert.equal(bill('1-hour-300', 40).amount, 300, 'shorter than the package: the package price');
      assert.equal(bill('1-hour-300', 2 * 60 + 30).amount, 300 + 2 * 150);
      assert.equal(bill('local-full-day', 9 * 60).amount, 1200 + 150, 'full day: the price it is offered at (top of the range)');
      assert.equal(bill('local-full-day', 8 * 60, { quote: { amount: 1150 } }).amount, 1150, 'the agreed price wins');
      // The price of the offer he took is the base: the bill and his pay agree.
      const offered = (pkg, min, offerPrice, extra = {}) => env.ctx.localBillOf({ package: pkg, ...extra }, taps(min), prices, now, offerPrice).amount;
      assert.equal(offered('local-full-day', 8 * 60, 1100), 1100, 'an admin-typed offer price');
      assert.equal(offered('local-full-day', 9 * 60, 1100), 1100 + 150);
      assert.equal(offered('local-full-day', 8 * 60, 1100, { quote: { amount: 1150 } }), 1150, 'a quote beats the offer price');
      assert.equal(offered('night-driver', 10 * 60, 0), 500, 'no offer: the estimate (night from-price)');
      assert.equal(offered('3-hours-600', 3 * 60, 50), 600, 'an odd offer price is passed over');
      // Only without any of those: the site's lowest price (no full-day top price set).
      assert.equal(env.ctx.localBillOf({ package: 'local-full-day' }, taps(8 * 60), { fullDay: { from: 1000 } }, now).amount, 1000);
      assert.equal(bill('night-driver', 10 * 60).baseHours, 10);
      assert.equal(env.ctx.localBillOf({ package: 'outstation' }, taps(60), prices, now), null);
      assert.equal(env.ctx.localBillOf({ package: '1-hour-300' }, { arrivedAt: t0 }, prices, now), null, 'not done yet');
      // No extra-hour price on the website yet: the extra hours are shown, not charged.
      assert.equal(env.ctx.localBillOf({ package: '1-hour-300' }, taps(150), { oneHour: 300 }, now).amount, 300);
    });

    test('trip taps → the clock; times and India-time stamps', () => {
      const [a, b, c] = [new Date('2026-11-22T01:00:00Z'), new Date('2026-11-22T09:00:00Z'), new Date('2026-11-22T20:00:00Z')];
      const taps = { leftAt: a, arrivedAt: a, doneAt: b, homeAt: c };
      assert.deepEqual(plain(env.ctx.tapsClockOf('one-way-drop', taps)), plain({ startAt: a, dropAt: b, homeAt: c }));
      assert.deepEqual(plain(env.ctx.tapsClockOf('outstation', taps)), plain({ startAt: a, homeAt: b }));
      assert.deepEqual(plain(env.ctx.tapsClockOf('3-hours-600', taps)), {});
      assert.equal(env.ctx.clockText('2026-11-22T15:30'), '3:30 pm');
      assert.equal(env.ctx.clockText('2026-11-22T09:05'), '9:05 am');
      assert.equal(env.ctx.clockText('2026-11-22T00:10'), '12:10 am');
      assert.equal(env.ctx.clockText(''), '');
      assert.equal(env.ctx.istStamp(Date.parse('2026-11-22T10:00:00Z')), '2026-11-22T15:30');
    });

    test('ratings, payouts, the Paid ✓ button', () => {
      assert.deepEqual(plain(env.ctx.ratingSummary([{ stars: 5 }, { stars: 4 }, { stars: 4 }, { stars: 9 }, { stars: 2.5 }])), { ratingAvg: 4.3, ratingCount: 3 });
      assert.deepEqual(plain(env.ctx.ratingSummary([])), { ratingAvg: 0, ratingCount: 0 });
      const rows = [
        { id: 'a', data: { status: 'taken', done: true, paid: false, driverPay: 450, takenBy: RAJU, ref: 'DB-1' } },
        { id: 'b', data: { status: 'taken', done: true, paid: false, driverPay: 900, takenBy: RAJU, ref: 'DB-2' } },
        { id: 'c', data: { status: 'taken', done: false, paid: false, driverPay: 300, takenBy: RAJU } }, // not done yet
        { id: 'd', data: { status: 'open', done: false, paid: false, driverPay: 300, takenBy: null } },
        { id: 'e', data: { status: 'taken', done: true, paid: false, driverPay: 420, takenBy: { id: 'd2', name: 'Ajay Verma', phone: '9425212345' } } },
      ];
      const groups = plain(env.ctx.payoutGroups(rows));
      assert.deepEqual(groups.map((g) => [g.name, g.amount, g.jobs, g.offerIds]), [['Ajay Verma', 420, 1, ['e']], ['Raju Sahu', 1350, 2, ['a', 'b']]]);
      const msg = env.ctx.payoutTelegram({ ...groups[1], upi: 'raju@okaxis' }, '2026-11-23');
      assert.equal(msg.text.split('\n')[0], 'Pay Raju Sahu ₹1,350 · UPI raju@okaxis · 2 jobs');
      assert.deepEqual(plain(msg.reply_markup), { inline_keyboard: [[{ text: 'Paid ✓', callback_data: 'paid:d1:2026-11-23' }]] });
      assert.ok(new TextEncoder().encode('paid:' + 'x'.repeat(20) + ':2026-11-23').length <= 64, 'callback data fits Telegram’s 64 bytes');
      assert.match(env.ctx.payoutTelegram({ ...groups[0], upi: '' }, '2026-11-23').text, /no UPI ID yet/);
      assert.deepEqual(plain(env.ctx.parsePaidCallback('paid:d1:2026-11-23')), { driverId: 'd1', week: '2026-11-23' });
      for (const bad of ['paid:d1', 'paid:../x:2026-11-23', 'pay:d1:2026-11-23', null]) assert.equal(env.ctx.parsePaidCallback(bad), null);
    });

    test('ranking: poorly rated (3+ ratings) or 3-strike drivers go after the others', () => {
      const { backSeat, rankDrivers } = env.ctx;
      assert.equal(backSeat({ ratingAvg: 3.9, ratingCount: 3 }), true);
      assert.equal(backSeat({ ratingAvg: 3.9, ratingCount: 2 }), false, 'too few ratings to judge');
      assert.equal(backSeat({ ratingAvg: 4, ratingCount: 30 }), false);
      assert.equal(backSeat({ strikes: 3 }), true);
      assert.equal(backSeat(undefined), false);
      const now = Date.now();
      const row = (id, lat) => ({ id, data: { online: true, pushToken: `T${id}`, at: new Date(now - MIN), lat, lng: 81.63 } });
      const rows = [row('near', 21.252), row('mid', 21.26), row('far', 21.35)];
      const ids = (q) => rankDrivers(rows, { lat: 21.2514, lng: 81.6296 }, now, q).map((d) => d.id);
      assert.deepEqual(ids(), ['near', 'mid', 'far']);
      assert.deepEqual(ids({ near: { ratingAvg: 3.2, ratingCount: 6 } }), ['mid', 'far', 'near']);
      assert.deepEqual(ids({ near: { strikes: 3 }, mid: { strikes: 4 } }), ['far', 'near', 'mid']);
    });

    test('nearby cities: 10 minutes after the top pay, once; Bilaspur has none', () => {
      const { widenDue, citiesWith, offerCities } = env.ctx;
      const now = Date.now();
      const cuts = [30, 25, 20];
      const o = (minAgo, extra = {}) => ({ by: 'robot', status: 'open', createdAt: new Date(now - minAgo * MIN), ...extra });
      // The top (20%) is reached 4 minutes in (2-minute steps); 10 minutes later = 14 minutes.
      assert.equal(widenDue(o(13.9), null, cuts, 2 * MIN, now), false);
      assert.equal(widenDue(o(14), null, cuts, 2 * MIN, now), true);
      assert.equal(widenDue(o(30), { widenedAt: new Date() }, cuts, 2 * MIN, now), false, 'once');
      assert.equal(widenDue(o(30, { by: 'admin1' }), null, cuts, 2 * MIN, now), false, 'an offer posted by hand stays as the admin made it');
      assert.deepEqual([...citiesWith('Raipur')], ['Raipur', 'Bhilai', 'Durg']);
      assert.deepEqual([...citiesWith('Durg')], ['Durg', 'Bhilai', 'Raipur']);
      assert.deepEqual([...citiesWith('Bilaspur')], ['Bilaspur']);
      assert.deepEqual([...offerCities({ city: 'Raipur' })], ['Raipur'], 'older offers have no cities');
      assert.deepEqual([...offerCities({ city: 'Raipur', cities: ['Raipur', 'Bhilai'] })], ['Raipur', 'Bhilai']);
    });

    test('the Razorpay request: paise, the booking number, the customer’s phone, SMS on', () => {
      const r = plain(env.ctx.razorpayLinkRequest({ ref: 'DB-1042', name: 'Ramesh\nSahu', phone: '9111473929', package: '3-hours-600' }, 750));
      assert.equal(r.amount, 75000);
      assert.equal(r.currency, 'INR');
      assert.equal(r.reference_id, 'DB-1042');
      assert.deepEqual(r.customer, { name: 'Ramesh Sahu', contact: '+919111473929' });
      assert.deepEqual(r.notify, { sms: true, email: false });
    });
  });

  describe('instant booking (1)', () => {
    test('a logged-in 3-hour booking is confirmed by the robot, offered to drivers, and the customer hears', () => {
      device('u1', 'p1', 'ExponentPushToken[customer0001]');
      seedBooking(env.store, 'b1', { extra: { customerUid: s('u1'), source: s('app') } });
      env.ctx.tick();
      const b = get('bookings/b1');
      assert.equal(b.status, 'confirmed');
      assert.equal(b.updatedBy, 'robot');
      const ev = events('b1').find((e) => e.to === 'confirmed');
      assert.deepEqual({ type: ev.type, from: ev.from, to: ev.to, note: ev.note, by: ev.by }, { type: 'status', from: 'new', to: 'confirmed', note: 'Confirmed automatically', by: 'robot' });
      assert.match(env.telegram[0].text, /Auto-confirmed/);
      assert.equal(get('offers/b1').status, 'open', 'offered to drivers in the same minute');
      assert.deepEqual([...get('offers/b1').cities], ['Raipur', 'Bhilai', 'Durg'], 'the whole zone');
      assert.equal(env.pushes.filter((p) => p.title === 'Booking confirmed').length, 1);
    });

    test('12 hours in the city: confirmed by itself for a logged-in customer and offered at the 12-hour price', () => {
      seedBooking(env.store, 'b12', { extra: { customerUid: s('u1'), source: s('app'), package: s('local-12-hours') } });
      env.ctx.tick();
      assert.equal(get('bookings/b12').status, 'confirmed');
      const o = get('offers/b12');
      assert.deepEqual([o.price, o.cutPercent, o.driverPay], [1400, 30, 980]);
      assert.equal(env.ctx.packageName('local-12-hours'), '12 hours in the city');
    });

    test('not for guests, emergencies, or when INSTANT_BOOKINGS is off', () => {
      seedBooking(env.store, 'guest', { extra: { phone: s('9111473921') } });
      seedBooking(env.store, 'sos', { extra: { customerUid: s('u1'), package: s('medical-emergency'), phone: s('9111473922') } });
      env.ctx.tick();
      assert.equal(get('bookings/guest').status, 'new');
      assert.equal(get('bookings/sos').status, 'new');
      assert.ok(env.telegram.every((m) => !/Auto-confirmed/.test(m.text)));

      env.props.set('INSTANT_BOOKINGS', 'off');
      seedBooking(env.store, 'off', { msAgo: 1000, extra: { customerUid: s('u2'), phone: s('9111473923') } });
      env.ctx.tick();
      assert.equal(get('bookings/off').status, 'new');
      assert.ok(env.telegram.every((m) => !/Auto-confirmed/.test(m.text)));
    });
  });

  describe('accepted price (2)', () => {
    const trip = { to: 'Nagpur', destId: 'nagpur', kind: 'one-way', km: 284, days: 1, returnHours: 6, estFrom: 1440, estTo: 1600 };
    // Accepted prices are looked at every 4 minutes on the minute ticks (minute 2, 6 …) and on every doorbell.
    beforeEach(() => { env.clock.minute = 2; });

    test('a new trip whose price the customer accepted is confirmed and offered at that price', () => {
      booking('t1', { package: 'one-way-drop', trip, customerUid: 'u1', updatedAt: ago(20 * MIN), acceptedPrice: { amount: 1600, at: new Date() } });
      env.ctx.tick();
      assert.equal(get('bookings/t1').status, 'confirmed');
      assert.equal(get('offers/t1').price, 1600);
      assert.equal(env.telegram.filter((m) => /DB-1042 auto-confirmed<\/b>: the customer accepted ₹1,600/.test(m.text)).length, 1);
      env.ctx.tick();
      assert.equal(events('t1').filter((e) => e.to === 'confirmed').length, 1, 'once');
    });

    test('accepted before the robot numbered it: confirmed as it is numbered, told once', () => {
      seedBooking(env.store, 't0', {
        msAgo: 5000,
        extra: {
          package: s('one-way-drop'), customerUid: s('u1'),
          trip: env.ctx.toValue(trip), acceptedPrice: env.ctx.toValue({ amount: 1600, at: new Date() }),
        },
      });
      env.ctx.tick();
      assert.equal(get('bookings/t0').status, 'confirmed');
      assert.equal(env.telegram.filter((m) => /auto-confirmed<\/b>: the customer accepted ₹1,600/.test(m.text)).length, 1);
      assert.equal(env.telegram.filter((m) => /Offering it to drivers at that price/.test(m.text)).length, 0);
      assert.equal(get('offers/t0').price, 1600);
    });

    test('already confirmed: offered at the accepted price; with INSTANT_BOOKINGS off a new one waits for the office', () => {
      booking('t2', { package: 'one-way-drop', trip, customerUid: 'u1', status: 'confirmed', updatedAt: ago(20 * MIN), acceptedPrice: { amount: 1600, at: new Date() } });
      env.ctx.tick();
      assert.equal(get('offers/t2').price, 1600);
      env.props.set('INSTANT_BOOKINGS', 'off');
      booking('t3', { package: 'one-way-drop', trip, customerUid: 'u1', updatedAt: ago(20 * MIN), acceptedPrice: { amount: 1600, at: new Date() } });
      env.ctx.tick();
      assert.equal(get('bookings/t3').status, 'new');
      assert.ok(env.telegram.some((m) => /accepted ₹1,600 in the app\. Confirm it in \/admin/.test(m.text)));
    });
  });

  describe("can't make it (3)", () => {
    test('a released offer opens again from the first step, never to him, and he gets a strike', () => {
      booking('b1', { status: 'confirmed', assignedDriver: null, updatedAt: ago(MIN) });
      takenOffer('b1', { status: 'released', cutPercent: 20, driverPay: 480, by: 'admin1' });
      env.ctx.watchChanges_();
      const o = get('offers/b1');
      assert.deepEqual(
        [o.status, o.takenBy, o.takenAt, o.cutPercent, o.driverPay, o.by, [...o.cities], o.done],
        ['open', null, null, 30, 420, 'robot', ['Raipur', 'Bhilai', 'Durg'], false],
      );
      assert.ok(Date.now() - o.createdAt.getTime() < 5000, 'a fresh cycle');
      assert.deepEqual([...get('offerAlerts/b1').skipIds], ['d1']);
      assert.equal(get('drivers/d1').strikes, 2);
      assert.match(env.telegram.at(-1).text, /Raju Sahu gave back DB-1042<\/b>.* strike 2\. Offered to drivers again/);

      // He is online and nearest, but is not asked again; the others are.
      const online = (id, lat) => put(`availability/${id}`, { online: true, city: 'Raipur', name: id, phone: '9000000000', lat, lng: 81.63, pushToken: `ExponentPushToken[${id}]`, at: ago(MIN) });
      online('d1', 21.252);
      online('d2', 21.26);
      env.ctx.dispatchOffers_();
      assert.deepEqual(env.pushes.map((p) => p.to), ['ExponentPushToken[d2]']);
      env.ctx.watchChanges_();
      assert.equal(get('drivers/d1').strikes, 2, 'one strike per release');
    });

    test('if the booking was assigned or cancelled meanwhile, the offer is closed instead', () => {
      booking('b2', { status: 'cancelled', updatedAt: ago(MIN) });
      takenOffer('b2', { status: 'released' });
      env.ctx.watchChanges_();
      assert.equal(get('offers/b2').status, 'withdrawn');
    });
  });

  describe('reminders (4)', () => {
    test('an hour before: one push to the customer and one to the driver, once', () => {
      device('u1', 'p1', 'ExponentPushToken[customer0001]');
      device('u1', 'p2', 'ExponentPushToken[customer0002]', 'hi');
      put('availability/d1', { online: false, city: 'Raipur', name: 'Raju Sahu', phone: RAJU.phone, pushToken: 'ExponentPushToken[raju]', at: ago(MIN) });
      const soon = env.ctx.istStamp(Date.now() + 40 * MIN);
      booking('b1', { status: 'assigned', assignedDriver: RAJU, customerUid: 'u1', preferredTime: soon });
      booking('later', { status: 'assigned', assignedDriver: RAJU, customerUid: 'u1', preferredTime: env.ctx.istStamp(Date.now() + 3 * 3600_000) });
      booking('nodriver', { status: 'confirmed', customerUid: 'u1', preferredTime: soon });
      env.ctx.tripReminders_();
      env.ctx.tripReminders_();
      env.props.delete('remindedIds'); // even if the robot's quick list is lost
      env.ctx.tripReminders_();
      const time = env.ctx.clockText(soon);
      assert.deepEqual(env.pushes.map((p) => p.to), ['ExponentPushToken[customer0001]', 'ExponentPushToken[customer0002]', 'ExponentPushToken[raju]']);
      assert.equal(env.pushes[0].body, `Your driver Raju Sahu arrives at ${time}.`);
      assert.match(env.pushes[1].body, /Raju Sahu .* पर पहुँचेंगे/);
      assert.equal(env.pushes[2].body, `Job at ${time} · Shankar Nagar, Raipur · DB-1042`);
      assert.equal(env.pushes[2].channelId, 'jobs');
      assert.ok(get('reminders/b1').remindedAt);
    });
  });

  describe('trip taps (5)', () => {
    const tapped = (id, fields) => put(`tripTaps/${id}`, { driverPhone: RAJU.phone, ...fields });

    test('a local job: at Job done the bill (15-minute grace), completed by the robot, the offer done', () => {
      booking('b1', { status: 'assigned', assignedDriver: RAJU });
      takenOffer('b1');
      const arrived = ago(3 * 3600_000 + 16 * MIN + 30_000);
      tapped('b1', { leftAt: ago(4 * 3600_000), arrivedAt: arrived, doneAt: ago(30_000) });
      env.ctx.watchChanges_();
      const b = get('bookings/b1');
      assert.equal(b.status, 'completed');
      assert.equal(b.updatedBy, 'robot');
      assert.deepEqual(
        { ...b.localBill, at: undefined },
        { amount: 750, baseHours: 3, usedHours: 4, extraHours: 1, extraHourRate: 150, at: undefined },
      );
      assert.equal(get('offers/b1').done, true);
      assert.ok(events('b1').some((e) => e.from === 'assigned' && e.to === 'completed' && e.by === 'robot'));
      assert.match(env.telegram.at(-1).text, /DB-1042 done<\/b> — Raju Sahu: .*4 h \(package 3 h \+ 1 extra\)\. Bill ₹750/);
      const n = env.telegram.length;
      env.ctx.watchChanges_();
      env.store.docs.get('tripTaps/b1').doneAt = { timestampValue: new Date().toISOString() }; // even a tap seen again
      env.ctx.watchChanges_();
      assert.equal(env.telegram.length, n, 'billed once');
    });

    test('a full day offered at the estimate is billed at it, plus the extra hours; an admin-typed offer price too', () => {
      booking('f1', { status: 'assigned', assignedDriver: RAJU, package: 'local-full-day' });
      takenOffer('f1', { package: 'local-full-day', price: 1200, driverPay: 840, cutPercent: 30 });
      tapped('f1', { leftAt: ago(10 * 3600_000), arrivedAt: ago(9 * 3600_000 + 30 * MIN), doneAt: ago(0) }); // 9 h 30 m → 10 h, 2 extra
      booking('f2', { status: 'assigned', assignedDriver: RAJU, package: 'local-full-day' });
      takenOffer('f2', { package: 'local-full-day', price: 1100, driverPay: 820, cutPercent: 25, by: 'admin1' });
      tapped('f2', { leftAt: ago(9 * 3600_000), arrivedAt: ago(8 * 3600_000), doneAt: ago(0) });
      booking('f3', { status: 'assigned', assignedDriver: RAJU, package: 'local-full-day', quote: { amount: 1150 } });
      takenOffer('f3', { package: 'local-full-day', price: 1100, driverPay: 820 });
      tapped('f3', { leftAt: ago(9 * 3600_000), arrivedAt: ago(8 * 3600_000), doneAt: ago(0) });
      booking('f4', { status: 'assigned', assignedDriver: RAJU, package: 'local-full-day' });
      takenOffer('f4', { package: 'local-full-day', price: 1100, driverPay: 820, takenBy: { id: 'd2', name: 'Sonu Verma', phone: '9425212345' } });
      tapped('f4', { leftAt: ago(9 * 3600_000), arrivedAt: ago(8 * 3600_000), doneAt: ago(0) });
      env.ctx.watchChanges_();
      assert.equal(get('bookings/f1').localBill.amount, 1200 + 2 * 150);
      assert.equal(get('bookings/f2').localBill.amount, 1100);
      assert.equal(get('bookings/f3').localBill.amount, 1150, 'a quote beats the offer price');
      assert.equal(get('bookings/f4').localBill.amount, 1200, 'another driver’s offer is not his price: the estimate');
      assert.equal(get('offers/f1').done, true);
    });

    test('12 hours in the city: the meter starts at Arrived (clock.startAt, once), the bill has 12 hours and the 12-hour price', () => {
      booking('t12', { status: 'assigned', assignedDriver: RAJU, package: 'local-12-hours' });
      takenOffer('t12', { package: 'local-12-hours', price: 1400, driverPay: 980, cutPercent: 30 });
      const arrived = ago(2 * MIN);
      tapped('t12', { leftAt: ago(20 * MIN), arrivedAt: arrived });
      env.ctx.watchChanges_();
      let b = get('bookings/t12');
      assert.equal(b.clock.startAt.getTime(), arrived.getTime());
      assert.equal(b.status, 'assigned', 'still on the job');
      assert.equal(b.localBill, undefined);
      // Written once: a later change of the tap does not move it.
      env.store.docs.get('tripTaps/t12').arrivedAt = { timestampValue: ago(MIN).toISOString() };
      env.ctx.watchChanges_();
      assert.equal(get('bookings/t12').clock.startAt.getTime(), arrived.getTime());
      // Job done, 12 h 30 m after his Arrived tap (as his taps say).
      tapped('t12', { leftAt: ago(13 * 3600_000), arrivedAt: ago(12 * 3600_000 + 30 * MIN), doneAt: ago(0) });
      env.ctx.watchChanges_();
      b = get('bookings/t12');
      assert.deepEqual([b.status, b.localBill.baseHours, b.localBill.usedHours, b.localBill.extraHours, b.localBill.amount], ['completed', 12, 13, 1, 1400 + 150]);
      assert.equal(b.clock.startAt.getTime(), arrived.getTime(), 'the bill marks the end; the clock keeps only its start');
    });

    test('a trip keeps its own clock (Start); a local job gets no clock before Arrived', () => {
      booking('t1', { status: 'assigned', assignedDriver: RAJU, package: 'one-way-drop', trip: { to: 'Nagpur', kind: 'one-way' } });
      const left = ago(10 * MIN);
      tapped('t1', { leftAt: left, arrivedAt: ago(5 * MIN) });
      booking('b9', { status: 'assigned', assignedDriver: RAJU, package: '3-hours-600' });
      tapped('b9', { leftAt: ago(5 * MIN) });
      env.ctx.watchChanges_();
      assert.equal(get('bookings/t1').clock.startAt.getTime(), left.getTime());
      assert.equal(get('bookings/b9').clock, undefined);
    });

    test('within the grace minutes: no extra hour; a quote is the package price', () => {
      booking('b2', { status: 'assigned', assignedDriver: RAJU, quote: { amount: 700 } });
      tapped('b2', { leftAt: ago(4 * 3600_000), arrivedAt: ago(3 * 3600_000 + 15 * MIN), doneAt: ago(0) });
      env.ctx.watchChanges_();
      const bill = get('bookings/b2').localBill;
      assert.deepEqual([bill.amount, bill.usedHours, bill.extraHours], [700, 3, 0]);
    });

    test('a one-way drop: Start, Job done (car dropped), Reached home become the clock; Telegram once each', () => {
      booking('t1', { status: 'assigned', assignedDriver: RAJU, package: 'one-way-drop', trip: { to: 'Nagpur', kind: 'one-way' } });
      const left = ago(10 * MIN);
      tapped('t1', { leftAt: left });
      env.ctx.watchChanges_();
      assert.equal(get('bookings/t1').clock.startAt.getTime(), left.getTime());
      assert.match(env.telegram.at(-1).text, /DB-1042: trip started<\/b>\nRaju Sahu left for Nagpur/);
      const dropped = ago(5 * MIN);
      tapped('t1', { leftAt: left, arrivedAt: ago(9 * MIN), doneAt: dropped });
      env.ctx.watchChanges_();
      const home = ago(MIN);
      tapped('t1', { leftAt: left, arrivedAt: ago(9 * MIN), doneAt: dropped, homeAt: home });
      env.ctx.watchChanges_();
      env.ctx.watchChanges_();
      const c = get('bookings/t1').clock;
      assert.deepEqual([c.startAt, c.dropAt, c.homeAt].map((d) => d.getTime()), [left, dropped, home].map((d) => d.getTime()));
      assert.equal(env.telegram.length, 3);
      assert.match(env.telegram[2].text, /Raju Sahu is home<\/b>.*final bill is ready/s);
      assert.equal(get('bookings/t1').status, 'assigned', 'the office still saves the bill for trips');
    });

    test('a round trip: Job done is back home', () => {
      booking('t2', { status: 'assigned', assignedDriver: RAJU, package: 'outstation', trip: { to: 'Puri', kind: 'round' } });
      tapped('t2', { leftAt: ago(3 * MIN), arrivedAt: ago(2 * MIN), doneAt: ago(MIN) });
      env.ctx.watchChanges_();
      const c = get('bookings/t2').clock;
      assert.ok(c.startAt && c.homeAt && !c.dropAt);
      assert.match(env.telegram.at(-1).text, /trip over – Raju Sahu is back/);
    });

    test("taps from a driver who no longer has the job are not this trip's", () => {
      booking('b3', { status: 'assigned', assignedDriver: { id: 'd2', name: 'Sonu Verma', phone: '9425212345' } });
      tapped('b3', { leftAt: ago(4 * 3600_000), arrivedAt: ago(3 * 3600_000), doneAt: ago(0) });
      const n = env.telegram.length;
      env.ctx.watchChanges_();
      const b = get('bookings/b3');
      assert.equal(b.status, 'assigned');
      assert.equal(b.localBill, undefined);
      assert.equal(env.telegram.length, n);
    });

    describe('the train check at the drop (24 Nov 2026)', () => {
      const daily = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
      const rr = (from, trains) => ({
        success: true,
        data: { from: { code: from, name: `${from} Jn` }, to: { code: 'R', name: 'Raipur Jn' }, count: trains.length, trains },
      });
      const tr = (number, dep, arr) => ({
        train: { number, name: `Train ${number}`, type: 'Express', runDays: daily },
        from: { departure: dep, day: 1 }, to: { arrival: arr, day: 2 }, duration: null,
      });
      const ranchi = (extra = {}) =>
        booking('w1', {
          status: 'assigned', assignedDriver: RAJU, package: 'one-way-drop', customerUid: 'u1',
          trip: { to: 'Ranchi', destId: 'ranchi', kind: 'one-way', km: 616, days: 1, returnHours: 21, estFrom: 3350, estTo: 3350 }, ...extra,
        });

      test('Job done → the trains home with their prices, Telegram to the office, a push to the customer; once', () => {
        env.props.set('RAILRADAR_API_KEY', 'rr_live_SECRET123');
        env.rail.answer = (url) =>
          url.includes('/between/RNC/R') ? { code: 200, body: rr('RNC', [tr('18452', '21:40', '07:10'), tr('12874', '06:00', '05:30')]) } : { code: 200, body: rr('HTE', []) };
        device('u1', 'p1', 'ExponentPushToken[customer0001]', 'hi');
        ranchi();
        const dropped = ago(5 * MIN);
        tapped('w1', { leftAt: ago(13 * 3600_000), arrivedAt: ago(12 * 3600_000), doneAt: dropped });
        env.ctx.watchChanges_();
        const b = get('bookings/w1');
        const check = b.returnCheck;
        assert.ok(check && !check.failed, 'checked');
        assert.equal(check.dropAt.getTime(), dropped.getTime());
        assert.ok(check.options.length >= 1 && check.options.length <= 3);
        const r = env.ctx.oneWayOf(null);
        for (const o of check.options) {
          assert.ok(['18452', '12874'].includes(o.train));
          assert.ok(o.dep.getTime() >= dropped.getTime() + 90 * MIN, 'he can board 90 minutes after the drop');
          assert.equal(o.price, env.ctx.returnPriceOf(b, r, dropped.getTime(), o.dep.getTime()).price);
          assert.equal(o.waitMin, Math.round((o.dep.getTime() - dropped.getTime()) / MIN));
          assert.equal(o.change, null);
        }
        assert.ok(env.rail.calls.every((c) => !c.url.includes('date=')), 'whole timetables, saved and shared');
        const t = env.telegram.find((m) => /car dropped .* at Ranchi/.test(m.text));
        assert.ok(t && /Trains home: 1\) (18452|12874) /.test(t.text) && /the customer books his ticket/.test(t.text));
        const push = env.pushes.find((m) => m.data && m.data.bookingId === 'w1');
        assert.equal(push.body, 'ड्राइवर ने गाड़ी छोड़ दी है। उनके घर का टिकट बुक करें — एक ट्रेन चुनें।');
        // Once: the next minute does not look again.
        const calls = env.rail.calls.length;
        env.ctx.watchChanges_();
        assert.equal(env.rail.calls.length, calls);

        // "I booked this train": the final price with it, a push, a line for the office.
        const pick = check.options[0];
        const doc = env.store.docs.get('bookings/w1');
        doc.returnChoice = env.ctx.toValue({ train: pick.train, dep: pick.dep, at: new Date() });
        env.ctx.watchChanges_();
        const price = get('bookings/w1').returnPrice;
        assert.deepEqual([price.price, price.waitCharge, price.train], [pick.price, pick.waitCharge, pick.train]);
        assert.ok(env.pushes.some((m) => m.body === `ट्रेन ${pick.train} के साथ अंतिम कीमत ₹${env.ctx.inr(pick.price)}`));
        assert.ok(env.telegram.some((m) => m.text.includes(`booked train ${pick.train}`)));
        const n = env.pushes.length;
        env.ctx.watchChanges_();
        assert.equal(env.pushes.length, n, 'priced once');

        // Boarded: into the clock, and Telegram hears it.
        const boarded = ago(MIN);
        tapped('w1', { leftAt: ago(13 * 3600_000), arrivedAt: ago(12 * 3600_000), doneAt: dropped, boardAt: boarded });
        env.ctx.watchChanges_();
        assert.equal(get('bookings/w1').clock.boardAt.getTime(), boarded.getTime());
        assert.ok(env.telegram.some((m) => /Raju Sahu boarded his train home/.test(m.text)));
      });

      test('without the RailRadar key the check is written as failed: the office calls; a short drop gets no check', () => {
        ranchi();
        tapped('w1', { leftAt: ago(13 * 3600_000), arrivedAt: ago(12 * 3600_000), doneAt: ago(5 * MIN) });
        env.ctx.watchChanges_();
        assert.equal(get('bookings/w1').returnCheck.failed, true);
        assert.ok(env.telegram.some((m) => /could not be checked — call the customer/.test(m.text)));
        booking('w2', { status: 'assigned', assignedDriver: RAJU, package: 'one-way-drop', trip: { to: 'Bilaspur', destId: 'bilaspur', kind: 'one-way', km: 113, days: 1, returnHours: 4, estFrom: 1200, estTo: 1200 } });
        tapped('w2', { leftAt: ago(4 * 3600_000), arrivedAt: ago(3 * 3600_000), doneAt: ago(MIN) });
        env.ctx.watchChanges_();
        assert.equal(get('bookings/w2').returnCheck, undefined, 'up to 160 km: no train check');
      });
    });
  });

  describe('payment link (6) and the rating request (7)', () => {
    const completed = (id, extra = {}) =>
      booking(id, { status: 'completed', assignedDriver: RAJU, customerUid: 'u1', updatedAt: ago(MIN), localBill: { amount: 750, baseHours: 3, usedHours: 4, extraHours: 1, extraHourRate: 150, at: ago(MIN) }, ...extra });

    test('without Razorpay keys: no payment, nothing sent there; the rating request goes at once, once', () => {
      device('u1', 'p1', 'ExponentPushToken[customer0001]');
      completed('b1');
      env.ctx.watchChanges_();
      env.ctx.pollPayments_();
      assert.equal(env.rzp.calls.length, 0);
      assert.equal(get('bookings/b1').payment, undefined);
      const asks = env.pushes.filter((p) => p.title === 'How was your driver?');
      assert.equal(asks.length, 1);
      assert.equal(asks[0].body, 'How was your driver? Rate Raju Sahu — tap to give 1 to 5 stars.');
      assert.deepEqual({ ...asks[0].data }, { bookingId: 'b1', action: 'rate' });
      env.store.docs.get('bookings/b1').updatedAt = { timestampValue: new Date().toISOString() };
      env.ctx.watchChanges_();
      assert.equal(env.pushes.filter((p) => p.title === 'How was your driver?').length, 1, 'once');
    });

    test('with keys: a link for the bill; paid → the booking says so, then the rating request; the key is never logged', () => {
      env.props.set('RAZORPAY_KEY_ID', 'rzp_live_KEYID');
      env.props.set('RAZORPAY_KEY_SECRET', 'SECRETsecret123');
      device('u1', 'p1', 'ExponentPushToken[customer0001]');
      completed('b1');
      env.ctx.watchChanges_();
      assert.equal(env.rzp.calls.length, 1);
      const call = env.rzp.calls[0];
      assert.equal(call.url, 'https://api.razorpay.com/v1/payment_links');
      assert.equal(call.auth, 'Basic ' + Buffer.from('rzp_live_KEYID:SECRETsecret123').toString('base64'));
      assert.deepEqual([call.body.amount, call.body.reference_id, call.body.customer.contact, call.body.notify.sms], [75000, 'DB-1042', '+919111473929', true]);
      let p = get('bookings/b1').payment;
      assert.deepEqual([p.status, p.amount, p.url, p.linkId], ['pending', 750, 'https://rzp.io/i/plink_1', 'plink_1']);
      assert.equal(env.pushes.filter((m) => m.title === 'How was your driver?').length, 0, 'not before it is paid');

      env.ctx.pollPayments_();
      assert.equal(get('bookings/b1').payment.status, 'pending');
      env.rzp.links.get('plink_1').status = 'paid';
      env.ctx.pollPayments_();
      env.ctx.pollPayments_();
      p = get('bookings/b1').payment;
      assert.equal(p.status, 'paid');
      assert.ok(p.paidAt);
      assert.equal(env.pushes.filter((m) => m.title === 'How was your driver?').length, 1);
      assert.ok(env.telegram.some((m) => /DB-1042: ₹750 paid online/.test(m.text)));
      // Seen again later (an admin edit): no second link.
      env.store.docs.get('bookings/b1').updatedAt = { timestampValue: new Date().toISOString() };
      env.ctx.watchChanges_();
      assert.equal(env.rzp.calls.filter((c) => c.method === 'post').length, 1);
      const everything = JSON.stringify([env.warnings, env.telegram, [...env.store.docs.values()]]);
      assert.doesNotMatch(everything, /SECRETsecret123|rzp_live_KEYID/);
    });

    test('Razorpay refuses: Telegram once, no retry every minute, and the rating request still goes', () => {
      env.props.set('RAZORPAY_KEY_ID', 'rzp_live_KEYID');
      env.props.set('RAZORPAY_KEY_SECRET', 'SECRETsecret123');
      env.rzp.createCode = 400;
      device('u1', 'p1', 'ExponentPushToken[customer0001]');
      completed('b1');
      env.ctx.watchChanges_();
      env.store.docs.get('bookings/b1').updatedAt = { timestampValue: new Date().toISOString() };
      env.ctx.watchChanges_();
      assert.equal(env.rzp.calls.length, 1);
      assert.equal(env.telegram.filter((m) => /Could not make the payment link for DB-1042 \(Razorpay: The contact number is invalid\)/.test(m.text)).length, 1);
      assert.equal(env.pushes.filter((m) => m.title === 'How was your driver?').length, 1);
      assert.doesNotMatch(JSON.stringify(env.warnings), /SECRETsecret123/);
    });

    test('a completed booking without a bill gets no link, but the rating request', () => {
      env.props.set('RAZORPAY_KEY_ID', 'rzp_live_KEYID');
      env.props.set('RAZORPAY_KEY_SECRET', 'SECRETsecret123');
      device('u1', 'p1', 'ExponentPushToken[customer0001]');
      completed('b1', { localBill: null });
      env.ctx.watchChanges_();
      assert.equal(env.rzp.calls.length, 0);
      assert.equal(env.pushes.filter((m) => m.title === 'How was your driver?').length, 1);
    });
  });

  describe('ratings (7, 10)', () => {
    const rate = (id, stars, extra = {}) =>
      put(`ratings/${id}`, { stars, comment: '', driverId: 'd1', customerUid: 'u1', at: ago(MIN), ...extra });

    test("ratings make the driver's average and count; 5 stars → the Google review link", () => {
      device('u1', 'p1', 'ExponentPushToken[customer0001]');
      rate('old1', 4, { at: ago(86_400_000) });
      rate('old2', 3, { at: ago(86_400_000) });
      rate('b9', 5);
      env.ctx.processRatingsStep_();
      const d = get('drivers/d1');
      assert.deepEqual([d.ratingAvg, d.ratingCount], [4, 3]);
      const thanks = env.pushes.filter((p) => p.title === 'Thank you!');
      assert.equal(thanks.length, 1);
      assert.equal(thanks[0].data.url, 'https://search.google.com/local/writereview?placeid=P1');
      assert.deepEqual(plain(JSON.parse(env.props.get('driverQuality')).d1), { ratingAvg: 4, ratingCount: 3, strikes: 1 });
      env.ctx.processRatingsStep_();
      assert.equal(env.pushes.length, 1, 'each rating once');
    });

    test('below 3.5 with 5+ ratings: Telegram asks once — never paused by itself', () => {
      [3, 3, 4, 3, 3].forEach((n, i) => rate(`o${i}`, n, { at: ago(86_400_000) }));
      rate('b9', 3);
      env.ctx.processRatingsStep_();
      const asks = env.telegram.filter((m) => /rating is/.test(m.text));
      assert.equal(asks.length, 1);
      assert.equal(asks[0].text, "⚠️ Raju Sahu's rating is 3.2 (6 ratings) — pause him in /admin?");
      assert.equal(get('drivers/d1').status, 'active');
      rate('b10', 2, { at: new Date() });
      env.ctx.processRatingsStep_();
      assert.equal(env.telegram.filter((m) => /rating is/.test(m.text)).length, 1, 'once');
    });

    test('dispatch puts a poorly rated driver after the others', () => {
      const online = (id, lat) => put(`availability/${id}`, { online: true, city: 'Raipur', name: id, phone: '9000000000', lat, lng: 81.63, pushToken: `ExponentPushToken[${id}]`, at: ago(MIN) });
      online('d1', 21.252);
      online('d2', 21.26);
      online('d3', 21.28);
      online('d4', 21.35);
      env.props.set('driverQuality', JSON.stringify({ d1: { ratingAvg: 3.6, ratingCount: 5, strikes: 0 } }));
      booking('b1', { status: 'confirmed', updatedAt: ago(1000) });
      env.ctx.autoOffers_();
      env.ctx.dispatchOffers_();
      assert.deepEqual(env.pushes.map((p) => p.to), ['ExponentPushToken[d2]', 'ExponentPushToken[d3]', 'ExponentPushToken[d4]']);
    });
  });

  describe('weekly payouts (9)', () => {
    const week = () => env.ctx.istDay(Date.now());
    const pressed = (updateId, chatId) => ({
      update_id: updateId,
      callback_query: { id: `cq${updateId}`, data: `paid:d1:${week()}`, message: { message_id: 77, chat: { id: chatId }, text: 'Pay Raju Sahu ₹900 · UPI raju@okaxis · 2 jobs' } },
    });

    beforeEach(() => {
      put('drivers/d1', { name: 'Raju Sahu', phone: RAJU.phone, city: 'Raipur', status: 'active', upi: 'raju@okaxis' });
      takenOffer('o1', { done: true, driverPay: 450, ref: 'DB-1041' });
      takenOffer('o2', { done: true, driverPay: 450, ref: 'DB-1042' });
      takenOffer('o3', { done: false }); // not finished yet
      takenOffer('o4', { done: true, paid: true, paidAt: ago(86_400_000) }); // paid last week
    });

    test('Monday: one message per driver with the total, his UPI ID, the jobs and a Paid ✓ button', () => {
      env.ctx.weeklyPayouts();
      assert.equal(env.telegram.length, 1);
      assert.equal(env.telegram[0].text, 'Pay Raju Sahu ₹900 · UPI raju@okaxis · 2 jobs\nDB-1041, DB-1042');
      assert.equal(env.telegram[0].reply_markup.inline_keyboard[0][0].callback_data, `paid:d1:${week()}`);
    });

    test('Paid ✓ from the office chat marks the jobs paid; from any other chat it is ignored', () => {
      env.ctx.telegramCallbacks_();
      assert.equal(env.tg.calls.length, 0, 'nothing waiting: Telegram is not even asked');
      env.ctx.weeklyPayouts();

      env.tg.updates.push(pressed(10, 999)); // someone else's chat
      env.ctx.telegramCallbacks_();
      assert.equal(get('offers/o1').paid, false);
      assert.deepEqual(env.tg.calls.map((c) => c.method), ['getUpdates']);
      assert.equal(env.props.get('telegramUpdateId'), '10');

      env.tg.updates.push(pressed(11, 555)); // the office (TELEGRAM_CHAT_ID)
      env.ctx.telegramCallbacks_();
      assert.equal(env.tg.calls.at(-3).body.offset, 11, 'asks only for updates after the last one seen');
      for (const id of ['o1', 'o2']) {
        const o = get(`offers/${id}`);
        assert.equal(o.paid, true);
        assert.ok(o.paidAt);
      }
      assert.equal(get('offers/o3').paid, false);
      const [answer, edit] = env.tg.calls.slice(-2);
      assert.deepEqual([answer.method, answer.body.callback_query_id], ['answerCallbackQuery', 'cq11']);
      assert.equal(edit.method, 'editMessageText');
      assert.deepEqual([edit.body.chat_id, edit.body.message_id], [555, 77]);
      assert.match(edit.body.text, /\n\nPaid ✓ /);

      // Done: nothing waits, so the robot stops asking Telegram.
      const calls = env.tg.calls.length;
      env.ctx.telegramCallbacks_();
      assert.equal(env.tg.calls.length, calls);
    });

    test('chats that wrote to the bot meanwhile are kept for setup', () => {
      env.ctx.weeklyPayouts();
      env.tg.updates.push({ update_id: 5, message: { chat: { id: 4242 }, text: 'hi' } });
      env.ctx.telegramCallbacks_();
      assert.deepEqual(JSON.parse(env.props.get('telegramSeenChats')), ['4242']);
    });
  });

  describe('nearby cities (12)', () => {
    const online = (id, city, lat, lng) =>
      put(`availability/${id}`, { online: true, city, name: id, phone: '9000000000', lat, lng, pushToken: `ExponentPushToken[${id}]`, at: ago(MIN) });

    test('one zone: a Raipur job reaches a Bhilai-registered driver standing in Raipur at once, nearest first', () => {
      online('r1', 'Raipur', 21.30, 81.70); // a Raipur driver farther away
      online('b1', 'Bhilai', 21.252, 81.63); // registered in Bhilai, waiting near the pickup
      online('z1', 'Bilaspur', 22.08, 82.14);
      booking('x1', { status: 'confirmed', updatedAt: ago(1000) });
      env.ctx.autoOffers_();
      assert.deepEqual([...get('offers/x1').cities], ['Raipur', 'Bhilai', 'Durg']);
      env.ctx.dispatchOffers_();
      assert.deepEqual(env.pushes.map((p) => p.to), ['ExponentPushToken[b1]', 'ExponentPushToken[r1]'], 'nearest first; never Bilaspur');
    });

    test('an older offer (its own city only), 10 minutes at the top pay: Bhilai and Durg drivers too, the customer hears once', () => {
      device('u1', 'p1', 'ExponentPushToken[customer0001]');
      online('r1', 'Raipur', 21.252, 81.63);
      online('b1', 'Bhilai', 21.19, 81.35);
      booking('x1', { status: 'confirmed', customerUid: 'u1', updatedAt: ago(1000) });
      takenOffer('x1', { status: 'open', takenBy: null, takenAt: null, cutPercent: 30, driverPay: 420, cities: ['Raipur'], createdAt: ago(1000) });
      env.ctx.dispatchOffers_(); // the Raipur driver hears
      assert.deepEqual(env.pushes.map((p) => p.to), ['ExponentPushToken[r1]']);
      env.store.docs.get('offers/x1').createdAt = { timestampValue: ago(13 * MIN).toISOString() };
      env.ctx.dispatchOffers_();
      assert.deepEqual([...get('offers/x1').cities], ['Raipur'], 'not yet');
      env.store.docs.get('offers/x1').createdAt = { timestampValue: ago(14 * MIN + 5000).toISOString() };
      env.ctx.dispatchOffers_();
      assert.deepEqual([...get('offers/x1').cities], ['Raipur', 'Bhilai', 'Durg']);
      assert.ok(env.pushes.some((p) => p.to === 'ExponentPushToken[b1]'), 'the Bhilai driver hears');
      const still = env.pushes.filter((p) => p.title === 'Still finding your driver');
      assert.equal(still.length, 1);
      assert.equal(env.telegram.filter((m) => /offered to Bhilai and Durg drivers too/.test(m.text)).length, 1);
      env.ctx.dispatchOffers_();
      env.ctx.dispatchOffers_();
      assert.equal(env.pushes.filter((p) => p.title === 'Still finding your driver').length, 1, 'once');
    });

    test('pure: the zones', () => {
      const { zoneOf } = env.ctx;
      assert.deepEqual([...zoneOf('Raipur')], ['Raipur', 'Bhilai', 'Durg']);
      assert.deepEqual([...zoneOf('Bhilai')], ['Bhilai', 'Raipur', 'Durg']);
      assert.deepEqual([...zoneOf('Durg')], ['Durg', 'Raipur', 'Bhilai']);
      assert.deepEqual([...zoneOf('Bilaspur')], ['Bilaspur']);
      assert.deepEqual([...zoneOf('Korba')], ['Korba']);
    });
  });

  describe('payments without a gateway (UPI link, the driver confirms, cash settlement)', () => {
    const tapped = (id, fields) => put(`tripTaps/${id}`, { driverPhone: RAJU.phone, ...fields });
    const doneTaps = () => ({ leftAt: ago(4 * 3600_000), arrivedAt: ago(3 * 3600_000 + 16 * MIN + 30_000), doneAt: ago(30_000) });
    const asks = () => env.pushes.filter((p) => p.title === 'How was your driver?');
    // An office edit: updatedAt moves on (a second later, never the bookmark's own millisecond).
    const touch = (id) => { env.store.docs.get(`bookings/${id}`).updatedAt = { timestampValue: new Date(Date.now() + 1000).toISOString() }; };

    test('pure: the UPI link, its encoding, the UPI ID check, Razorpay first', () => {
      const { upiPayUrl, upiIdOf, paymentLinkKind } = env.ctx;
      assert.equal(upiPayUrl('drivebuddy@ybl', 'DriveBuddy', 750, 'DB-1042'), 'upi://pay?pa=drivebuddy%40ybl&pn=DriveBuddy&am=750.00&cu=INR&tn=DB-1042');
      assert.equal(upiPayUrl('drive.buddy-1@okaxis', 'Drive Buddy & Co', 1350, 'DB 7/8'), 'upi://pay?pa=drive.buddy-1%40okaxis&pn=Drive%20Buddy%20%26%20Co&am=1350.00&cu=INR&tn=DB%207%2F8');
      assert.equal(upiIdOf(' drivebuddy@ybl '), 'drivebuddy@ybl');
      for (const bad of ['', 'drivebuddy', 'd@ybl', 'drivebuddy@y', 'drive buddy@ybl', 'drivebuddy@ybl1', 'a@b@ybl', null]) assert.equal(upiIdOf(bad), '', String(bad));
      assert.equal(paymentLinkKind(true, 'drivebuddy@ybl'), 'razorpay');
      assert.equal(paymentLinkKind(false, 'drivebuddy@ybl'), 'upi');
      assert.equal(paymentLinkKind(false, ''), '');
    });

    test('UPI_ID set: a local job done → a UPI link on the booking, no rating request yet', () => {
      env.props.set('UPI_ID', 'drivebuddy@ybl');
      device('u1', 'p1', 'ExponentPushToken[customer0001]');
      booking('b1', { status: 'assigned', assignedDriver: RAJU, customerUid: 'u1' });
      takenOffer('b1');
      tapped('b1', doneTaps());
      env.ctx.watchChanges_(); // Job done: bill, completed
      env.ctx.watchChanges_(); // the completed booking: the link
      const p = get('bookings/b1').payment;
      assert.deepEqual([p.status, p.method, p.amount, p.url], ['pending', 'upi', 750, 'upi://pay?pa=drivebuddy%40ybl&pn=DriveBuddy&am=750.00&cu=INR&tn=DB-1042']);
      assert.ok(p.at);
      assert.equal(asks().length, 0, 'the rating request waits for the payment');
      assert.equal(env.rzp.calls.length, 0);
      env.props.set('UPI_NAME', 'DriveBuddy Raipur');
      booking('b2', { status: 'completed', updatedAt: new Date(), localBill: { amount: 300 } });
      env.ctx.watchChanges_();
      assert.match(get('bookings/b2').payment.url, /&pn=DriveBuddy%20Raipur&am=300\.00&/);
    });

    test('no UPI_ID (or not a UPI ID) and no Razorpay keys: no link, the rating request at once', () => {
      env.props.set('UPI_ID', 'not a upi id');
      device('u1', 'p1', 'ExponentPushToken[customer0001]');
      booking('b1', { status: 'completed', assignedDriver: RAJU, customerUid: 'u1', updatedAt: ago(MIN), localBill: { amount: 750 } });
      env.ctx.watchChanges_();
      assert.equal(get('bookings/b1').payment, undefined);
      assert.equal(asks().length, 1);
    });

    test('Razorpay keys and UPI_ID both set: Razorpay is used', () => {
      env.props.set('UPI_ID', 'drivebuddy@ybl');
      env.props.set('RAZORPAY_KEY_ID', 'rzp_live_KEYID');
      env.props.set('RAZORPAY_KEY_SECRET', 'SECRETsecret123');
      booking('b1', { status: 'completed', assignedDriver: RAJU, customerUid: 'u1', updatedAt: ago(MIN), localBill: { amount: 750 } });
      env.ctx.watchChanges_();
      const p = get('bookings/b1').payment;
      assert.deepEqual([p.method, p.url, p.linkId], ['razorpay', 'https://rzp.io/i/plink_1', 'plink_1']);
      assert.equal(env.rzp.calls.length, 1);
    });

    test('the driver is never sent the price: his taps hold only his own times, at Job done and after a trip bill', () => {
      env.props.set('UPI_ID', 'drivebuddy@ybl');
      booking('b1', { status: 'assigned', assignedDriver: RAJU });
      takenOffer('b1');
      tapped('b1', doneTaps());
      booking('t1', { status: 'completed', assignedDriver: RAJU, package: 'outstation', updatedAt: new Date(), bill: { amount: 5200 } });
      tapped('t1', { leftAt: ago(3 * 86_400_000), arrivedAt: ago(3 * 86_400_000), doneAt: ago(3600_000) });
      booking('t2', { status: 'completed', assignedDriver: RAJU, package: 'outstation', updatedAt: new Date(), bill: { amount: 4100 } });
      env.ctx.watchChanges_();
      env.ctx.watchChanges_();
      assert.equal(get('bookings/b1').localBill.amount, 750);
      for (const [path, f] of env.store.docs) {
        if (!path.startsWith('tripTaps/')) continue;
        assert.deepEqual(Object.keys(f).filter((k) => !['driverPhone', 'leftAt', 'arrivedAt', 'doneAt', 'homeAt'].includes(k)), [], path);
      }
      assert.equal(env.store.docs.has('tripTaps/t2'), false, 'no taps document is made');
    });

    test('paid in cash: the booking is paid, the cash goes on his offer, Telegram, then the rating request', () => {
      env.props.set('UPI_ID', 'drivebuddy@ybl');
      device('u1', 'p1', 'ExponentPushToken[customer0001]');
      booking('b1', { status: 'assigned', assignedDriver: RAJU, customerUid: 'u1' });
      takenOffer('b1');
      tapped('b1', doneTaps());
      env.ctx.watchChanges_();
      env.ctx.watchChanges_();
      assert.equal(get('bookings/b1').payment.status, 'pending');
      const paidAt = ago(5000);
      tapped('b1', { ...doneTaps(), paidBy: 'cash', paidAt });
      env.ctx.watchChanges_();
      const p = get('bookings/b1').payment;
      assert.deepEqual([p.status, p.method, p.amount, p.by, p.url], ['paid', 'cash', 750, 'driver', undefined], 'over the pending UPI link');
      assert.equal(p.paidAt.getTime(), paidAt.getTime());
      assert.equal(get('offers/b1').cashCollected, 750);
      assert.equal(env.telegram.filter((m) => m.text === '💰 DB-1042: Raju Sahu collected ₹750 in cash').length, 1);
      assert.equal(asks().length, 1);
      assert.equal(JSON.parse(env.props.get('driverQuality')).d1.owed, 300, 'cash he kept 750 − earned 450');
      env.ctx.watchChanges_();
      touch('b1');
      env.ctx.watchChanges_();
      assert.equal(env.telegram.filter((m) => /collected/.test(m.text)).length, 1, 'once');
      assert.equal(asks().length, 1, 'asked once');
    });

    test('paid by UPI: over the pending link, no cash on the offer', () => {
      booking('b1', {
        status: 'completed', assignedDriver: RAJU, updatedAt: ago(20 * MIN), localBill: { amount: 750 },
        payment: { status: 'pending', method: 'upi', amount: 750, url: 'upi://pay?pa=drivebuddy%40ybl', at: ago(20 * MIN) },
      });
      takenOffer('b1', { done: true });
      tapped('b1', { ...doneTaps(), paidBy: 'upi', paidAt: ago(1000) });
      env.ctx.watchChanges_();
      const p = get('bookings/b1').payment;
      assert.deepEqual([p.status, p.method, p.amount, p.by, p.url], ['paid', 'upi', 750, 'driver', undefined]);
      assert.equal(get('offers/b1').cashCollected, undefined);
      assert.ok(env.telegram.some((m) => m.text === '💰 DB-1042: Raju Sahu collected ₹750 by UPI'));
    });

    test('paid before the trip bill: nothing yet; when the office saves the bill, the booking is paid', () => {
      booking('t1', { status: 'assigned', assignedDriver: RAJU, package: 'outstation' });
      takenOffer('t1');
      tapped('t1', { leftAt: ago(3 * 86_400_000), arrivedAt: ago(3 * 86_400_000), doneAt: ago(3600_000), paidBy: 'cash', paidAt: ago(1000) });
      env.ctx.watchChanges_();
      assert.equal(get('bookings/t1').payment, undefined, 'no amount yet');
      env.store.docs.get('bookings/t1').bill = env.ctx.toValue({ amount: 5200 });
      env.store.docs.get('bookings/t1').status = { stringValue: 'completed' };
      touch('t1');
      env.ctx.watchChanges_();
      assert.deepEqual([get('bookings/t1').payment.status, get('bookings/t1').payment.method, get('bookings/t1').payment.amount], ['paid', 'cash', 5200]);
      assert.equal(get('offers/t1').cashCollected, 5200);
    });

    test("a tap from a driver who no longer has the job, or on a cancelled job, is not a payment", () => {
      booking('b1', { status: 'completed', assignedDriver: { id: 'd2', name: 'Sonu Verma', phone: '9425212345' }, updatedAt: ago(20 * MIN), localBill: { amount: 750 } });
      tapped('b1', { ...doneTaps(), paidBy: 'cash', paidAt: ago(1000) });
      booking('b2', { status: 'cancelled', assignedDriver: RAJU, updatedAt: ago(20 * MIN), localBill: { amount: 750 } });
      tapped('b2', { ...doneTaps(), paidBy: 'upi', paidAt: ago(1000) });
      env.ctx.watchChanges_();
      assert.equal(get('bookings/b1').payment, undefined);
      assert.equal(get('bookings/b2').payment, undefined);
    });

    test('already paid online: the driver’s tap does not change it, Telegram asks to check', () => {
      booking('b1', {
        status: 'completed', assignedDriver: RAJU, updatedAt: ago(20 * MIN), localBill: { amount: 750 },
        payment: { status: 'paid', method: 'razorpay', amount: 750, url: 'https://rzp.io/i/x', linkId: 'x', at: ago(MIN), paidAt: ago(MIN) },
      });
      tapped('b1', { ...doneTaps(), paidBy: 'cash', paidAt: ago(1000) });
      env.ctx.watchChanges_();
      assert.equal(get('bookings/b1').payment.method, 'razorpay');
      assert.ok(env.telegram.some((m) => /says he was paid in cash, but it was already paid online/.test(m.text)));
    });

    test('pure: the payout is what he earned minus the cash he kept — three wordings', () => {
      const off = (id, driverPay, cashCollected, ref) => ({ id, data: { status: 'taken', done: true, paid: false, driverPay, cashCollected, takenBy: RAJU, ref } });
      const msg = (rows) => {
        const [g] = env.ctx.payoutGroups(rows);
        return env.ctx.payoutTelegram({ ...g, upi: 'raju@okaxis' }, '2026-11-23');
      };
      const pay = msg([off('a', 450, 900, 'DB-1'), off('b', 450, undefined, 'DB-2'), off('c', 450, 0, 'DB-3')]);
      assert.equal(pay.text, 'Pay Raju Sahu ₹450 · UPI raju@okaxis · 3 jobs (earned ₹1,350 − cash he kept ₹900)\nDB-1, DB-2, DB-3');
      assert.equal(pay.reply_markup.inline_keyboard[0][0].text, 'Paid ✓');
      const owes = msg([off('a', 450, 1200), off('b', 450, 0)]);
      assert.equal(owes.text, 'Raju Sahu owes DriveBuddy ₹300 (cash he kept ₹1,200, earned ₹900) — collect it');
      assert.deepEqual(plain(owes.reply_markup), { inline_keyboard: [[{ text: 'Settled ✓', callback_data: 'paid:d1:2026-11-23' }]] });
      const even = msg([off('a', 450, 900), off('b', 450, 0)]);
      assert.equal(even.text, 'Raju Sahu: earned ₹900 = cash he kept · nothing to pay');
      assert.equal(even.reply_markup.inline_keyboard[0][0].text, 'Settled ✓');
      const [g] = env.ctx.payoutGroups([off('a', 450, 1200), off('b', 450, -5), off('c', 450, 2.5)]);
      assert.deepEqual([g.amount, g.cash, g.net], [1350, 1200, 150], 'odd cash values count as none');
    });

    test('Monday: a driver who owes gets "collect it" + Settled ✓; pressing it settles his jobs', () => {
      put('drivers/d1', { name: 'Raju Sahu', phone: RAJU.phone, city: 'Raipur', status: 'active', upi: 'raju@okaxis' });
      takenOffer('o1', { done: true, driverPay: 450, cashCollected: 1200, ref: 'DB-1041' });
      takenOffer('o2', { done: true, driverPay: 450, ref: 'DB-1042' });
      env.ctx.weeklyPayouts();
      assert.equal(env.telegram[0].text, 'Raju Sahu owes DriveBuddy ₹300 (cash he kept ₹1,200, earned ₹900) — collect it\nDB-1041, DB-1042');
      const week = env.ctx.istDay(Date.now());
      env.tg.updates.push({ update_id: 3, callback_query: { id: 'cq3', data: `paid:d1:${week}`, message: { message_id: 9, chat: { id: 555 }, text: env.telegram[0].text } } });
      env.ctx.telegramCallbacks_();
      assert.equal(get('offers/o1').paid, true);
      assert.equal(get('offers/o2').paid, true);
      const edit = env.tg.calls.find((c) => c.method === 'editMessageText');
      assert.match(edit.body.text, /\n\nSettled ✓ /);
      assert.equal(env.tg.calls.find((c) => c.method === 'answerCallbackQuery').body.text, 'Marked settled ✓');
    });

    test('cash limit: over it, he is left out of job alerts, Telegram once, a reminder once a day; settled, he is back', () => {
      env.props.set('UPI_ID', 'drivebuddy@ybl');
      env.ctx.SETTLE_PUSH_FROM_HOUR = 0; // any hour, for the test
      env.ctx.SETTLE_PUSH_TO_HOUR = 24;
      const online = (id, lat) => put(`availability/${id}`, { online: true, city: 'Raipur', name: id, phone: '9000000000', lat, lng: 81.63, pushToken: `ExponentPushToken[${id}]`, at: ago(MIN) });
      online('d1', 21.252); // Raju, nearest
      online('d2', 21.26);
      takenOffer('o1', { done: true, driverPay: 450, cashCollected: 2400, ref: 'DB-1040' }); // holds 1,950: under 2,000
      booking('b1', { status: 'assigned', assignedDriver: RAJU });
      takenOffer('b1');
      tapped('b1', { ...doneTaps(), paidBy: 'cash', paidAt: ago(1000) });
      env.ctx.watchChanges_(); // done and paid in the same minute: 750 more in cash − 450 earned → 2,250
      assert.equal(get('offers/b1').cashCollected, 750);
      const q = JSON.parse(env.props.get('driverQuality')).d1;
      assert.deepEqual([q.owed, q.overLimit], [2250, true]);
      const over = env.telegram.filter((m) => /holds ₹2,250 of DriveBuddy's cash<\/b> — over the ₹2,000 limit/.test(m.text));
      assert.equal(over.length, 1);
      assert.match(over[0].text, /Raju Sahu owes DriveBuddy ₹2,250/);
      assert.equal(over[0].reply_markup.inline_keyboard[0][0].text, 'Settled ✓');

      booking('n1', { status: 'confirmed', updatedAt: ago(1000) });
      env.ctx.autoOffers_();
      env.ctx.dispatchOffers_();
      assert.deepEqual(env.pushes.filter((p) => p.channelId === 'jobs' && p.data.offerId).map((p) => p.to), ['ExponentPushToken[d2]'], 'not to him');

      env.ctx.cashLimits_();
      env.ctx.cashLimits_();
      const settle = env.pushes.filter((p) => p.title === 'Settle your cash · नकद जमा करें');
      assert.equal(settle.length, 1, 'once a day');
      assert.equal(settle[0].to, 'ExponentPushToken[d1]');
      assert.equal(settle[0].body, 'Settle ₹2,250 with DriveBuddy to get new jobs · नए काम के लिए DriveBuddy को ₹2,250 जमा करें');
      assert.equal(env.telegram.filter((m) => /over the ₹2,000 limit/.test(m.text)).length, 1, 'Telegram once');

      // The office collects and marks his jobs paid in /admin: within 5 minutes he gets alerts again.
      for (const id of ['o1', 'b1']) env.store.docs.get(`offers/${id}`).paid = { booleanValue: true };
      env.ctx.cashLimits_();
      assert.deepEqual([JSON.parse(env.props.get('driverQuality')).d1.owed, JSON.parse(env.props.get('driverQuality')).d1.overLimit], [0, false]);
      booking('n2', { status: 'confirmed', updatedAt: new Date() });
      env.ctx.autoOffers_();
      env.ctx.dispatchOffers_();
      assert.ok(env.pushes.some((p) => p.to === 'ExponentPushToken[d1]' && p.data.offerId === 'n2'));
    });

    test('pure: the limit, and only above it', () => {
      const { cashLimitOf, overCashLimit, rankDrivers } = env.ctx;
      assert.equal(cashLimitOf({ cashLimit: 2000 }), 2000);
      assert.equal(cashLimitOf({}), 0);
      assert.equal(cashLimitOf(null), 0);
      assert.equal(overCashLimit({ owed: 2000 }, 2000), false, 'at the limit is fine');
      assert.equal(overCashLimit({ owed: 2001 }, 2000), true);
      assert.equal(overCashLimit({ owed: 9000 }, 0), false, 'no limit: nobody is left out');
      const now = Date.now();
      const rows = [{ id: 'a', data: { online: true, pushToken: 'Ta', at: new Date(now - MIN), lat: 21.252, lng: 81.63 } }, { id: 'b', data: { online: true, pushToken: 'Tb', at: new Date(now - MIN), lat: 21.26, lng: 81.63 } }];
      assert.deepEqual(rankDrivers(rows, { lat: 21.2514, lng: 81.6296 }, now, { a: { owed: 2500 } }, 2000).map((d) => d.id), ['b']);
      assert.deepEqual(rankDrivers(rows, { lat: 21.2514, lng: 81.6296 }, now, { a: { owed: 2500 } }, 0).map((d) => d.id), ['a', 'b']);
    });

    test('9 pm: payments today by UPI, cash and unpaid; the cash each driver holds is worked out again', () => {
      const today = ago(1000);
      booking('u1', { createdAt: today, status: 'completed', updatedAt: today, localBill: { amount: 750 }, payment: { status: 'paid', method: 'upi', amount: 750, by: 'driver', paidAt: today, at: today } });
      booking('c1', { createdAt: today, status: 'completed', updatedAt: today, localBill: { amount: 300 }, payment: { status: 'paid', method: 'cash', amount: 300, by: 'driver', paidAt: today, at: today } });
      booking('c2', { createdAt: today, status: 'completed', updatedAt: today, localBill: { amount: 600 }, payment: { status: 'paid', method: 'cash', amount: 600, by: 'driver', paidAt: today, at: today } });
      booking('x1', { createdAt: today, status: 'completed', updatedAt: today, localBill: { amount: 1000 }, payment: { status: 'pending', method: 'upi', amount: 1000, url: 'upi://pay?pa=a%40ybl', at: today } });
      takenOffer('o1', { done: true, driverPay: 450, cashCollected: 2600, updatedAt: today });
      env.ctx.dailyReport();
      const t = env.telegram.find((m) => /DriveBuddy today/.test(m.text)).text;
      assert.match(t, /<b>Payments today:<\/b> UPI ₹750 \(1\) · cash ₹900 \(2\) · unpaid ₹1,000 \(1\)\n/);
      assert.match(t, /<b>Payouts due:<\/b> none · ₹2,150 to collect from 1 driver$/);
      const q = JSON.parse(env.props.get('driverQuality'));
      assert.deepEqual([q.d1.owed, q.d1.overLimit], [2150, true]);
      assert.equal(env.telegram.filter((m) => /over the ₹2,000 limit/.test(m.text)).length, 1);
      env.ctx.dailyReport();
      assert.equal(env.telegram.filter((m) => /over the ₹2,000 limit/.test(m.text)).length, 1, 'once, not every night');
    });
  });

  describe('call to confirm the driver who took a job', () => {
    // The Driver app's take: the booking assigned to him, updatedBy his login (firestore.rules).
    const took = (id = 'b1', extra = {}) => {
      booking(id, { status: 'assigned', assignedDriver: RAJU, updatedBy: `driver-${RAJU.phone}`, updatedAt: new Date(), preferredTime: '2026-11-22T15:30', customerUid: 'u1', ...extra });
      takenOffer(id);
    };
    const press = (updateId, data, chatId = 555) => {
      env.tg.updates.push({ update_id: updateId, callback_query: { id: `cq${updateId}`, data, message: { message_id: 40 + updateId, chat: { id: chatId }, text: 'DB-1042: Raju Sahu took it — call him to confirm' } } });
      env.ctx.telegramCallbacks_();
    };
    const asked = () => env.telegram.filter((m) => /took it — call him to confirm/.test(m.text));
    const answers = () => env.tg.calls.filter((c) => c.method === 'answerCallbackQuery').map((c) => c.body.text);
    const pendingConfirms = () => JSON.parse(env.props.get('confirmsPending') || '{}');

    test('pure: the callbacks and the short time', () => {
      assert.deepEqual(plain(env.ctx.parseConfirmCallback('conf:b1')), { action: 'conf', bookingId: 'b1' });
      assert.deepEqual(plain(env.ctx.parseConfirmCallback('redo:AbC_12-x')), { action: 'redo', bookingId: 'AbC_12-x' });
      for (const bad of ['conf:', 'conf:../x', 'yes:b1', 'paid:d1:2026-11-23', null]) assert.equal(env.ctx.parseConfirmCallback(bad), null);
      assert.ok(new TextEncoder().encode('redo:' + 'x'.repeat(20)).length <= 64);
      assert.equal(env.ctx.shortWhen('2026-11-22T15:30'), 'Sun 3:30 pm');
      assert.equal(env.ctx.shortWhen(''), 'ASAP');
    });

    test('a take in the app: Telegram asks the office to call him, once, with the two buttons', () => {
      took();
      env.ctx.watchChanges_();
      env.ctx.watchChanges_();
      assert.equal(asked().length, 1);
      assert.equal(asked()[0].text, '<b>DB-1042</b>: Raju Sahu took it — call him to confirm · <a href="tel:+919893302783">98933 02783</a> · 3 hours · Sun 3:30 pm · Shankar Nagar, Raipur');
      assert.deepEqual(plain(asked()[0].reply_markup), { inline_keyboard: [[{ text: 'Confirmed ✓', callback_data: 'conf:b1' }, { text: 'Give to someone else', callback_data: 'redo:b1' }]] });
      assert.deepEqual(Object.keys(pendingConfirms()), ['b1']);
    });

    test('a driver the office assigned itself is not asked about: confirmed by the office', () => {
      booking('b2', { status: 'assigned', assignedDriver: RAJU, updatedBy: 'admin1', updatedAt: new Date() });
      env.ctx.watchChanges_();
      assert.equal(asked().length, 0);
      const c = get('bookings/b2').driverConfirmed;
      assert.deepEqual([c.by, c.driverId], ['office', 'd1']);
      assert.ok(c.at);
      assert.equal(get('bookings/b2').updatedBy, 'admin1', 'updatedAt / updatedBy untouched');
    });

    test('an office edit of a job a driver took (a quote, a bill) is not an office assignment', () => {
      took();
      env.ctx.watchChanges_();
      env.store.docs.get('bookings/b1').updatedBy = { stringValue: 'admin1' };
      env.store.docs.get('bookings/b1').updatedAt = { timestampValue: new Date(Date.now() + 1000).toISOString() };
      env.ctx.watchChanges_();
      assert.equal(get('bookings/b1').driverConfirmed, undefined);
      assert.equal(asked().length, 1, 'and he is not asked about twice');
    });

    test('already confirmed for him (e.g. in /admin): nothing to do', () => {
      took('b1', { driverConfirmed: { at: new Date(), by: 'admin', driverId: 'd1' } });
      env.ctx.watchChanges_();
      assert.equal(asked().length, 0);
      assert.equal(get('bookings/b1').driverConfirmed.by, 'admin');
    });

    test('another driver’s old confirmation does not count for the new one', () => {
      took('b1', { driverConfirmed: { at: new Date(), by: 'telegram', driverId: 'd2' } });
      env.ctx.watchChanges_();
      assert.equal(asked().length, 1);
    });

    test('CONFIRM_BY_CALL = off: nothing is sent', () => {
      env.props.set('CONFIRM_BY_CALL', 'Off');
      took();
      env.ctx.watchChanges_();
      assert.equal(asked().length, 0);
      assert.deepEqual(pendingConfirms(), {});
      const c = get('bookings/b1').driverConfirmed;
      assert.deepEqual([c.by, c.driverId], ['auto', 'd1'], 'confirmed at once, so he sees the job');
      env.ctx.telegramCallbacks_();
      assert.equal(env.tg.calls.length, 0, 'nothing waits: Telegram is not polled');
    });

    test('Confirmed ✓: the booking records it, the message says so; then nothing waits', () => {
      took();
      env.ctx.watchChanges_();
      press(20, 'conf:b1');
      const c = get('bookings/b1').driverConfirmed;
      assert.deepEqual([c.by, c.driverId], ['telegram', 'd1']);
      assert.ok(c.at);
      assert.deepEqual(answers(), ['Confirmed ✓']);
      assert.match(env.tg.calls.find((x) => x.method === 'editMessageText').body.text, /\n\nConfirmed ✓ /);
      assert.deepEqual(pendingConfirms(), {});
      const n = env.tg.calls.length;
      env.ctx.telegramCallbacks_();
      assert.equal(env.tg.calls.length, n, 'no more polling');
    });

    test('Confirmed ✓ when /admin confirmed him meanwhile: counts as done, the message says so', () => {
      took();
      env.ctx.watchChanges_();
      const at = ago(MIN);
      env.store.docs.get('bookings/b1').driverConfirmed = env.ctx.toValue({ at, by: 'admin', driverId: 'd1' });
      press(28, 'conf:b1');
      const c = get('bookings/b1').driverConfirmed;
      assert.deepEqual([c.by, c.at.getTime()], ['admin', at.getTime()], 'the office’s confirmation stands');
      assert.deepEqual(answers(), ['Confirmed ✓ (already, in /admin)']);
      assert.match(env.tg.calls.find((x) => x.method === 'editMessageText').body.text, /\n\nConfirmed ✓ \(already, in \/admin\) /);
      assert.deepEqual(pendingConfirms(), {});
    });

    test('confirmed in /admin before the 15 minutes: no reminder', () => {
      took();
      env.ctx.watchChanges_();
      env.store.docs.get('bookings/b1').driverConfirmed = env.ctx.toValue({ at: new Date(), by: 'admin', driverId: 'd1' });
      const p = pendingConfirms();
      p.b1.at = Date.now() - 16 * MIN;
      env.props.set('confirmsPending', JSON.stringify(p));
      env.ctx.telegramCallbacks_();
      assert.equal(env.telegram.filter((m) => /not confirmed by call yet/.test(m.text)).length, 0);
      assert.deepEqual(pendingConfirms(), {});
    });

    test('backfill, once: office-assigned jobs get office, jobs taken in the app are asked about (unless asked already)', () => {
      const SONU = { id: 'd2', name: 'Sonu Verma', phone: '9425212345' };
      booking('o1', { status: 'assigned', assignedDriver: SONU, updatedBy: 'admin1', updatedAt: ago(3 * 86_400_000) });
      booking('t1', { status: 'assigned', assignedDriver: RAJU, updatedBy: 'admin1', updatedAt: ago(2 * 86_400_000) }); // taken, then edited
      takenOffer('t1');
      booking('t2', { status: 'assigned', assignedDriver: RAJU, updatedBy: `driver-${RAJU.phone}`, updatedAt: ago(86_400_000) });
      takenOffer('t2');
      put('reminders/t2', { confirmAskedFor: `d1@${ago(86_400_000).getTime()}` }); // asked before this version
      booking('ok', { status: 'assigned', assignedDriver: RAJU, updatedBy: 'admin1', updatedAt: ago(86_400_000), driverConfirmed: { at: ago(MIN), by: 'telegram', driverId: 'd1' } });
      booking('done', { status: 'completed', assignedDriver: SONU, updatedBy: 'admin1', updatedAt: ago(86_400_000) });
      env.ctx.tick();
      assert.equal(get('bookings/o1').driverConfirmed.by, 'office');
      assert.equal(get('bookings/t1').driverConfirmed, undefined);
      assert.equal(get('bookings/t2').driverConfirmed, undefined);
      assert.equal(get('bookings/ok').driverConfirmed.by, 'telegram');
      assert.equal(get('bookings/done').driverConfirmed, undefined);
      assert.deepEqual(asked().map((m) => m.reply_markup.inline_keyboard[0][0].callback_data), ['conf:t1']);
      assert.equal(env.props.get('driverConfirmBackfill'), 'v1');
      booking('o2', { status: 'assigned', assignedDriver: SONU, updatedBy: 'admin1', updatedAt: ago(3 * 86_400_000) });
      env.ctx.tick();
      assert.equal(get('bookings/o2').driverConfirmed, undefined, 'once: older bookings are not looked at again');
      assert.equal(asked().length, 1);
    });

    test('a driver who gives the job back loses his confirmation', () => {
      booking('b1', { status: 'confirmed', assignedDriver: null, updatedAt: ago(MIN), driverConfirmed: { at: ago(10 * MIN), by: 'telegram', driverId: 'd1' } });
      takenOffer('b1', { status: 'released' });
      env.ctx.watchChanges_();
      assert.equal(get('offers/b1').status, 'open');
      assert.equal(get('bookings/b1').driverConfirmed ?? null, null);
    });

    test('a press from any other chat is ignored', () => {
      took();
      env.ctx.watchChanges_();
      press(21, 'conf:b1', 999);
      press(22, 'redo:b1', 999);
      assert.equal(get('bookings/b1').driverConfirmed, undefined);
      assert.equal(get('bookings/b1').status, 'assigned');
      assert.deepEqual(answers(), []);
      assert.deepEqual(Object.keys(pendingConfirms()), ['b1'], 'still waiting');
    });

    test('Give to someone else: back to confirmed, offered again from the start never to him, no strike, his phone hears', () => {
      put('availability/d1', { online: true, city: 'Raipur', name: 'Raju Sahu', phone: RAJU.phone, lat: 21.252, lng: 81.63, pushToken: 'ExponentPushToken[raju]', at: ago(MIN) });
      put('availability/d2', { online: true, city: 'Raipur', name: 'Sonu', phone: '9425212345', lat: 21.26, lng: 81.63, pushToken: 'ExponentPushToken[d2]', at: ago(MIN) });
      took();
      env.ctx.watchChanges_();
      press(23, 'redo:b1');
      const b = get('bookings/b1');
      assert.deepEqual([b.status, b.assignedDriver, b.updatedBy], ['confirmed', null, 'robot']);
      assert.ok(events('b1').some((e) => e.from === 'assigned' && e.to === 'confirmed' && e.note === 'Office gave it to another driver' && e.by === 'robot'));
      const o = get('offers/b1');
      assert.deepEqual([o.status, o.takenBy, o.by, o.cutPercent, o.done], ['open', null, 'robot', 30, false]);
      assert.deepEqual([...get('offerAlerts/b1').skipIds], ['d1']);
      assert.equal(get('drivers/d1').strikes, 1, 'no strike: it was the office’s call');
      const gone = env.pushes.filter((p) => p.to === 'ExponentPushToken[raju]');
      assert.equal(gone.length, 1);
      assert.equal(gone[0].body, 'DriveBuddy gave this job to another driver · यह काम किसी दूसरे ड्राइवर को दिया गया');
      assert.deepEqual(answers(), ['Offered again ✓']);
      assert.match(env.tg.calls.find((x) => x.method === 'editMessageText').body.text, /\n\nOffered again ✓ /);
      // The next minute's dispatch: the others hear, he does not.
      env.ctx.dispatchOffers_();
      assert.deepEqual(env.pushes.filter((p) => p.data.offerId === 'b1').map((p) => p.to), ['ExponentPushToken[d2]']);
      // A second press does nothing: once something else waits (a payout), it is read and answered.
      env.props.set('payoutsPending', JSON.stringify({ 'd9:2026-11-23': { ids: [], amount: 0, at: Date.now() } }));
      press(24, 'redo:b1');
      assert.equal(answers().at(-1), 'Already handled.');
      assert.equal(get('bookings/b1').status, 'confirmed');
    });

    test('Give to someone else after he tapped Start: refused with the reason; Confirmed ✓ still works', () => {
      took();
      env.ctx.watchChanges_();
      put('tripTaps/b1', { driverPhone: RAJU.phone, leftAt: ago(MIN) });
      press(25, 'redo:b1');
      assert.equal(get('bookings/b1').status, 'assigned');
      assert.equal(get('offers/b1').status, 'taken');
      assert.match(answers()[0], /already tapped Start/);
      assert.equal(env.tg.calls.filter((x) => x.method === 'editMessageText').length, 0);
      press(26, 'conf:b1');
      assert.equal(get('bookings/b1').driverConfirmed.driverId, 'd1');
    });

    test('the job changed meanwhile (assigned to someone else in /admin): nothing is done', () => {
      took();
      env.ctx.watchChanges_();
      env.store.docs.get('bookings/b1').assignedDriver = env.ctx.toValue({ id: 'd2', name: 'Sonu Verma', phone: '9425212345' });
      press(27, 'redo:b1');
      assert.equal(get('bookings/b1').assignedDriver.id, 'd2');
      assert.equal(get('offers/b1').status, 'taken');
      assert.match(answers()[0], /The job has changed/);
    });

    test('not confirmed 15 minutes after the take: one reminder', () => {
      took();
      env.ctx.watchChanges_();
      env.ctx.telegramCallbacks_();
      const reminders = () => env.telegram.filter((m) => /not confirmed by call yet/.test(m.text));
      assert.equal(reminders().length, 0, 'not yet');
      const p = pendingConfirms();
      p.b1.at = Date.now() - 15 * MIN - 1000;
      env.props.set('confirmsPending', JSON.stringify(p));
      env.ctx.telegramCallbacks_();
      env.ctx.telegramCallbacks_();
      assert.equal(reminders().length, 1);
      assert.equal(reminders()[0].text, '⏰ <b>DB-1042</b>: Raju Sahu is not confirmed by call yet (15 minutes since he took it) · +91 98933 02783');
      assert.equal(reminders()[0].reply_markup.inline_keyboard[0][0].callback_data, 'conf:b1');
    });
  });

  describe('9 pm report (11) and the triggers', () => {
    test('the day in numbers', () => {
      booking('n1', { createdAt: ago(1000) });
      booking('c1', { createdAt: ago(1000), status: 'completed', updatedAt: ago(1000), localBill: { amount: 750 } });
      booking('x1', { createdAt: ago(1000), status: 'cancelled', updatedAt: ago(1000) });
      takenOffer('c1', { price: 750, driverPay: 520, done: true, updatedAt: ago(1000) });
      put('offers/o9', { status: 'open', ref: 'DB-1050', city: 'Raipur', paid: false, done: false, updatedAt: ago(1000) });
      put('availability/d1', { online: true, city: 'Raipur', at: ago(MIN) });
      put('availability/d2', { online: true, city: 'Raipur', at: ago(30 * MIN) }); // stale
      env.ctx.dailyReport();
      const t = env.telegram.at(-1).text;
      assert.match(t, /<b>Bookings:<\/b> 3 \(new 1 · confirmed 0 · with driver 0 · completed 1 · cancelled 1\)/);
      assert.match(t, /<b>Revenue:<\/b> ₹750 from 1 completed job\n/);
      assert.match(t, /<b>DriveBuddy's cut:<\/b> ₹230/);
      assert.match(t, /<b>Jobs nobody took:<\/b> 1 still open — DB-1050/);
      assert.match(t, /<b>Drivers online now:<\/b> 1/);
      assert.match(t, /<b>Payouts due:<\/b> ₹520 to 1 driver$/);
    });

    test('tick sets up Monday 9:30 and daily 21:00 once', () => {
      env.ctx.tick();
      env.ctx.tick();
      const made = env.ctx.ScriptApp.made.filter((t) => t.fn === 'weeklyPayouts' || t.fn === 'dailyReport').map((t) => plain(t));
      assert.deepEqual(made, [
        { fn: 'weeklyPayouts', every: 'week', day: 'MONDAY', hour: 9, minute: 30 },
        { fn: 'dailyReport', every: 'day', hour: 21, minute: 0 },
      ]);
    });

    test('every new query is on one field only (no composite index)', () => {
      env.props.set('RAZORPAY_KEY_ID', 'k');
      env.props.set('RAZORPAY_KEY_SECRET', 's');
      env.ctx.watchChanges_();
      env.ctx.tripReminders_();
      env.ctx.pollPayments_();
      env.ctx.processRatingsStep_();
      env.ctx.dailyReport();
      env.ctx.weeklyPayouts();
      env.ctx.dispatchOffers_();
      env.props.set('driverQuality', JSON.stringify({ d1: { owed: 2500, overLimit: true } }));
      env.ctx.cashLimits_();
      const fieldsOf = (w) => (!w ? [] : w.compositeFilter ? w.compositeFilter.filters.flatMap(fieldsOf) : [w.fieldFilter.field.fieldPath]);
      assert.ok(env.store.queries.length >= 14);
      for (const q of env.store.queries) assert.equal(new Set([...fieldsOf(q.where), q.orderBy[0].field.fieldPath]).size, 1, JSON.stringify(q));
    });
  });
});

describe('web calls: within Google’s daily UrlFetch quota', () => {
  let env;
  const put = (path, obj) => env.store.docs.set(path, env.ctx.toFields(obj));
  const ago = (ms) => new Date(Date.now() - ms);
  const RAJU = { id: 'd1', name: 'Raju Sahu', phone: '9893302783' };
  /** Web calls of one tick at minute `m`. */
  const tickAt = (m) => {
    env.clock.minute = m;
    const n0 = env.http.n;
    env.ctx.tick();
    return env.http.n - n0;
  };
  const tenMinutes = () => Array.from({ length: 10 }, (_, m) => tickAt(m));
  const busyDay = () => {
    for (const [id, lat] of [['d1', 21.252], ['d2', 21.26], ['d3', 21.28], ['d4', 21.35]]) {
      put(`availability/${id}`, { online: true, city: 'Raipur', name: id, phone: '9000000000', lat, lng: 81.63, pushToken: `ExponentPushToken[${id}]`, at: ago(60_000) });
    }
    put('bookings/o1', { name: 'A', phone: '9111473929', city: 'Raipur', package: '3-hours-600', pickup: '12, Shankar Nagar', preferredTime: '', notes: '', status: 'confirmed', source: 'app', createdAt: ago(600_000), ref: 'DB-1050' });
    put('offers/o1', {
      bookingId: 'o1', ref: 'DB-1050', city: 'Raipur', package: '3-hours-600', when: '', area: 'Shankar Nagar', to: '', price: 600, cutPercent: 30, driverPay: 420,
      status: 'open', takenBy: null, takenAt: null, done: false, paid: false, paidAt: null, createdAt: ago(60_000), updatedAt: ago(60_000), by: 'robot', cities: ['Raipur', 'Bhilai', 'Durg'], payBy: 'cut',
    });
    put('bookings/c1', { name: 'B', phone: '9111473928', city: 'Raipur', package: '3-hours-600', pickup: '12, Shankar Nagar', preferredTime: '', notes: '', status: 'assigned', assignedDriver: RAJU, source: 'app', createdAt: ago(600_000), ref: 'DB-1040', updatedBy: `driver-${RAJU.phone}`, updatedAt: ago(5 * 3600_000) });
    put('tripTaps/c1', { driverPhone: RAJU.phone, leftAt: ago(10 * 60_000), arrivedAt: ago(2 * 60_000) });
    env.props.set('activeJobs', JSON.stringify({ c1: { p: RAJU.phone, f: '' } }));
    env.props.set('dispatchOn', '1');
    env.props.set('confirmsPending', JSON.stringify({ c1: { key: 'd1@1', driverId: 'd1', name: 'Raju Sahu', phone: RAJU.phone, ref: 'DB-1040', at: Date.now() - 5 * 3600_000, reminded: true } }));
    env.props.set('payoutsPending', JSON.stringify({ [`d1:${env.ctx.istDay(Date.now())}`]: { ids: ['x'], amount: 100, at: Date.now() - 86_400_000 } }));
  };

  beforeEach(() => {
    env = load();
    tenMinutes(); // the first runs: the one-time backfill and the list of current jobs
  });

  test('an idle robot: at most 4 calls a minute, about 4,300 a day (it was 16 a minute, about 24,000 a day)', () => {
    const calls = tenMinutes();
    assert.ok(calls.every((n) => n <= 4), JSON.stringify(calls));
    const day = (calls.reduce((a, b) => a + b, 0) / 10) * 1440;
    assert.ok(day <= 4500, `${day} a day`);
  });

  test('a busy stretch (an offer being dispatched, a take waiting for the call, a payout waiting, a driver on a job): about 8 a minute', () => {
    busyDay();
    const calls = tenMinutes();
    assert.ok(calls.every((n) => n <= 14), JSON.stringify(calls)); // the first minute does the tap's and the offer's work
    assert.ok(calls.reduce((a, b) => a + b, 0) <= 90, JSON.stringify(calls));
    assert.ok(env.pushes.some((p) => p.data && p.data.offerId === 'o1'), 'the offer still reaches the drivers');
    assert.ok(get(env, 'bookings/c1').clock.startAt, 'the driver’s Arrived tap still reaches the booking (the meter)');
  });

  test('a doorbell: one run for a burst (20 seconds), at most 6 calls', () => {
    let n0 = env.http.n;
    env.ctx.doPost({});
    const first = env.http.n - n0;
    assert.ok(first <= 6, String(first));
    n0 = env.http.n;
    env.ctx.doPost({});
    env.ctx.doGet({ parameter: {} });
    assert.equal(env.http.n - n0, 0, 'merged into the first');
  });

  test('odd minutes leave the app steps alone — unless the minute numbered a new booking (then all in the same minute)', () => {
    const n0 = env.http.urls.length;
    tickAt(7);
    assert.deepEqual(env.http.urls.slice(n0), ['fs:runQuery bookings'], 'only the new-bookings look');
    seedBooking(env.store, 'b1', { msAgo: 5000, extra: { customerUid: s('u1'), source: s('app') } });
    tickAt(7);
    assert.equal(get(env, 'bookings/b1').status, 'confirmed', 'instant confirmation in the same minute');
    assert.equal(get(env, 'offers/b1').status, 'open', 'and offered in it');
  });

  test('dispatch every minute only while offers are open (a look every 10 minutes otherwise)', () => {
    const offerLooks = () => env.http.urls.filter((u) => u === 'fs:runQuery offers').length;
    let n = offerLooks();
    tickAt(1);
    tickAt(3);
    assert.equal(offerLooks(), n, 'no open offer: not looked for');
    tickAt(5);
    assert.equal(offerLooks(), n + 1, 'the 10-minute look');
    seedBooking(env.store, 'b1', { msAgo: 5000, extra: { customerUid: s('u1'), source: s('app') } });
    tickAt(7); // numbered, confirmed, offered → dispatching
    assert.equal(env.props.get('dispatchOn'), '1');
    env.store.docs.get('offers/b1').status = s('taken');
    n = offerLooks();
    tickAt(9);
    tickAt(11);
    assert.equal(env.props.get('dispatchOn'), '0', 'none open: stops');
    assert.equal(offerLooks(), n + 1);
  });

  test('a waiting confirmation polls Telegram every 2 minutes, and stops after 24 hours (an old take is dropped)', () => {
    env.props.set('confirmsPending', JSON.stringify({ c1: { key: 'd1@1', driverId: 'd1', name: 'Raju Sahu', phone: RAJU.phone, ref: 'DB-1040', at: Date.now() - 60_000, reminded: false } }));
    const polls = () => env.tg.calls.filter((c) => c.method === 'getUpdates').length;
    tickAt(1);
    assert.equal(polls(), 0, 'odd minute: no poll');
    tickAt(2);
    assert.equal(polls(), 1);
    env.props.set('confirmsPending', JSON.stringify({ c1: { key: 'd1@1', driverId: 'd1', name: 'Raju Sahu', phone: RAJU.phone, ref: 'DB-1040', at: Date.now() - 25 * 3600_000, reminded: true } }));
    tickAt(4);
    tickAt(6);
    assert.equal(polls(), 1, 'expired: no more polling');
    assert.deepEqual(JSON.parse(env.props.get('confirmsPending')), {});
  });

  test('payouts waiting more than 2 days: Telegram is asked every 30 minutes, not every 2', () => {
    env.props.set('payoutsPending', JSON.stringify({ 'd1:2026-11-02': { ids: ['x'], amount: 100, at: Date.now() - 5 * 86_400_000 } }));
    const polls = () => env.tg.calls.filter((c) => c.method === 'getUpdates').length;
    for (let m = 1; m <= 29; m++) tickAt(m);
    assert.equal(polls(), 0);
    tickAt(30);
    assert.equal(polls(), 1);
  });

  test('today’s count; past 14,000 slow mode (Telegram once), the heavy steps every 10 minutes; a fresh count the next day', () => {
    const today = JSON.parse(env.props.get('fetchBudget'));
    assert.equal(today.day, env.ctx.istDay(Date.now()));
    assert.ok(today.n > 0);
    env.props.set('fetchBudget', JSON.stringify({ day: today.day, n: 14_001, slowSent: false }));
    assert.equal(tickAt(3), 2, 'the Telegram and the new-bookings look');
    assert.equal(env.telegram.filter((m) => /Slow mode until midnight/.test(m.text)).length, 1);
    assert.equal(tickAt(4), 1, 'even minutes too: new bookings only');
    assert.ok(tickAt(10) > 1, 'every 10 minutes the rest');
    assert.equal(env.telegram.filter((m) => /Slow mode/.test(m.text)).length, 1, 'once');
    env.props.set('fetchBudget', JSON.stringify({ day: '2026-01-01', n: 19_000, slowSent: true }));
    tickAt(2);
    const fresh = JSON.parse(env.props.get('fetchBudget'));
    assert.equal(fresh.day, env.ctx.istDay(Date.now()));
    assert.ok(fresh.n > 0 && fresh.n < 10, String(fresh.n));
  });

  test('the list of current jobs stays small (a script property holds 9 KB)', () => {
    const jobs = {};
    for (let i = 0; i < 150; i++) jobs[`job${String(i).padStart(17, '0')}`] = { p: '2783', f: 'a1b2c3d4', q: 0, u: Math.floor(Date.now() / 60_000) + 1000 + i };
    jobs.assigned00000000000001 = { p: '2783', f: '', q: 0 };
    env.ctx.saveActiveJobs_(jobs);
    const saved = env.props.get('activeJobs');
    const kept = JSON.parse(saved);
    assert.equal(Object.keys(kept).length, 90);
    assert.ok(kept.assigned00000000000001, 'an assigned job always stays');
    assert.ok(kept.job00000000000000149 && !kept.job00000000000000000, 'the completed jobs nearest the end of their watch go first');
    assert.ok(saved.length < 9000, String(saved.length));
    assert.equal(env.ctx.tapsPrint(null), '');
    assert.match(env.ctx.tapsPrint({ driverPhone: '9893302783', leftAt: new Date(0) }), /^[0-9a-f]{8}$/);
    assert.notEqual(env.ctx.tapsPrint({ driverPhone: '9893302783', leftAt: new Date(0) }), env.ctx.tapsPrint({ driverPhone: '9893302783', leftAt: new Date(1000) }));
  });

  test('the quota answers "too many times": the run stops at once, logged once, then a pause of half an hour', () => {
    const real = env.ctx.UrlFetchApp.fetch;
    env.ctx.UrlFetchApp.fetch = () => { throw new Error('Exception: Service invoked too many times for one day: urlfetch.'); };
    tickAt(2); // would throw in every step; the harness fails on any console.error
    assert.equal(env.warnings.filter((w) => /quota reached/.test(w)).length, 1);
    assert.ok(Number(env.props.get('quotaHitAt')) > 0);
    env.ctx.UrlFetchApp.fetch = real;
    assert.equal(tickAt(4), 0, 'paused');
    env.props.set('quotaHitAt', String(Date.now() - 31 * 60_000));
    assert.ok(tickAt(6) > 0, 'tries again after half an hour');
  });
});

function get(env, path) {
  return env.store.docs.has(path) ? env.ctx.fromFields(env.store.docs.get(path)) : null;
}

test('ticks share 3 s a minute of each hour (Google: 90 min a day of trigger time)', () => {
  const env = load();
  // 2 s a minute in hand at minute 0 (3 s + 15 s burst = 18 s); at minute 30, 93 s + 15 s.
  assert.equal(env.ctx.tickAllowed_(0, 0), true);
  assert.equal(env.ctx.tickAllowed_(17_999, 0), true);
  assert.equal(env.ctx.tickAllowed_(18_000, 0), false);
  assert.equal(env.ctx.tickAllowed_(100_000, 30), true);
  assert.equal(env.ctx.tickAllowed_(108_000, 30), false);
  assert.equal(env.ctx.tickAllowed_(194_999, 59), true);
  assert.equal(env.ctx.tickAllowed_(195_000, 59), false);
  // A tick records its time for the hour.
  env.ctx.tick();
  const used = JSON.parse(env.props.get('tickTime') || 'null');
  assert.ok(used && typeof used.ms === 'number' && used.ms >= 0);
});
