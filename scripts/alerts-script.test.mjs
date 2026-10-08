/**
 * apps-script/Code.js runs on Google's servers, not here — so this test loads it
 * into a sandbox with stand-ins for the Apps Script services and a small
 * in-memory Firestore that speaks the same REST shapes (runQuery, get, commit).
 * It checks the whole robot: numbering, customer records, timeline, alerts,
 * sheet rows, reminders, driver alerts, and that nothing is alerted twice.
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
    get(path) {
      return docs.has(path) ? { name: PREFIX + path, fields: docs.get(path) } : null;
    },
    runQuery(q) {
      const col = q.from[0].collectionId;
      const dir = q.orderBy[0].direction === 'ASCENDING' ? 1 : -1;
      return [...docs.entries()]
        .filter(([p]) => p.startsWith(`${col}/`) && p.split('/').length === 2)
        .filter(([, f]) => matches(f, q.where))
        .sort(([, a], [, b]) => dir * (val(a.createdAt) - val(b.createdAt)))
        .slice(0, q.limit)
        .map(([p, f]) => ({ document: { name: PREFIX + p, fields: f } }));
    },
    commit(writes) {
      for (const w of writes) {
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
  const rows = { Bookings: [], Drivers: [] };

  const response = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
  const ctx = {
    console: { log() {}, error() {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => props.get(k) ?? null,
        setProperty: (k, v) => props.set(k, v),
      }),
    },
    ScriptApp: { getOAuthToken: () => 'token', getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create() {} }) }) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { getUuid: () => Math.random().toString(16).slice(2) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    MailApp: { sendEmail: (m) => mail.push(m) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => ({
          getLastRow: () => rows[n].length,
          appendRow: (r) => rows[n].push(r),
          getRange: () => ({ setFontWeight() {} }),
          setFrozenRows() {},
        }),
        insertSheet: () => null,
      }),
    },
    UrlFetchApp: {
      fetch(url, opts = {}) {
        const body = opts.payload ? JSON.parse(opts.payload) : null;
        if (url.startsWith('https://api.telegram.org/')) {
          if (url.endsWith('/sendMessage')) telegram.push(body);
          return response(200, { ok: true, result: [] });
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
  return { ctx, store, props, telegram, mail, rows };
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
    assert.equal(env.store.docs.get('meta/counters').bookings.integerValue, '1');
    assert.equal(env.store.docs.get('customers/9111473929').bookingsCount.integerValue, '1');
    assert.ok([...env.store.docs.keys()].some((p) => p.startsWith('bookings/b1/events/')));
    assert.equal(env.telegram.length, 1);
    assert.ok(env.telegram[0].text.includes('DB-1001'));
    assert.ok(env.telegram[0].text.includes('New customer'));
    assert.equal(env.mail.length, 1);
    assert.equal(env.rows.Bookings[0][0], 'Ref'); // header written on first use
    assert.equal(env.rows.Bookings[1][0], 'DB-1001');

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

  test('a booking still new after 10 minutes gets exactly one reminder', () => {
    seedBooking(env.store, 'late', { msAgo: 15 * 60_000, extra: { ref: s('DB-1009') } });
    seedBooking(env.store, 'fresh', { msAgo: 2 * 60_000, extra: { ref: s('DB-1010') } });
    env.ctx.remindUnhandled_();
    env.ctx.remindUnhandled_();
    assert.equal(env.telegram.length, 1);
    assert.ok(env.telegram[0].text.includes('Not handled yet: DB-1009'));
    assert.ok(env.store.docs.get('bookings/late').reminderSentAt);
  });

  test('a driver application is alerted once and logged', () => {
    env.store.docs.set('drivers/d1', {
      name: s('Suresh Verma'), phone: s('9893302783'), city: s('Bhilai'), experienceYears: { integerValue: '7' },
      licence: s('lmv'), about: s(''), status: s('new'), source: s('website'), createdAt: ts(30_000),
    });
    env.ctx.processDrivers_();
    env.ctx.processDrivers_();
    assert.equal(env.telegram.length, 1);
    assert.ok(env.telegram[0].text.includes('New driver application'));
    assert.equal(env.rows.Drivers[1][1], 'Suresh Verma');
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
