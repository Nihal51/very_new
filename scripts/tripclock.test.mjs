/**
 * The trip clock (lib/tripclock.ts): the driver's steps, the bill so far and
 * the final bill from his taps, and the messages for WhatsApp.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  billBreakdown,
  billLines,
  billMessage,
  billNow,
  billRates,
  bookingBill,
  daysText,
  driverMessage,
  driverPay,
  durationText,
  fromLocalInput,
  nextStep,
  phoneGap,
  stepsFor,
  toLocalInput,
} from '../lib/tripclock.ts';
import { settings } from '../site-settings.ts';

const rules = {
  dayRate: { ...settings.prices.outstation },
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
};
const GRACE = settings.outstation.graceMinutes;
const ist = (s) => new Date(`${s}:00+05:30`);

test('steps: start → drop → home one way; start → back on a round trip', () => {
  assert.deepEqual(stepsFor('one-way'), ['start', 'drop', 'home']);
  assert.deepEqual(stepsFor('round'), ['start', 'home']);
  assert.equal(nextStep({ kind: 'one-way' }), 'start');
  assert.equal(nextStep({ kind: 'one-way', startAt: new Date() }), 'drop');
  assert.equal(nextStep({ kind: 'one-way', startAt: new Date(), dropAt: new Date() }), 'home');
  assert.equal(nextStep({ kind: 'one-way', startAt: new Date(), dropAt: new Date(), homeAt: new Date() }), null);
  assert.equal(nextStep({ kind: 'round', startAt: new Date() }), 'home');
});

test('times: India time in and out of the admin time field', () => {
  const d = ist('2026-10-30T12:40');
  assert.equal(toLocalInput(d), '2026-10-30T12:40');
  assert.equal(fromLocalInput('2026-10-30T12:40').getTime(), d.getTime());
  assert.equal(fromLocalInput('rubbish'), undefined);
  assert.equal(toLocalInput(undefined), '');
  assert.equal(durationText(28 * 60 + 55), '28 h 55 m');
  assert.equal(durationText(120), '2 h');
  assert.equal(durationText(45), '45 m');
});

test('a tap that reached us late shows the phone time', () => {
  const l = { startAt: ist('2026-10-29T08:05'), startPhone: ist('2026-10-29T07:45'), dropAt: ist('2026-10-30T12:40'), dropPhone: ist('2026-10-30T12:38') };
  assert.equal(phoneGap(l, 'start').getTime(), ist('2026-10-29T07:45').getTime());
  assert.equal(phoneGap(l, 'drop'), undefined);
  assert.equal(phoneGap(l, 'home'), undefined);
});

test('rates: the agreed price, or the lowest shown', () => {
  assert.deepEqual(billRates(null, rules), { dayRate: rules.dayRate.from, extraHourRate: 120, returnHourRate: 120, ticket: 0 });
  assert.deepEqual(billRates({ dayRate: 1600, extraHourRate: 130, returnHourRate: 120, ticket: 650 }, rules), {
    dayRate: 1600, extraHourRate: 130, returnHourRate: 120, ticket: 650,
  });
});

test('the bill so far, then the final bill — Raipur → Bengaluru day and night', () => {
  const rates = { dayRate: 1600, extraHourRate: 120, returnHourRate: 120, ticket: 0 };
  const link = { kind: 'one-way', nonstop: true, to: 'Bengaluru', startAt: ist('2026-10-29T07:45') };
  // Not started: nothing.
  assert.equal(billNow({ kind: 'one-way', nonstop: true }, rates, rules, GRACE, Date.now()), undefined);
  // 19 h on the road: 1 day + 7 h.
  let now = billNow(link, rates, rules, GRACE, ist('2026-10-30T02:45').getTime());
  assert.deepEqual([now.final, now.bill.days, now.bill.extraHours, now.bill.amount], [false, 1, 7, 1600 + 840]);
  // Dropped, on his way home for 10 h.
  const dropped = { ...link, dropAt: ist('2026-10-30T12:40') };
  now = billNow(dropped, rates, rules, GRACE, ist('2026-10-30T22:40').getTime());
  assert.deepEqual([now.final, now.bill.days, now.bill.extraHours, now.bill.returnHours, now.bill.returnCharge], [false, 2, 5, 10, 1200]);
  // Home: the final bill.
  const done = { ...dropped, homeAt: ist('2026-11-01T02:20') };
  now = billNow(done, rates, rules, GRACE, Date.now());
  assert.equal(now.final, true);
  assert.equal(now.bill.amount, 6200);
  assert.equal(daysText(now.bill), '2 days + 5 h');
  assert.equal(billBreakdown(now.bill), '₹1,600 × 2 days + ₹600 for 5 extra hours + ₹2,400 way home (38 h)');
  assert.deepEqual(billLines(now.bill, rules), [
    { label: '2 days × ₹1,600', amount: '₹3,200' },
    { label: '5 driving hours more × ₹120', amount: '₹600' },
    { label: 'Driver’s way home: 38 h = 2 days × ₹1,200 (1 day + 14 h; more than 6 h left over = a full day)', amount: '₹2,400' },
  ]);
  // What is saved on the booking: the customer's numbers only.
  assert.deepEqual(Object.keys(bookingBill(now.bill, true)).sort(), [
    'amount', 'dayRate', 'days', 'extraCharge', 'extraHourRate', 'extraHours', 'nonstop', 'returnCharge', 'returnHourRate', 'returnHours', 'ticket',
  ]);
  const msg = billMessage({ name: 'Ramesh Sahu', ref: 'DB-1042', city: 'Raipur' }, done, now.bill, rules);
  assert.match(msg, /Hi Ramesh,/);
  assert.match(msg, /final bill for DB-1042 \(Raipur → Bengaluru\)/);
  assert.match(msg, /Car dropped: Fri, 30 Oct, 12:40 pm \(28 h 55 m on the road\)/);
  assert.match(msg, /Driver home: Sun, 1 Nov, 2:20 am \(37 h 40 m after the drop\)/);
  assert.match(msg, /Total: ₹6,200$/);
});

test('a round trip: start → back, at least one day', () => {
  const rates = { dayRate: 1550, extraHourRate: 120, returnHourRate: 120, ticket: 0 };
  const l = { kind: 'round', nonstop: false, startAt: ist('2026-11-02T06:00'), homeAt: ist('2026-11-04T11:10') };
  const now = billNow(l, rates, rules, GRACE, Date.now());
  assert.deepEqual([now.bill.days, now.bill.extraHours, now.bill.returnHours, now.bill.amount], [2, 5, 0, 2 * 1550 + 600]);
  const msg = billMessage({ name: 'Anita', ref: '', city: 'Bhilai' }, { ...l, to: 'Puri' }, now.bill, rules);
  assert.match(msg, /Back: Wed, 4 Nov, 11:10 am \(53 h 10 m\)/);
});

test("driver's pay: his day, a twelfth of it an hour, his way home with the same daily cap", () => {
  const b = { days: 2, extraHours: 5, returnHours: 38 };
  // Made-up costs (public repo): ₹1,200 a day, ₹100 an hour home.
  // 2 days + 5/12 of a day + way home 38 h (24 h capped at ₹1,000, then 14 h capped at ₹1,000).
  assert.equal(driverPay(b, 1200, 100, rules), 2400 + 500 + 2000);
  assert.equal(driverPay({ days: 0, extraHours: 12, returnHours: 0 }, 1200, 100, rules), 1200);
});

test('the WhatsApp message to the driver has his link, in Hindi and English', () => {
  const msg = driverMessage({ ref: 'DB-1042', to: 'Bengaluru', kind: 'one-way', driverName: 'Suresh Verma' }, 'Raipur', 'https://thedrivebuddy.in/trip/?k=abc');
  assert.match(msg, /^नमस्ते Suresh जी, DriveBuddy ट्रिप DB-1042: Raipur → Bengaluru/);
  assert.match(msg, /https:\/\/thedrivebuddy\.in\/trip\/\?k=abc/);
  assert.match(msg, /Hi Suresh, Tap Start/);
  assert.match(driverMessage({ ref: '', to: 'Puri', kind: 'round', driverName: 'Raju' }, 'Durg', 'u'), /Back when the trip is over/);
});
