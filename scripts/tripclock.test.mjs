/**
 * The trip clock (lib/tripclock.ts): the driver's steps, the bill so far and
 * the final bill from his taps, and the messages for WhatsApp. One-way drops
 * from 8 Nov 2026 are billed by the driver's time (start → home, 24-hour
 * blocks); older quotes the way they were agreed.
 *
 * Driver costs here are made-up round numbers (the repository is public).
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

/** A quote saved from /admin from 8 Nov 2026: Mumbai, 2 × 24 h + 9 h at ₹1,750 and ₹130 (lib/outstation.ts pricedByTime). */
const timeQuote = { amount: 4670, dayRate: 1750, days: 2, returnHours: 0, returnHourRate: 0, returnCharge: 0, extraHours: 9, extraHourRate: 130, extraCharge: 1170, km: 1118, ticket: 0 };

test('rates: the agreed price, or the price shown for the distance — and which way to bill', () => {
  // No km (a place not in the list) and no quote: the lowest day price, by the hours.
  assert.deepEqual(billRates(null, rules), { dayRate: 1050, extraHourRate: 130, returnHourRate: 120, ticket: 0 });
  // No quote, a one-way drop to a known place: the driver's time at the price shown for the distance.
  assert.deepEqual(billRates(null, rules, 113), { dayRate: 1200, extraHourRate: 130, returnHourRate: 120, ticket: 0, time: { km: 113 } });
  assert.deepEqual(billRates(null, rules, 1118).time, { km: 1118 });
  // A round trip: the days at the day price, never the time.
  assert.deepEqual(billRates(null, rules, 113, false), { dayRate: 1200, extraHourRate: 130, returnHourRate: 120, ticket: 0 });
  // A quote from 8 Nov 2026: its rates and the km.
  assert.deepEqual(billRates(timeQuote, rules, 1118), { dayRate: 1750, extraHourRate: 130, returnHourRate: 0, ticket: 0, time: { km: 1118 } });
  // An older quote by the hours: its rates, by the hours.
  assert.deepEqual(billRates({ dayRate: 1600, extraHourRate: 130, returnHourRate: 120, returnHours: 6, returnCharge: 720, ticket: 650 }, rules, 284), {
    dayRate: 1600, extraHourRate: 130, returnHourRate: 120, ticket: 650,
  });
});

test('the bill so far, then the final bill — by the driver’s time (Raipur → Mumbai)', () => {
  const rates = billRates(timeQuote, rules, 1118);
  const link = { kind: 'one-way', nonstop: false, to: 'Mumbai', startAt: ist('2026-11-05T07:45') };
  // 22 h on the road: inside the first 24 h.
  let now = billNow(link, rates, rules, GRACE, ist('2026-11-06T05:45').getTime());
  assert.deepEqual([now.final, now.bill.days, now.bill.extraHours, now.bill.amount], [false, 1, 0, 1750]);
  // Dropped; 48 h from the start, on his way home: 2 × 24 h.
  const dropped = { ...link, dropAt: ist('2026-11-06T17:00') };
  now = billNow(dropped, rates, rules, GRACE, ist('2026-11-07T07:45').getTime());
  assert.deepEqual([now.final, now.bill.days, now.bill.extraHours, now.bill.amount], [false, 2, 0, 3500]);
  // Home 57 h 10 m after the start: 2 × 24 h + 9 h.
  const done = { ...dropped, homeAt: ist('2026-11-07T16:55') };
  now = billNow(done, rates, rules, GRACE, Date.now());
  assert.equal(now.final, true);
  assert.equal(now.bill.amount, 4670);
  assert.equal(daysText(now.bill), '57 h away: 2 × 24 h + 9 h');
  assert.deepEqual(billLines(now.bill, rules), [
    { label: 'Driver’s time: 57 h, leaves → home (1,118 km, his wait and train home included) = 2 × 24 h × ₹1,750', amount: '₹3,500' },
    { label: '9 hours past the 48 h × ₹130 (never more than one more day)', amount: '₹1,170' },
  ]);
  assert.equal(billBreakdown(now.bill), '₹1,750 × 2 × 24 h of the driver’s time (57 h, leaves → home) + ₹1,170 for 9 hours past them');
  // What is saved on the booking: the customer's numbers and the km — no route hours, no way-home charge.
  const saved = bookingBill(now.bill, false);
  assert.deepEqual(Object.keys(saved).sort(), [
    'amount', 'dayRate', 'days', 'extraCharge', 'extraHourRate', 'extraHours', 'km', 'nonstop', 'returnCharge', 'returnHourRate', 'returnHours', 'ticket',
  ]);
  assert.deepEqual([saved.km, saved.days, saved.extraHours, saved.returnHours, saved.returnCharge, saved.amount], [1118, 2, 9, 0, 0, 4670]);
  // A saved bill reads the same, without the hours.
  assert.equal(billBreakdown(saved), '₹1,750 × 2 × 24 h of the driver’s time + ₹1,170 for 9 hours past them');
  const msg = billMessage({ name: 'Ramesh Sahu', ref: 'DB-1042', city: 'Raipur' }, done, now.bill, rules);
  assert.match(msg, /Hi Ramesh,/);
  assert.match(msg, /Driver home: Sat, 7 Nov, 4:55 pm/);
  assert.match(msg, /• Driver’s time: 57 h, leaves → home/);
  assert.match(msg, /Total: ₹4,670$/);
  // The driver (made-up costs): his cost for each 24 h, his hourly pay past them — at most his day.
  assert.equal(driverPay(now.bill, 1500, 90, rules), 2 * 1500 + 9 * 90);
  assert.equal(driverPay({ ...now.bill, extraHours: 20 }, 1500, 90, rules), 2 * 1500 + 1500);
});

