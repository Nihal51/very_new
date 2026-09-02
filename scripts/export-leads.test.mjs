/**
 * Tests for scripts/export-leads.mjs — run with `npm test`.
 *
 * Two things matter here and neither can be checked by eye: that a Firestore
 * timestamp lands in the sheet as a readable IST date *and* time, and that the
 * service-account JWT is signed the way Google will expect. Both are covered.
 */

import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import ExcelJS from 'exceljs';

import { buildWorkbook, getAccessToken, normaliseBooking, normaliseDriver } from './export-leads.mjs';

/* 2026-08-28T13:53:11Z is 28 Aug 2026, 7:23 pm IST — a Friday. */
const BOOKINGS = [
  {
    id: 'abc123',
    name: 'Ramesh Sahu',
    phone: '9876543210',
    city: 'Raipur',
    package: '3-hours-600',
    pickup: 'Shankar Nagar, near Ambuja Mall',
    preferredTime: '2026-08-30T14:30',
    notes: 'Automatic car',
    status: 'new',
    _created: new Date('2026-08-28T13:53:11Z'),
  },
  {
    id: 'def456',
    name: 'Anjali Mishra',
    phone: '9123456780',
    city: 'Bhilai',
    package: 'medical-emergency',
    pickup: 'Sector 9, Bhilai',
    preferredTime: '',
    notes: '',
    status: 'new',
    _created: new Date('2026-08-27T02:10:00Z'),
  },
];

const DRIVERS = [
  {
    id: 'drv1',
    name: 'Suresh Verma',
    phone: '9998887770',
    city: 'Durg',
    experienceYears: 9,
    licence: 'both',
    about: 'Highway experience',
    status: 'new',
    _created: new Date('2026-08-26T05:00:00Z'),
  },
];

describe('workbook', () => {
  let dir;
  let wb;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'db-leads-'));
    const file = path.join(dir, 'out.xlsx');
    await buildWorkbook(BOOKINGS, DRIVERS).xlsx.writeFile(file);
    wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
  });

  after(() => rm(dir, { recursive: true, force: true }));

  it('has a Summary, Bookings and Driver applications sheet', () => {
    assert.deepEqual(
      wb.worksheets.map((s) => s.name),
      ['Summary', 'Bookings', 'Driver applications'],
    );
  });

  it('writes one row per booking under a frozen, filterable header', () => {
    const sheet = wb.getWorksheet('Bookings');
    assert.equal(sheet.rowCount, BOOKINGS.length + 1);
    assert.equal(sheet.getRow(1).getCell(2).value, 'Received (IST)');
    assert.equal(sheet.views[0].state, 'frozen');
    assert.ok(sheet.autoFilter);
  });

  it('shows the received date and time in IST, as a real date cell', () => {
    const cell = wb.getWorksheet('Bookings').getRow(2).getCell(2);
    assert.ok(cell.value instanceof Date);
    // Shifted +5:30 so Excel's timezone-less serial reads as IST wall-clock.
    assert.equal(cell.value.toISOString(), '2026-08-28T19:23:11.000Z');
    assert.equal(cell.numFmt, 'dd mmm yyyy  h:mm AM/PM');
    assert.equal(wb.getWorksheet('Bookings').getRow(2).getCell(3).value, 'Fri');
  });

  it('keeps mobile numbers as text and expands package codes', () => {
    const row = wb.getWorksheet('Bookings').getRow(2);
    assert.equal(row.getCell(4).value, 'Ramesh Sahu');
    assert.equal(row.getCell(5).value, '9876543210');
    assert.equal(row.getCell(7).value, '3 Hours — ₹600');
  });

  it('renders the customer-requested time, and says so when there is none', () => {
    const sheet = wb.getWorksheet('Bookings');
    assert.equal(sheet.getRow(2).getCell(9).value, '30 Aug 2026, 2:30 pm');
    assert.equal(sheet.getRow(3).getCell(9).value, 'As soon as possible');
    assert.equal(sheet.getRow(3).getCell(10).value, '—', 'empty notes read as a dash');
  });

  it('expands driver licence codes and keeps experience numeric', () => {
    const row = wb.getWorksheet('Driver applications').getRow(2);
    assert.equal(row.getCell(8).value, 'Commercial + LMV');
    assert.equal(row.getCell(7).value, 9);
  });

  it('tallies totals, cities and days on the Summary sheet', () => {
    const rows = [];
    wb.getWorksheet('Summary').eachRow((r) => rows.push(r.values.slice(1)));
    const text = JSON.stringify(rows);
    assert.ok(text.includes('Booking requests'));
    assert.ok(text.includes('Raipur'));
    assert.ok(text.includes('28 Aug 2026'));
  });
});

