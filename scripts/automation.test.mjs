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
import {
  destinations,
  driveCharge,
  estimate,
  homeWay,
  longOneWayPrice,
  nightsOf,
  pickupCities,
  planTrip,
  roadKm,
  waitChargeOf,
  wholeTimePay,
} from '../lib/outstation.ts';
import { legsFrom, planReturn } from '../lib/rail.ts';
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
  for (const key of Object.keys(settings.outstation.oneWay)) assert.ok(route.includes(`${key}: outstation.oneWay.${key},`), key);
  assert.ok(route.includes('toStationMinutes: settings.trains.toStationMinutes'));
  assert.ok(!/homeHour|homeDayMax/.test(route), 'v3 keys are gone');
  // The robot's fallbacks are the site's settings (it uses them when the site cannot be read).
  assert.deepEqual({ ...robot.ONE_WAY_DEFAULT }, { ...settings.outstation.oneWay });
  for (const k of Object.keys(robot.TRAINS_DEFAULT)) assert.equal(robot.TRAINS_DEFAULT[k], settings.trains[k], k);
  for (const key of ['kmh', 'breakEveryHours', 'breakMinutes', 'maxRoadHoursPerDay']) assert.ok(route.includes(`${key}: outstation.drive.${key},`), key);
  assert.ok(route.includes('graceMinutes: outstation.graceMinutes'));
  assert.ok(!/oneWayLong|drivingGraceHours|driveDay|returnDay/.test(route), 'the earlier drafts’ names are gone');
  // The robot's drive defaults are the site's settings (it uses them when the site cannot be read).
  assert.deepEqual({ ...robot.DRIVE_DEFAULT }, { ...settings.outstation.drive });
  // Raipur → Ranchi as saved on the booking (v4: the route's usual wait).
  const b = { package: 'one-way-drop', trip: { km: 616, days: 1, returnHours: 21, estFrom: 3350, estTo: 3350 } };
  assert.deepEqual({ ...robot.estimateOf(b, settings.prices) }, { amount: 3350, basis: 'trip' });
  // Generic test rates (the real ones are only in the Script Properties): his whole time 12.4 + 21 h → a day + 10 h — unchanged by v4.
  const rates = robot.driverRatesOf(JSON.stringify({ local8h: 500, local12h: 700, localExtraHour: 10, tripDay: 1000, returnHour: 100 }));
  const pay = robot.rateCardPayOf(b, 3350, rates, 160, robot.driveOf({ drive: settings.outstation.drive }));
  assert.equal(pay, 2000);
  assert.ok(pay < 3350);
});

test('the robot times a one-way drive as the website plans it (roadTime + dropTime), day and night too', () => {
  const longRules = tripRulesForTest();
  const drive = robot.driveOf({ drive: settings.outstation.drive });
  for (const from of pickupCities)
    for (const d of destinations) {
      const km = roadKm(from, d);
      if (!(km > 0)) continue;
      for (const nonstop of [false, true]) {
        const plan = planTrip(longRules, km, 'one-way', 0, homeWay(d, from), 7, nonstop);
        assert.ok(Math.abs(robot.dropHoursOf(km, drive, nonstop) - plan.dropAt) < 1e-9, `${from} → ${d.id} nonstop ${nonstop}`);
      }
    }
  for (const [h, day, hour] of [[0, 1000, 100], [9.2, 1000, 100], [24.05, 1000, 100], [87.2, 1000, 100], [33.1, 800, 70]])
    assert.equal(robot.wholeTimePay(h, day, hour), wholeTimePay(h, day, hour), `${h} h`);
});

/** lib/settings.ts tripRules (which uses the @/ alias Node cannot read). */
function tripRulesForTest() {
  const o = settings.outstation;
  return {
    dayRate: { ...settings.prices.outstation },
    nearRates: settings.prices.outstationNear,
    nearFromKm: o.nearFromKm,
    dayTopFromKm: o.dayTopFromKm,
    returnHour: o.returnHour,
    returnMaxPerDay: o.returnMaxPerDay,
    returnFullDayAfter: o.returnFullDayAfterHours,
    extraFullDayAfter: o.extraFullDayAfterHours,
    extraHour: o.extraHour,
    hoursPerDay: o.hoursPerDay,
    sameDayMaxHours: o.sameDayMaxHours,
    kmPerDay: o.kmPerDay,
    averageKmh: o.averageKmh,
    busKmh: o.busKmh,
    stationHours: o.stationHours,
    localWithinKm: o.localWithinKm,
    oneWay: { ...o.oneWay },
    drive: { ...o.drive },
  };
}

