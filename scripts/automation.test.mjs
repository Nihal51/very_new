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

import { PACKAGE_NAMES, UPI_ID, isInstantBooking, isUpiPayUrl, toLocalBill, toPayment, toAcceptedPrice, toTripTaps } from '../lib/bookings.ts';
import { offerCitiesFor, offerSettlement } from '../lib/offers.ts';
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

test('the cash limit is one setting, published to the robot and the apps through app-config.json', () => {
  assert.equal(typeof settings.payments.cashLimit, 'number');
  assert.ok(read('app/app-config.json/route.ts').includes('payments: { cashLimit: payments.cashLimit }'));
  assert.throws(() => checkSettings({ ...settings, payments: { cashLimit: 0 } }), /payments\.cashLimit/);
  assert.throws(() => checkSettings({ ...settings, payments: { cashLimit: 200000 } }), /payments\.cashLimit/);
  assert.equal(robot.cashLimitOf(settings.payments), settings.payments.cashLimit);
  // No CASH_LIMIT script property: the robot reads the site's setting only.
  assert.ok(!read('apps-script/Code.js').includes("prop_('CASH_LIMIT')"));
});

test('UPI pay links: the robot makes what the admin panel and the apps accept; one UPI ID shape everywhere', () => {
  assert.equal(String(UPI_ID), String(robot.UPI_ID_RE));
  assert.ok(read('firestore.rules').includes("'^[a-zA-Z0-9.\\\\-_]{2,64}@[a-zA-Z]{2,32}$'"), 'the rules use the same pattern');
  const url = robot.upiPayUrl('drivebuddy@ybl', 'DriveBuddy', 750, 'DB-1042');
  assert.equal(isUpiPayUrl(url), true);
  assert.equal(isUpiPayUrl('upi://pay?pa=not-an-id&am=750.00'), false);
  assert.equal(isUpiPayUrl('upi://pay?pa=drivebuddy%40ybl&pn=Drive Buddy'), false, 'no spaces');
  assert.equal(isUpiPayUrl(`upi://pay?pa=drivebuddy%40ybl&tn=${'x'.repeat(500)}`), false, 'at most 500 characters');
  assert.equal(isUpiPayUrl('upi://pay?pa=%E0%A4'), false, 'a broken encoding is not a link');
  assert.equal(isUpiPayUrl('https://evil.example/?pa=drivebuddy%40ybl'), false);
  const pending = toPayment({ status: 'pending', method: 'upi', amount: 750, url, at: new Date() });
  assert.deepEqual([pending.url, pending.method], [url, 'upi']);
  const cash = toPayment({ status: 'paid', method: 'cash', amount: 750, by: 'driver', paidAt: new Date(), at: new Date() });
  assert.deepEqual([cash.status, cash.method, cash.by, cash.url], ['paid', 'cash', 'driver', ''], 'a payment the driver confirmed has no link');
  assert.equal(toPayment({ status: 'paid', method: 'bitcoin', amount: 750 }).method, undefined);
  const taps = toTripTaps({ driverPhone: '9893302783', doneAt: new Date(), amount: 750, paidBy: 'cash', paidAt: new Date() });
  assert.deepEqual([taps.amount, taps.paidBy], [750, 'cash']);
  assert.equal(toTripTaps({ driverPhone: '9893302783', paidBy: 'card' }).paidBy, undefined);
});

test('one job’s settlement in /admin adds up like the robot’s weekly payout', () => {
  const RAJU = { id: 'd1', name: 'Raju Sahu', phone: '9893302783' };
  for (const [driverPay, cashCollected] of [[450, 750], [450, 0], [450, undefined], [450, 450], [450, -3]]) {
    const s = offerSettlement({ driverPay, cashCollected });
    const [g] = robot.payoutGroups([{ id: 'a', data: { status: 'taken', done: true, paid: false, driverPay, cashCollected, takenBy: RAJU } }]);
    assert.deepEqual([s.earned, s.cash, s.net], [g.amount, g.cash, g.net], `${driverPay} / ${cashCollected}`);
  }
  assert.ok(read('firestore.rules').includes("'cashCollected'"), 'the rules allow cashCollected on an offer');
});
