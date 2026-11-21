/**
 * The automation's shared pieces on the website side (lib/bookings.ts,
 * lib/offers.ts, site-settings.ts) agree with the alerts robot
 * (apps-script/Code.js) and the rules: which bookings confirm themselves,
 * the extra-hour price the robot bills with, and what the admin panel shows.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import { PACKAGE_NAMES, isInstantBooking, toLocalBill, toPayment, toAcceptedPrice } from '../lib/bookings.ts';
import { offerCitiesFor } from '../lib/offers.ts';
import { checkSettings } from '../lib/settings-schema.ts';
import { settings } from '../site-settings.ts';

const robot = createRequire(import.meta.url)('../apps-script/Code.js');
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the admin panel and the robot agree on which bookings confirm themselves', () => {
  for (const pkg of Object.keys(PACKAGE_NAMES)) {
    for (const customerUid of [undefined, 'u1']) {
      for (const acceptedPrice of [undefined, { amount: 1600 }]) {
        const b = { package: pkg, customerUid, acceptedPrice };
        assert.equal(isInstantBooking(b), robot.instantConfirmable({ ...b, status: 'new', ref: 'DB-1' }, ''), JSON.stringify(b));
      }
    }
  }
});

test('the extra-hour price is a setting, published to the robot through app-config.json', () => {
  assert.equal(typeof settings.prices.localExtraHour, 'number');
  assert.ok(read('app/app-config.json/route.ts').includes('localExtraHour: prices.localExtraHour'));
  assert.throws(() => checkSettings({ ...settings, prices: { ...settings.prices, localExtraHour: 0 } }), /prices\.localExtraHour/);
  assert.throws(() => checkSettings({ ...settings, prices: { ...settings.prices, localExtraHour: 1500 } }), /localExtraHour/);
  // The robot's bill with the site's own prices: a 3-hour job that ran 4 h 10 m (one extra hour).
  const t0 = new Date('2026-11-22T04:00:00Z');
  const bill = robot.localBillOf({ package: '3-hours-600' }, { arrivedAt: t0, doneAt: new Date(+t0 + 250 * 60_000) }, settings.prices, t0);
  assert.equal(bill.amount, settings.prices.threeHours + settings.prices.localExtraHour);
  // Every local package has its hours; trip packages are billed by the office.
  assert.deepEqual(Object.keys(robot.LOCAL_BASE_HOURS).sort(), ['1-hour-300', '3-hours-600', 'local-full-day', 'night-driver']);
});

test('stored bills, payments and accepted prices are read safely', () => {
  assert.deepEqual(toLocalBill({ amount: 750, baseHours: 3, usedHours: 4, extraHours: 1, extraHourRate: 150 }), {
    amount: 750, baseHours: 3, usedHours: 4, extraHours: 1, extraHourRate: 150, at: undefined,
  });
  assert.equal(toLocalBill({ amount: 750 }), null);
  assert.equal(toLocalBill(null), null);
  const p = toPayment({ status: 'pending', amount: 750, url: 'https://rzp.io/i/abc', linkId: 'plink_1' });
  assert.equal(p.url, 'https://rzp.io/i/abc');
  assert.equal(toPayment({ status: 'paid', amount: 750, url: 'https://evil.example/pay', linkId: 'x' }).url, '', 'only Razorpay links become links');
  assert.equal(toPayment({ status: 'refunded', amount: 750, url: '' }), null);
  assert.deepEqual(toAcceptedPrice({ amount: 1600 }), { amount: 1600, at: undefined });
  assert.equal(toAcceptedPrice({ amount: 0 }), null);
});

test('offers: an admin posts to its own city; the robot knows the same cities as the rules', () => {
  assert.deepEqual(offerCitiesFor('Raipur'), ['Raipur']);
  const rules = read('firestore.rules');
  const served = rules.match(/function isServedCity\(value\) \{\s*return value in \[([^\]]*)\]/)[1];
  const cities = [...served.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(Object.keys(robot.NEARBY_CITIES).sort(), cities);
  const listed = [...rules.match(/o\.cities\.hasOnly\(\[([^\]]*)\]\)/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(listed, cities, 'an offer may list only served cities');
  for (const [city, near] of Object.entries(robot.NEARBY_CITIES)) for (const n of near) assert.ok(cities.includes(n), `${city} → ${n}`);
  assert.ok(rules.includes("o.status in ['open', 'taken', 'withdrawn', 'released']"));
});