describe('normalising two generations of form data', () => {
  /**
   * The live `bookings` collection holds rows from an older version of the form.
   * Those rows store the *finished* package label instead of a key, call the
   * wall-clock field `datetime` instead of `preferredTime`, and carry a
   * `destination` where the current form has a `city`. Real examples from the
   * project's own Firestore, so a lead from May cannot render as a row of blanks.
   */
  const LEGACY = {
    id: 'Xdv9j0gXKh10Hk0iGDC0',
    name: 'ninu',
    phone: '9893302783',
    datetime: '2026-04-29T13:16',
    destination: 'Bhilai',
    notes: '',
    package: '1 Hour — ₹300',
    pickup: 'raipur',
    status: 'new',
    _created: new Date('2026-04-29T02:43:05Z'),
  };

  it('keeps a legacy package label that is already human-readable', () => {
    const row = normaliseBooking(LEGACY);
    assert.equal(row.service, '1 Hour — ₹300');
    assert.equal(row.name, 'ninu');
    assert.equal(row.pickup, 'raipur');
  });

  it('reads the old `datetime` field when `preferredTime` is absent', () => {
    assert.equal(normaliseBooking(LEGACY).preferred, '29 Apr 2026, 1:16 pm');
  });

  it('carries a legacy destination into the notes rather than dropping it', () => {
    assert.equal(normaliseBooking({ ...LEGACY, notes: 'call first' }).notes,
      'call first · Drop: Bhilai');
    assert.equal(normaliseBooking(LEGACY).notes, 'Drop: Bhilai');
  });

  it('never yields undefined for a field the sheet has a column for', () => {
    const row = normaliseBooking({ id: 'bare', _created: new Date('2026-01-01T00:00:00Z') });
    for (const [key, value] of Object.entries(row)) {
      assert.notEqual(value, undefined, `${key} is undefined`);
    }
    assert.equal(row.preferred, 'As soon as possible');
    assert.equal(row.city, '');
  });

  it('expands the current form codes and leaves a numeric year numeric', () => {
    const row = normaliseDriver(DRIVERS[0]);
    assert.equal(row.licence, 'Commercial + LMV');
    assert.equal(row.years, 9);
    assert.equal(row.phone, '9998887770');
  });

  it('keeps a mobile number stored as a number as a string', () => {
    assert.equal(normaliseBooking({ ...LEGACY, phone: 9893302783 }).phone, '9893302783');
  });
});

describe('service-account auth', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const sa = {
    client_email: 'exporter@drive-buddy-acc4c.iam.gserviceaccount.com',
    private_key: privateKey,
    project_id: 'drive-buddy-acc4c',
    token_uri: 'https://oauth2.googleapis.com/token',
  };

  const withFetch = async (impl, run) => {
    const real = globalThis.fetch;
    globalThis.fetch = impl;
    try {
      return await run();
    } finally {
      globalThis.fetch = real;
    }
  };

  it('sends a correctly signed RS256 JWT bearer assertion', async () => {
    let seen;
    const token = await withFetch(
      async (url, init) => {
        seen = { url: String(url), body: init.body, headers: init.headers };
        return { ok: true, status: 200, json: async () => ({ access_token: 'test-token' }) };
      },
      () => getAccessToken(sa),
    );

    assert.equal(token, 'test-token');
    assert.equal(seen.url, sa.token_uri);
    assert.equal(seen.headers['content-type'], 'application/x-www-form-urlencoded');

    const params = new URLSearchParams(seen.body);
    assert.equal(params.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');

    const jwt = params.get('assertion');
    const [header, payload, signature] = jwt.split('.');
    assert.equal(jwt.split('.').length, 3);
    assert.ok(!/[+/=]/.test(jwt), 'base64url only, no padding');
    assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'RS256', typ: 'JWT' });

    const claims = JSON.parse(Buffer.from(payload, 'base64url'));
    assert.equal(claims.iss, sa.client_email);
    assert.equal(claims.aud, sa.token_uri);
    assert.equal(claims.scope, 'https://www.googleapis.com/auth/datastore');
    assert.equal(claims.exp - claims.iat, 3600);
    assert.ok(Math.abs(claims.iat - Date.now() / 1000) < 60);

    assert.ok(
      createVerify('RSA-SHA256')
        .update(`${header}.${payload}`)
        .verify(publicKey, Buffer.from(signature, 'base64url')),
      'signature verifies against the public key',
    );
  });

  it('reports a rejected key in plain language', async () => {
    await withFetch(
      async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }),
      }),
      () => assert.rejects(getAccessToken(sa), /Google rejected the key \(HTTP 400\)/),
    );
  });
});
