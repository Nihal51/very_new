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

import { PACKAGE_NAMES, UPI_ID, isDriverConfirmed, isInstantBooking, isUpiPayUrl, toDriverConfirmed, toLocalBill, toPayment, toAcceptedPrice, toTripTaps } from '../lib/bookings.ts';
import { RATE_RAISE, ZONES, citiesText, offerCitiesFor, offerSettlement } from '../lib/offers.ts';
import { estimateBasisText, estimateOf } from '../lib/estimate.ts';
import { LOCAL_BASE_HOURS, LOCAL_GRACE_MINUTES, localHours, usedHours } from '../lib/local-bill.ts';
import { destinations, estimate, homeWay, pickupCities, planTrip, roadKm } from '../lib/outstation.ts';
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
  assert.deepEqual(Object.keys(robot.LOCAL_BASE_HOURS).sort(), ['1-hour-300', '3-hours-600', 'local-12-hours', 'local-full-day', 'night-driver']);
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

test('offers: one zone for Raipur, Bhilai and Durg — the admin panel, the robot and the rules agree', () => {
  assert.deepEqual(offerCitiesFor('Raipur'), ['Raipur', 'Bhilai', 'Durg']);
  assert.deepEqual(offerCitiesFor('Bhilai'), ['Bhilai', 'Raipur', 'Durg']);
  assert.deepEqual(offerCitiesFor('Bilaspur'), ['Bilaspur']);
  for (const city of ['Raipur', 'Bhilai', 'Durg', 'Bilaspur', 'Korba']) assert.deepEqual(offerCitiesFor(city), [...robot.zoneOf(city)], city);
  assert.deepEqual(ZONES.map((z) => [...z]), robot.ZONES.map((z) => [...z]));
  const zoneRule = read('firestore.rules').match(/function isZoneCities\(o\) \{[\s\S]*?\n    \}/)[0];
  for (const z of ZONES) assert.ok(zoneRule.includes(`o.cities.hasOnly([${z.map((c) => `'${c}'`).join(', ')}])`), z.join());
  assert.equal(citiesText(['Raipur', 'Bhilai', 'Durg']), 'Raipur, Bhilai and Durg');
  assert.equal(citiesText(['Bilaspur']), 'Bilaspur');
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
  const taps = toTripTaps({ driverPhone: '9893302783', doneAt: new Date(), paidBy: 'cash', paidAt: new Date() });
  assert.equal(taps.paidBy, 'cash');
  assert.ok(taps.paidAt);
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

test('call to confirm: the confirmation counts only for the driver it was about; the admin panel writes only its own kinds', () => {
  const RAJU = { id: 'd1', name: 'Raju Sahu', phone: '9893302783' };
  const c = toDriverConfirmed({ at: new Date(), by: 'telegram', driverId: 'd1' });
  assert.equal(isDriverConfirmed({ assignedDriver: RAJU, driverConfirmed: c }), true);
  assert.equal(isDriverConfirmed({ assignedDriver: { ...RAJU, id: 'd2' }, driverConfirmed: c }), false, 'another driver since');
  assert.equal(isDriverConfirmed({ assignedDriver: null, driverConfirmed: c }), false);
  assert.equal(toDriverConfirmed({ by: 'telegram' }), null);
  assert.equal(toDriverConfirmed(null), null);
  const rules = read('firestore.rules');
  assert.ok(rules.includes("c.by in ['admin', 'office']"), 'an admin confirms as admin or office only');
  const admin = read('lib/admin.ts');
  const kinds = [...admin.matchAll(/driverConfirmed: \{[^}]*by: '([a-z]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(kinds, ['admin'], 'Confirm driver ✓');
  assert.ok(admin.includes("by: 'office', driverId: driver.id"), 'assigning a driver confirms him as the office');
  for (const by of ['telegram', 'admin', 'office', 'auto']) assert.ok(read('lib/bookings.ts').includes(`'${by}'`), by);
  assert.ok(robot.confirmedFor({ driverConfirmed: { driverId: 'd1' } }, 'd1'));
  assert.equal(robot.confirmedFor({ driverConfirmed: { driverId: 'd2' } }, 'd1'), false);
});

test('price estimates: the robot and the admin panel give the same answer from the same booking and settings', () => {
  const trip = (estTo) => ({ to: 'Nagpur', kind: 'one-way', km: 284, days: 1, returnHours: 6, estFrom: 1440, estTo });
  const bookings = [
    ...Object.keys(PACKAGE_NAMES).map((pkg) => ({ package: pkg })),
    { package: 'outstation', trip: trip(3300) },
    { package: 'one-way-drop', trip: trip(1600) },
    { package: 'one-way-drop', trip: trip(50) },
    { package: 'one-way-drop', trip: trip(1600.5) },
    { package: 'outstation', acceptedPrice: { amount: 3400 }, trip: trip(3300) },
    { package: '3-hours-600', quote: { amount: 700 } },
    { package: 'local-full-day', quote: { amount: 1100.5 } },
    { package: 'medical-emergency', quote: { amount: 900 } },
    { package: 'night-driver', acceptedPrice: { amount: 99 } },
  ];
  for (const prices of [settings.prices, {}, { ...settings.prices, fullDay: { from: 1000, to: 600000 } }]) {
    for (const b of bookings) {
      const site = estimateOf(b, prices);
      const robo = robot.estimateOf(b, prices);
      assert.deepEqual({ ...site }, { ...robo }, JSON.stringify(b));
    }
  }
  // With the site's own settings: each basis from its setting.
  const p = settings.prices;
  assert.deepEqual(estimateOf({ package: '1-hour-300' }, p), { amount: p.oneHour, basis: 'fixed' });
  assert.deepEqual(estimateOf({ package: '3-hours-600' }, p), { amount: p.threeHours, basis: 'fixed' });
  assert.deepEqual(estimateOf({ package: 'local-full-day' }, p), { amount: p.fullDay.to, basis: 'fullDay' });
  assert.deepEqual(estimateOf({ package: 'night-driver' }, p), { amount: p.nightFrom, basis: 'night' });
  assert.deepEqual(estimateOf({ package: 'wedding-event' }, p), { amount: 0, basis: '' });
  // The words in /admin, with the range built from the settings (no typed figure).
  const range = (a, b) => `${a}-${b}`;
  assert.equal(estimateBasisText(estimateOf({ package: 'local-full-day' }, p), p, range), `full day (top of the ${p.fullDay.from}-${p.fullDay.to} range)`);
  assert.equal(estimateBasisText(estimateOf({ package: 'night-driver' }, p), p, range), 'night driver from-price');
  assert.equal(estimateBasisText(estimateOf({ package: 'one-way-drop', trip: trip(1600) }, p), p, range), 'the trip estimate the customer saw');
  assert.equal(estimateBasisText(estimateOf({ package: '1-hour-300' }, p), p, range), 'fixed package price');
  assert.equal(estimateBasisText({ amount: 0, basis: '' }, p, range), '');
  // Instant confirmation is not widened: a logged-in full-day booking still waits for the office.
  assert.equal(robot.instantConfirmable({ package: 'local-full-day', customerUid: 'u1', status: 'new', ref: 'DB-1' }, ''), false);
  assert.equal(isInstantBooking({ package: 'night-driver', customerUid: 'u1' }), false);
});

test('the rate card: the same raise steps in /admin and the robot; its values are never in the public repo', () => {
  assert.deepEqual({ ...RATE_RAISE }, { ...robot.RATE_RAISE });
  // DRIVER_RATES lives only in the Script Properties: no settings file, website code or rules carry its keys.
  for (const f of ['site-settings.ts', 'lib/settings-schema.ts', 'app/app-config.json/route.ts', 'firestore.rules']) {
    // (returnHour alone is also a customer price in site-settings.ts outstation, so only the card's own keys.)
    for (const key of ['DRIVER_RATES', 'local8h', 'local12h', 'tripDay']) assert.ok(!read(f).includes(key), `${key} in ${f}`);
  }
  assert.equal(robot.driverRatesOf(undefined), null, 'no property: the % cut');
});

test('12 hours in the city: one price setting, published to the apps; billed and estimated by the robot', () => {
  assert.equal(typeof settings.prices.twelveHours, 'number');
  assert.ok(read('app/app-config.json/route.ts').includes('twelveHours: prices.twelveHours'));
  assert.throws(() => checkSettings({ ...settings, prices: { ...settings.prices, twelveHours: 0 } }), /prices\.twelveHours/);
  assert.throws(() => checkSettings({ ...settings, prices: { ...settings.prices, twelveHours: settings.prices.threeHours } }), /twelveHours/);
  assert.deepEqual(estimateOf({ package: 'local-12-hours' }, settings.prices), { amount: settings.prices.twelveHours, basis: 'fixed' });
  assert.deepEqual({ ...robot.estimateOf({ package: 'local-12-hours' }, settings.prices) }, { amount: settings.prices.twelveHours, basis: 'fixed' });
  assert.equal(isInstantBooking({ package: 'local-12-hours', customerUid: 'u1' }), true);
  assert.equal(robot.instantConfirmable({ package: 'local-12-hours', customerUid: 'u1', status: 'new', ref: 'DB-1' }, ''), true);
  assert.equal(PACKAGE_NAMES['local-12-hours'], robot.PACKAGE_NAMES['local-12-hours']);
});

test('the local bill’s hours: lib/local-bill.ts is the robot’s rule (base hours per package, the 15-minute grace)', () => {
  assert.deepEqual({ ...LOCAL_BASE_HOURS }, { ...robot.LOCAL_BASE_HOURS });
  assert.equal(LOCAL_GRACE_MINUTES, robot.LOCAL_GRACE_MIN);
  const t0 = Date.parse('2026-11-24T04:00:00Z');
  for (const minutes of [0, 15, 16, 59, 60, 75, 76, 180, 195, 196, 721, 735, 736, 900]) {
    assert.equal(usedHours(t0, t0 + minutes * 60_000), robot.usedHours(t0, t0 + minutes * 60_000, robot.LOCAL_GRACE_MIN), `${minutes} min`);
    for (const pkg of Object.keys(LOCAL_BASE_HOURS)) {
      const bill = robot.localBillOf({ package: pkg }, { arrivedAt: new Date(t0), doneAt: new Date(t0 + minutes * 60_000) }, settings.prices, new Date(t0));
      const h = localHours(pkg, t0, t0 + minutes * 60_000);
      assert.deepEqual(h, { baseHours: bill.baseHours, usedHours: bill.usedHours, extraHours: bill.extraHours }, `${pkg} ${minutes} min`);
    }
  }
  assert.equal(localHours('outstation', t0, t0 + 3600_000), null);
  assert.deepEqual(localHours('local-12-hours', t0, t0 + (12 * 60 + 16) * 60_000), { baseHours: 12, usedHours: 13, extraHours: 1 });
});

test('long one-way drops: the settings reach the apps (app-config.json), and the robot prices and pays a Ranchi-like booking consistently', () => {
  const route = read('app/app-config.json/route.ts');
  for (const key of ['driveDay', 'returnDay', 'returnHour', 'driveHoursPerDay', 'driveGraceHours'])
    assert.ok(route.includes(`${key}: outstation.oneWay.${key},`), key);
  assert.ok(route.includes('graceMinutes: outstation.graceMinutes'));
  assert.ok(!/oneWayLong|drivingGraceHours/.test(route), 'the first draft’s names are gone');
  // Raipur → Ranchi as saved on the booking (trip.days = the driving days, returnHours = the hours charged).
  const b = { package: 'one-way-drop', trip: { km: 616, days: 1, returnHours: 11, estFrom: 3200, estTo: 3200 } };
  assert.deepEqual({ ...robot.estimateOf(b, settings.prices) }, { amount: 3200, basis: 'trip' });
  // Generic test rates (the real ones are only in the Script Properties): his pay stays below the price.
  const rates = robot.driverRatesOf(JSON.stringify({ local8h: 500, local12h: 700, localExtraHour: 10, tripDay: 1000, returnHour: 100 }));
  const pay = robot.rateCardPayOf(b, 3200, rates, 160);
  assert.equal(pay, 1000 + Math.min(1000, 11 * 100));
  assert.ok(pay < 3200);
});

test('margin guard: a long one-way drop’s customer price covers the rate card’s pay, from every pickup city to every place', () => {
  const ow = settings.outstation.oneWay;
  const longRules = {
    dayRate: { ...settings.prices.outstation },
    nearRates: settings.prices.outstationNear,
    nearFromKm: settings.outstation.nearFromKm,
    dayTopFromKm: settings.outstation.dayTopFromKm,
    returnHour: settings.outstation.returnHour,
    returnMaxPerDay: settings.outstation.returnMaxPerDay,
    returnFullDayAfter: settings.outstation.returnFullDayAfterHours,
    extraFullDayAfter: settings.outstation.extraFullDayAfterHours,
    extraHour: settings.outstation.extraHour,
    hoursPerDay: settings.outstation.hoursPerDay,
    sameDayMaxHours: settings.outstation.sameDayMaxHours,
    kmPerDay: settings.outstation.kmPerDay,
    averageKmh: settings.outstation.averageKmh,
    busKmh: settings.outstation.busKmh,
    stationHours: settings.outstation.stationHours,
    localWithinKm: settings.outstation.localWithinKm,
    oneWay: { ...ow },
  };
  const nearKm = robot.nearKmOf(settings.prices);
  // The private card's shape with generic numbers: a made-up card below the customer prices, and the
  // highest card the guard allows — his day and his hour home equal to the customer's (then pay ≤ price).
  const cards = [
    { local8h: 500, local12h: 700, localExtraHour: 10, tripDay: 1000, returnHour: 100 },
    { local8h: 500, local12h: 700, localExtraHour: 10, tripDay: ow.driveDay, returnHour: ow.returnHour },
  ].map((c) => robot.driverRatesOf(JSON.stringify(c)));
  assert.ok(cards.every(Boolean), 'the cards parse as DRIVER_RATES');
  let checked = 0;
  for (const from of pickupCities)
    for (const d of destinations) {
      const km = roadKm(from, d);
      if (!(km > nearKm)) continue;
      for (const nonstop of [false, true]) {
        const plan = planTrip(longRules, km, 'one-way', 0, homeWay(d, from), 7, nonstop);
        const est = estimate(longRules, plan);
        assert.ok(est.long, `${from} → ${d.id}`);
        const b = { package: 'one-way-drop', trip: { km: plan.km, days: est.long.drivingDays, returnHours: plan.returnHours, estFrom: est.from, estTo: est.to } };
        const [low, high] = cards.map((c) => robot.rateCardPayOf(b, est.to, c, nearKm));
        assert.ok(low < est.from, `${from} → ${d.id}: ${low} < ${est.from}`);
        assert.ok(high <= est.from, `${from} → ${d.id}: ${high} ≤ ${est.from}`);
        checked++;
      }
    }
  assert.ok(checked > 50, `${checked} routes`);
});