test('margin guard: a long one-way drop’s customer price covers the rate card’s pay for his whole time, from every pickup city to every place', () => {
  const longRules = tripRulesForTest();
  const nearKm = robot.nearKmOf(settings.prices);
  const drive = robot.driveOf({ drive: settings.outstation.drive });
  // The private card's shape with generic numbers (the real ones are only in the Script Properties).
  const card = robot.driverRatesOf(JSON.stringify({ local8h: 500, local12h: 700, localExtraHour: 10, tripDay: 1000, returnHour: 100 }));
  assert.ok(card, 'the card parses as DRIVER_RATES');
  let checked = 0;
  for (const from of pickupCities)
    for (const d of destinations) {
      const km = roadKm(from, d);
      if (!(km > nearKm)) continue;
      for (const nonstop of [false, true]) {
        const plan = planTrip(longRules, km, 'one-way', 0, homeWay(d, from), 7, nonstop);
        const est = estimate(longRules, plan);
        assert.ok(est.long, `${from} → ${d.id}`);
        const b = {
          package: 'one-way-drop',
          ...(nonstop && { notes: 'Day and night driving (non-stop).' }),
          trip: { km: plan.km, days: plan.days, returnHours: plan.returnHours, estFrom: est.from, estTo: est.to },
        };
        const pay = robot.rateCardPayOf(b, est.to, card, nearKm, drive);
        // The website's own sum: the same as the robot's.
        assert.equal(pay, wholeTimePay(plan.dropAt + plan.returnHours, 1000, 100), `${from} → ${d.id}`);
        assert.ok(pay < est.from, `${from} → ${d.id}: pay ${pay} < price ${est.from}`);
        checked++;
      }
    }
  assert.ok(checked > 50, `${checked} routes`);
});

test('v4: the robot prices a train home exactly as the website prices the drop (the drive, the nights, the wait)', () => {
  const r = robot.oneWayOf({ oneWay: settings.outstation.oneWay });
  for (const km of [161, 200, 201, 384, 500, 501, 616, 1118, 1370, 2400]) {
    assert.equal(robot.v4Drive(r, km), driveCharge(settings.outstation.oneWay, km), `${km} km`);
    for (const h of [0, 3.9, 4, 4.01, 10.75, 15.5, 30]) assert.equal(robot.v4WaitCharge(r, km, h), waitChargeOf(settings.outstation.oneWay, km, h).charge, `${km} km, ${h} h`);
  }
  const longRules = tripRulesForTest();
  for (const from of pickupCities)
    for (const d of destinations) {
      const km = roadKm(from, d);
      if (!(km > 160)) continue;
      for (const nonstop of [false, true]) {
        const plan = planTrip(longRules, km, 'one-way', 0, homeWay(d, from), 7, nonstop);
        const b = { package: 'one-way-drop', ...(nonstop && { notes: 'Day and night driving (non-stop).' }), trip: { km, days: plan.days, returnHours: plan.returnHours } };
        const drop = Date.UTC(2026, 10, 25, 6);
        const wait = plan.leaveAt - plan.dropAt;
        const robotPrice = robot.returnPriceOf(b, r, drop, drop + wait * 3_600_000).price;
        assert.equal(robotPrice, estimate(longRules, plan).from, `${from} → ${d.id}${nonstop ? ' day and night' : ''}`);
      }
    }
  // An agreed v4 quote: its drive, nights and minimum; an older quote: its price stands.
  const q = { amount: 3350, dayRate: 2627, km: 616, nights: 0, nightRate: 300, waitHourRate: 100, minimum: 1500, ticket: 0 };
  const drop = Date.UTC(2026, 10, 25, 6);
  assert.deepEqual({ ...robot.returnPriceOf({ quote: q, trip: { km: 616, days: 1 } }, r, drop, drop + 2 * 3_600_000) }, { price: 2650, waitCharge: 0 });
  assert.deepEqual({ ...robot.returnPriceOf({ quote: q, trip: { km: 616, days: 1 } }, r, drop, drop + 9 * 3_600_000) }, { price: 3150, waitCharge: 500 });
  assert.equal(robot.returnPriceOf({ quote: { amount: 2950, ticket: 0, kmRate: 3 }, trip: { km: 616 } }, r, drop, drop + 9 * 3_600_000).price, 2950);
  assert.equal(longOneWayPrice(settings.outstation.oneWay, 616, { nights: nightsOf({ days: 1, nonstop: false }), waitHours: 9 }).price, 3150);
});