test('a same-day drop without a quote: one price for the trip, at the price shown for the distance', () => {
  const rates = billRates(null, rules, 113); // Raipur → Bilaspur
  const l = { kind: 'one-way', nonstop: false, to: 'Bilaspur', startAt: ist('2026-11-02T07:00'), dropAt: ist('2026-11-02T09:40'), homeAt: ist('2026-11-02T13:10') };
  const { bill } = billNow(l, rates, rules, GRACE, Date.now());
  assert.deepEqual([bill.days, bill.extraHours, bill.amount, bill.time.hours, bill.time.short], [1, 0, 1200, 6, true]);
  assert.deepEqual(billLines(bill, rules), [{ label: 'Driver’s time: 6 h, leaves → home (113 km, home the same day) — one price', amount: '₹1,200' }]);
  assert.equal(billBreakdown(bill), '₹1,200 for the driver’s time (6 h, leaves → home)');
  assert.equal(billBreakdown(bookingBill(bill, false)), '₹1,200 for the driver’s time (up to 24 h, his way home included)');
  // Home only the next day (30 h): the hours past the 24, still less than a day.
  const late = billNow({ ...l, homeAt: ist('2026-11-03T13:10') }, rates, rules, GRACE, Date.now()).bill;
  assert.deepEqual([late.days, late.extraHours, late.amount], [1, 6, 1200 + 6 * 130]);
});

/* Quotes from before 8 Nov 2026 are billed the way they were agreed. */