test('v4: the robot finds the same trains home as the website’s lookup (direct and one change), from saved timetables', () => {
  const rules = { ...robot.trainRulesOf(settings.trains), maxOptions: 3 };
  const tt = (q, trains) => ({ q, ok: true, timetable: true, checkedAt: '2026-11-24T00:00:00Z', from: { code: q.split('-')[0], name: q.split('-')[0] }, to: { code: q.split('-')[1], name: q.split('-')[1] }, trains });
  const all = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const answers = {
    'RNC-R': tt('RNC-R', [
      { number: '18452', name: 'Tapaswini Exp', runDays: all, dep: '21:40', depDay: 1, arr: '07:10', arrDay: 2, duration: 570 },
      { number: '12873', name: 'Jharkhand Swarna Jayanti', runDays: ['tue', 'sat'], dep: '13:05', depDay: 1, arr: '22:40', arrDay: 1, duration: 575 },
      { number: '08888', name: 'Puja Special', runDays: all, dep: '20:00', depDay: 1, arr: '06:00', arrDay: 2 },
    ]),
    'HTE-R': tt('HTE-R', [{ number: '18452', name: 'Tapaswini Exp', runDays: all, dep: '21:50', depDay: 1, arr: '07:10', arrDay: 2 }]),
  };
  const drop = Date.parse('2026-11-25T19:30:00+05:30'); // a Wednesday, 7:30 PM
  const b = { package: 'one-way-drop', city: 'Raipur', trip: { km: 616, days: 1 } };
  const r = robot.oneWayOf({ oneWay: settings.outstation.oneWay });
  const check = robot.returnCheckOf(b, drop, ['RNC', 'HTE'], [], 'R', r, rules, (pairs) => Object.fromEntries(pairs.map((p) => [p, answers[p]])));
  assert.equal(check.failed, false);
  assert.equal(check.bus, false);
  assert.deepEqual(check.options.map((o) => [o.train, o.from, o.waitMin, o.waitCharge, o.price]), [
    ['18452', 'RNC', 130, 0, 2650], // tonight 9:40 PM: 2 h 10 m after the drop — free
    ['18452', 'RNC', 1570, 1200, 3850], // tomorrow's: 26 h 10 m — the most
  ]);
  // The website's planner on the same timetables (lib/rail.ts legsFrom + planReturn) picks the same trains.
  const ready = drop + settings.trains.toStationMinutes * 60_000;
  const day = (n) => new Date(ready + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);
  const legs = [0, 1].flatMap((n) => ['RNC', 'HTE'].flatMap((s) => {
    const a = answers[`${s}-R`];
    const result = { ok: true, query: { from: s, to: 'R', date: day(n) }, checkedAt: 0, live: false, timetable: true, fromName: s, toName: 'R', trains: a.trains };
    return legsFrom(result).legs;
  }));
  const web = planReturn({ drop, ready, direct: legs, stations: ['RNC', 'HTE'], rules });
  assert.deepEqual(check.options.map((o) => [o.train, o.dep.getTime()]), web.map((o) => [o.legs[0].train.number, o.depart]));
  // Nothing could be asked: failed; the first train more than 12 h after he is ready: a bus too.
  assert.equal(robot.returnCheckOf(b, drop, ['RNC'], [], 'R', r, rules, () => ({})).failed, true);
  const lateOnly = { 'RNC-R': tt('RNC-R', [{ number: '12873', name: 'Jharkhand Swarna Jayanti', runDays: ['thu'], dep: '13:05', depDay: 1, arr: '22:40', arrDay: 1 }]) };
  const late = robot.returnCheckOf(b, drop, ['RNC'], [], 'R', r, rules, (pairs) => Object.fromEntries(pairs.map((p) => [p, lateOnly[p]])));
  assert.deepEqual([late.bus, late.options.length, late.options[0].waitCharge], [true, 1, 1200]);
  // One change at a hub when no direct train leaves soon (Prayagraj → Nagpur → Raipur).
  const hub = {
    'PRYJ-R': tt('PRYJ-R', []),
    'PRYJ-NGP': tt('PRYJ-NGP', [{ number: '12321', name: 'Howrah Mumbai Mail', runDays: all, dep: '22:00', depDay: 1, arr: '10:00', arrDay: 2 }]),
    'NGP-R': tt('NGP-R', [{ number: '12834', name: 'Howrah Exp', runDays: all, dep: '13:00', depDay: 1, arr: '17:30', arrDay: 1 }]),
  };
  const viaNagpur = robot.returnCheckOf({ ...b, trip: { km: 578, days: 1 } }, drop, ['PRYJ'], ['NGP'], 'R', r, rules, (pairs) => Object.fromEntries(pairs.map((p) => [p, hub[p]])));
  // Tonight's and tomorrow night's mail, each with the next afternoon's train from Nagpur (3 h at the change).
  assert.deepEqual(viaNagpur.options.map((o) => [o.train, o.change && o.change.station, o.change && o.change.train, o.waitMin]), [
    ['12321', 'NGP', '12834', 150],
    ['12321', 'NGP', '12834', 150 + 24 * 60],
  ]);
});