test('an older quote by the hours (before 8 Nov 2026): Raipur → Bengaluru day and night', () => {
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

test("driver's pay on an older bill: his day, a twelfth of it an hour, his way home with the same daily cap", () => {
  const b = { days: 2, extraHours: 5, returnHours: 38 };
  // Made-up costs (public repo): ₹1,440 a day, ₹80 an hour home.
  // 2 days + 5/12 of a day + way home 38 h (24 h capped at ₹800, then 14 h capped at ₹800).
  assert.equal(driverPay(b, 1440, 80, rules), 2880 + 600 + 1600);
  assert.equal(driverPay({ days: 0, extraHours: 12, returnHours: 0 }, 1440, 80, rules), 1440);
});

test('the WhatsApp message to the driver has his link, in Hindi and English', () => {
  const msg = driverMessage({ ref: 'DB-1042', to: 'Bengaluru', kind: 'one-way', driverName: 'Suresh Verma' }, 'Raipur', 'https://thedrivebuddy.in/trip/?k=abc');
  assert.match(msg, /^नमस्ते Suresh जी, DriveBuddy ट्रिप DB-1042: Raipur → Bengaluru/);
  assert.match(msg, /https:\/\/thedrivebuddy\.in\/trip\/\?k=abc/);
  assert.match(msg, /Hi Suresh, Tap Start/);
  assert.match(driverMessage({ ref: '', to: 'Puri', kind: 'round', driverName: 'Raju' }, 'Durg', 'u'), /Back when the trip is over/);
});

test('a route price on the bill (quotes from 1 Nov to 7 Nov 2026): the agreed one', () => {
  // An agreed route price (a quote with awayHours): Delhi, 3 days paid.
  const quote = { amount: 5550, dayRate: 5550, days: 1, returnHours: 0, returnHourRate: 120, returnCharge: 0, extraHours: 0, extraHourRate: 120, ticket: 0, awayHours: 60, km: 1214 };
  const agreed = billRates(quote, rules, 1214);
  assert.deepEqual(agreed.route, { price: 5550, awayHours: 60, km: 1214 });
  // A quote with the km but no route hours is the driver's time, not a route price.
  assert.equal(billRates({ ...quote, awayHours: undefined }, rules, 1214).route, undefined);
  assert.deepEqual(billRates({ ...quote, awayHours: undefined }, rules, 1214).time, { km: 1214 });

  // Home 65 h 30 m after the start (66 h): inside the 3 days paid (72 h) — the price, nothing more.
  const link = { kind: 'one-way', nonstop: false, to: 'Delhi', startAt: ist('2026-11-02T07:00'), dropAt: ist('2026-11-03T08:00'), homeAt: ist('2026-11-05T00:30') };
  const onTime = billNow(link, agreed, rules, GRACE, Date.now());
  assert.equal(onTime.final, true);
  assert.deepEqual([onTime.bill.amount, onTime.bill.extraHours, onTime.bill.route.realAwayHours], [5550, 0, 66]);
  // Home 77 h 30 m after the start (78 h): 6 h past the 3 days × ₹120.
  const lateLink = { ...link, homeAt: ist('2026-11-05T12:30') };
  const { bill } = billNow(lateLink, agreed, rules, GRACE, Date.now());
  assert.deepEqual([bill.amount, bill.extraHours, bill.route.realAwayHours], [5550 + 720, 6, 78]);
  assert.deepEqual(billLines(bill, rules), [
    { label: 'Route price (1,214 km, planned about 60 h away, his way home included)', amount: '₹5,550' },
    { label: 'Away 78 h — past the 3 days paid (72 h): 6 hours × ₹120, at most ₹1,200 for each 24 h', amount: '₹720' },
  ]);
  assert.equal(billBreakdown(bill), '₹5,550 route price (about 60 h away, way home included) + ₹720 for 6 hours past the days paid');
  assert.equal(daysText(bill), 'route price, 78 h away');
  const saved = bookingBill(bill, false);
  assert.deepEqual([saved.awayHours, saved.km, saved.days, saved.dayRate, saved.amount], [60, 1214, 1, 5550, 6270]);
  // A saved route bill reads the same.
  assert.equal(billBreakdown(saved), '₹5,550 route price (about 60 h away, way home included) + ₹720 for 6 hours past the days paid');
  // The driver (made-up costs): his day cost for the 3 days paid, and his hourly pay for the 6 h past them.
  assert.equal(driverPay(bill, 1440, 80, rules), 3 * 1440 + 6 * 80);
  assert.equal(driverPay(onTime.bill, 1440, 80, rules), 3 * 1440);
  assert.match(billMessage({ name: 'Ravi Sahu', ref: 'DB-1', city: 'Raipur' }, lateLink, bill, rules), /Total: ₹6,270$/);
});

test('a long one-way drop by the km (24 Nov 2026, v3): the meter — the drive fixed once he starts, then his way home', () => {
  const longRules = { ...rules, oneWay: { ...settings.outstation.oneWay }, drive: { ...settings.outstation.drive } };
  // No quote: the settings' price a km, hour home and minimum.
  const rates = billRates(undefined, longRules, 616);
  assert.deepEqual(rates.long, { km: 616, kmRate: 3, minimum: 1500 });
  assert.equal(rates.returnHourRate, 100);
  const start = ist('2026-11-25T07:00');
  const at = (h) => new Date(start.getTime() + h * 3_600_000);
  const link = { kind: 'one-way', nonstop: false, to: 'Ranchi', startAt: start };
  // On the road: the drive's price (1,848 → 1,850), however long it takes.
  for (const h of [1, 12, 20]) assert.equal(billNow(link, rates, longRules, GRACE, at(h).getTime()).bill.amount, 1850, `${h} h on the road`);
  // Dropped at 12 h 22 m; 5 h on his way home: 1,848 + 500 = 2,348 → 2,350.
  const dropped = { ...link, dropAt: at(12 + 22 / 60) };
  const soFar = billNow(dropped, rates, longRules, GRACE, at(12 + 22 / 60 + 5).getTime());
  assert.deepEqual([soFar.final, soFar.bill.amount], [false, 2350]);
  // Home 10 h 41 m after the drop: 11 h → ₹1,100; ₹2,950.
  const home = { ...dropped, homeAt: new Date(dropped.dropAt.getTime() + (10 * 60 + 41) * 60_000) };
  const { bill, final } = billNow(home, rates, longRules, GRACE, Date.now());
  assert.deepEqual([final, bill.amount, bill.dayRate, bill.days, bill.returnHours, bill.returnCharge, bill.long.adjust], [true, 2950, 1848, 1, 11, 1100, 2]);
  assert.deepEqual(billLines(bill, longRules), [
    { label: 'Driving 616 km × ₹3', amount: '₹1,848' },
    { label: 'His way home (drop → home), 11 h: 11 h × ₹100 (never more than ₹1,500 a day)', amount: '₹1,100' },
    { label: 'Rounded to the nearest ₹50', amount: '+₹2' },
  ]);
  assert.equal(billBreakdown(bill), '₹1,848 for 616 km + ₹1,100 way home (11 h) + ₹2 rounding');
  const saved = bookingBill(bill, false);
  assert.deepEqual(
    [saved.km, saved.kmRate, saved.minimum, saved.adjust, saved.amount],
    [616, 3, 1500, 2, 2950],
  );
  assert.equal(saved.amount, saved.dayRate * saved.days + saved.returnCharge + saved.adjust + saved.ticket);
  assert.equal(billBreakdown(saved), '₹1,848 for 616 km + ₹1,100 way home (11 h) + ₹2 rounding', 'the saved bill reads the same');
  assert.equal(daysText(bill), '616 km, the drive’s price');
  // The driver (made-up costs): his whole time 12 h 22 m + 10 h 41 m = 23 h 3 m → 24 h × 80, at most his day.
  assert.equal(driverPay(bill, 1000, 80, longRules), 1000);
  // An agreed quote by the km keeps its own price a km and minimum.
  const quote = { amount: 3550, dayRate: 2464, days: 1, returnHours: 11, returnHourRate: 100, returnCharge: 1100, extraHours: 0, extraHourRate: 0, extraCharge: 0, km: 616, kmRate: 4, minimum: 1500, adjust: -14, ticket: 0 };
  assert.deepEqual(billRates(quote, longRules, 616).long, { km: 616, kmRate: 4, minimum: 1500 });
  // A v2 quote (driving days) is billed as agreed.
  const v2 = { amount: 3200, dayRate: 1600, days: 1, returnHours: 11, returnHourRate: 160, returnCharge: 1600, extraHours: 0, extraHourRate: 0, extraCharge: 0, km: 616, ticket: 0 };
  const v2Rates = billRates(v2, longRules, 616);
  assert.deepEqual([v2Rates.v2Long, v2Rates.long], [{ km: 616 }, undefined]);
  assert.equal(billNow(home, v2Rates, longRules, GRACE, Date.now()).bill.amount, 3200);
});
