/**
 * The outstation estimate and the /admin quote (lib/outstation.ts), with the
 * worked examples agreed with the owner on 19 Oct 2026, and the profit guard
 * on site-settings.ts (lib/settings-schema.ts).
 *
 * Driver costs in this file are made-up round numbers: the repository is
 * public, so real costs never go in it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  destinationTable,
  destinations,
  estimate,
  findDestination,
  homeTravelHours,
  dropTime,
  homeWay,
  pickupCities,
  planTrip,
  quote,
  returnCost,
  roadKm,
} from '../lib/outstation.ts';
import { checkSettings } from '../lib/settings-schema.ts';
import { settings } from '../site-settings.ts';

/** The same mapping as tripRules in lib/settings.ts (which uses the @/ alias Node cannot read). */
const rules = {
  dayRate: { ...settings.prices.outstation },
  returnHour: settings.outstation.returnHour,
  returnMaxPerDay: settings.outstation.returnMaxPerDay,
  extraHour: settings.outstation.extraHour,
  hoursPerDay: settings.outstation.hoursPerDay,
  sameDayMaxHours: settings.outstation.sameDayMaxHours,
  kmPerDay: settings.outstation.kmPerDay,
  averageKmh: settings.outstation.averageKmh,
  busKmh: settings.outstation.busKmh,
  stationHours: settings.outstation.stationHours,
  localWithinKm: settings.outstation.localWithinKm,
};
const { from: lo, to: hi } = rules.dayRate;

const fromRaipur = (id) => roadKm('Raipur', findDestination(id));
/** A trip from Raipur as the booking form plans it: with the real trains home, leaving at `start` (7 AM, any day). */
const trip = (id, kind = 'one-way', days = 0, start = 7, nonstop = false) =>
  planTrip(rules, fromRaipur(id), kind, days, homeWay(findDestination(id), 'Raipur'), start, nonstop);
const price = (plan) => {
  const e = estimate(rules, plan);
  return [e.from, e.to];
};

/* ------------------------------------------------------- distances ---- */

test('every destination has a unique id and sensible distances', () => {
  const ids = destinations.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate destination id');
  for (const d of destinations) {
    assert.match(d.id, /^[a-z]+$/, `${d.id}: ids are lowercase letters`);
    assert.ok(d.nameHi.trim(), `${d.id}: Hindi name missing`);
    if (d.id === 'raipur') continue;
    const winding = d.fromRaipur.road / d.fromRaipur.air;
    assert.ok(winding >= 1 && winding <= 1.6, `${d.id}: road ${d.fromRaipur.road} vs straight ${d.fromRaipur.air} km looks wrong`);
  }
  for (const city of pickupCities) assert.ok(findDestination(city.toLowerCase()), `${city} must be a destination too`);
});

test('road km: measured from Raipur, worked out from the other pickup cities', () => {
  assert.equal(fromRaipur('nagpur'), 284);
  assert.equal(roadKm('Raipur', findDestination('raipur')), 0);
  assert.equal(roadKm('Bilaspur', findDestination('bilaspur')), 0);
  // Bilaspur → Raipur is the measured road, not a guess.
  assert.equal(roadKm('Bilaspur', findDestination('raipur')), 110);
  // Bhilai → Nagpur is shorter than going back through Raipur (33 + 284).
  const bhilaiNagpur = roadKm('Bhilai', findDestination('nagpur'));
  assert.ok(bhilaiNagpur < 317 && bhilaiNagpur >= 230, `Bhilai → Nagpur ${bhilaiNagpur} km`);
  // Never more than via Raipur.
  for (const city of pickupCities) {
    const origin = findDestination(city.toLowerCase());
    for (const d of destinations) {
      const km = roadKm(city, d);
      assert.ok(km <= Math.round((origin.fromRaipur.road + d.fromRaipur.road) / 10) * 10 + 5, `${city} → ${d.id}`);
    }
  }
});

/* ------------------------------------------------------ the examples ---- */
/* Agreed with the owner, 28 Oct 2026: each 12 h of driving (~600 km) is a day
   at ₹1,550–1,650, the rest ₹120 an hour (a shorter drive: all by the hour);
   the driver's way home — from the drop until he is home, waiting for his
   train included — ₹120 an hour, at most ₹1,200 a day. Timings from the
   start date and time: 12 h of driving and 12 of rest, or day and night. */

test('Raipur → Nagpur one-way: 6 h of driving + 6 h home, all by the hour — ₹1,440', () => {
  const plan = trip('nagpur');
  assert.deepEqual([plan.fullDays, plan.extraHours, plan.days, plan.returnHours, plan.local], [0, 6, 1, 6, false]);
  assert.deepEqual(price(plan), [1440, 1440]);
});

test('Raipur → Mumbai one-way: 1 day + 11 h of driving, the 9:10 PM Mail, 23 h home — ₹4,070–4,170', () => {
  const plan = trip('mumbai');
  assert.deepEqual([plan.fullDays, plan.extraHours, plan.days], [1, 11, 2]);
  assert.equal(plan.train.no, '12809');
  assert.equal(plan.returnHours, 23);
  const e = estimate(rules, plan);
  assert.deepEqual([e.extraCharge, e.returnCharge], [11 * 120, 1200]);
  assert.deepEqual(price(plan), [4070, 4170]);
});

test('Raipur → Hyderabad: drops ~10:30 AM day 2 and waits ~11 h for the 10:40 PM train — paid as way home', () => {
  const plan = trip('hyderabad');
  assert.deepEqual([plan.fullDays, plan.extraHours], [1, 4]);
  assert.equal(plan.train.no, '12771');
  assert.ok(plan.leaveAt - plan.dropAt > 11);
  assert.equal(plan.returnHours, 27);
  assert.deepEqual(price(plan), [1550 + 480 + 1200 + 360, 1650 + 480 + 1200 + 360]);
});

test('Raipur → Delhi: 2 days + 1 h of driving; the trains that do not run that day are skipped', () => {
  // Unknown day: only the daily Chhattisgarh Exp counts.
  const anyDay = trip('delhi');
  assert.deepEqual([anyDay.fullDays, anyDay.extraHours, anyDay.days], [2, 1, 2]);
  assert.equal(anyDay.train.no, '18238');
  // Leaving on a Sunday: drops the car Monday evening; the Samta runs Tuesday morning.
  const sunday = trip('delhi', 'one-way', 0, { hour: 7, weekday: 0 });
  assert.equal(sunday.train.no, '12808');
  assert.ok(sunday.homeAt < anyDay.homeAt);
  // Leaving on a Monday: drops Tuesday evening; no Samta on Wednesday, so the daily train.
  assert.equal(trip('delhi', 'one-way', 0, { hour: 7, weekday: 1 }).train.no, '18238');
});

test('Raipur → Bengaluru: no daily direct train — the daily change at Nagpur beats waiting for the weekly ones', () => {
  const plan = trip('bengaluru', 'one-way', 0, { hour: 7, weekday: 1 });
  assert.deepEqual([plan.fullDays, plan.extraHours, plan.days], [2, 4, 3]);
  assert.equal(plan.train.via, 'Nagpur');
  // The Thursday-only train is never taken on a Wednesday.
  for (let weekday = 0; weekday < 7; weekday++) {
    const p = trip('bengaluru', 'one-way', 0, { hour: 7, weekday });
    if (p.train.days) {
      const leavesOn = (weekday + Math.floor((7 + p.leaveAt) / 24)) % 7;
      assert.ok(p.train.days.includes(leavesOn), `weekday ${weekday}: ${p.train.no} does not run on ${leavesOn}`);
    }
  }
});

test('Raipur → Kolkata: drops before noon on day 2, the afternoon Gitanjali, 16 h home', () => {
  const plan = trip('kolkata');
  assert.equal(plan.train.no, '12860');
  assert.equal(plan.returnHours, 16);
  assert.deepEqual(price(plan), [1550 + 5 * 120 + 1200, 1650 + 5 * 120 + 1200]);
});

test('day and night (non-stop): the same driving price, an earlier drop — the train decides if it helps', () => {
  const normal = trip('mumbai');
  const nonstop = trip('mumbai', 'one-way', 0, 7, true);
  assert.equal(nonstop.nonstop, true);
  assert.deepEqual([nonstop.fullDays, nonstop.extraHours], [normal.fullDays, normal.extraHours]);
  assert.ok(Math.abs(nonstop.dropAt - nonstop.driveHours) < 1e-9);
  assert.ok(nonstop.dropAt < normal.dropAt);
  // Mumbai at 5:20 AM: the next train is still the 9:10 PM one, so he waits — more hours home.
  assert.ok(nonstop.returnHours > normal.returnHours);
});

test('the drive: 12 h a day and 12 of rest; up to an hour more finishes that evening', () => {
  assert.equal(dropTime(rules, 6), 6);
  assert.equal(dropTime(rules, 12), 12);
  assert.equal(dropTime(rules, 12.5), 12.5, 'half an hour more: the same evening');
  assert.equal(dropTime(rules, 13.5), 24 + 1.5, 'an hour and a half more: the next morning');
  assert.equal(dropTime(rules, 22.4), 24 + 10.4);
  assert.equal(dropTime(rules, 24), 36);
  assert.equal(dropTime(rules, 22.4, true), 22.4);
  assert.equal(dropTime(rules, 6, false, 2), 48 + 6, 'two days booked on top: stops on the way');
});

test('the first train he can catch is at least stationHours after the drop, on a day it runs', () => {
  for (const d of destinations) {
    if (!d.home.trains) continue;
    for (const hour of [0, 5, 7, 9.5, 13, 18, 23])
      for (const weekday of [undefined, 0, 3, 6]) {
        const plan = trip(d.id, 'one-way', 0, { hour, weekday });
        if (!plan.train) continue;
        assert.ok(plan.leaveAt >= plan.dropAt + rules.stationHours - 1e-9, `${d.id} @${hour}`);
        const [h, m] = plan.train.dep.split(':').map(Number);
        const clock = (((hour + plan.leaveAt) % 24) + 24) % 24;
        assert.ok(Math.abs(clock - (h + m / 60)) < 1e-6, `${d.id} @${hour}: leaves at ${clock}`);
        if (plan.train.days) {
          assert.notEqual(weekday, undefined, 'a train with running days needs the date');
          assert.ok(plan.train.days.includes((weekday + Math.floor((hour + plan.leaveAt) / 24)) % 7));
        }
      }
  }
});

test('every regular train is sensible: number, HH:MM, running days, hours close to the route\'s average', () => {
  for (const d of destinations)
    for (const t of d.home.trains ?? []) {
      assert.match(t.dep, /^([01]\d|2[0-3]):[0-5]\d$/, `${d.id} ${t.no}`);
      assert.match(t.no, /^\d{5}$/, `${d.id} ${t.no}`);
      assert.ok(t.hours > 0 && Math.abs(t.hours - d.home.raipur) <= 8, `${d.id} ${t.no}: ${t.hours} h`);
      for (const day of t.days ?? []) assert.ok(Number.isInteger(day) && day >= 0 && day <= 6, `${d.id} ${t.no}`);
    }
});

test('the train/bus time home comes from the timetables, per pickup city', () => {
  const delhi = findDestination('delhi');
  assert.deepEqual(
    pickupCities.map((c) => homeTravelHours(delhi, c)),
    [delhi.home.raipur, delhi.home.durg, delhi.home.durg, delhi.home.bilaspur],
    'Bhilai uses the Durg times',
  );
  const kolkata = findDestination('kolkata');
  assert.ok(homeTravelHours(kolkata, 'Bilaspur') < homeTravelHours(kolkata, 'Raipur'));
  const raipur = planTrip(rules, 831, 'one-way', 0, homeWay(kolkata, 'Raipur'));
  const bilaspur = planTrip(rules, 831, 'one-way', 0, homeWay(kolkata, 'Bilaspur'));
  assert.ok(Math.abs(raipur.homeAt - bilaspur.homeAt - 2) < 1e-9);
  for (const d of destinations)
    for (const c of pickupCities) {
      const h = homeTravelHours(d, c);
      assert.ok(Number.isFinite(h) && h >= 0 && h <= 40, `${d.id} → ${c}: ${h}`);
    }
  // A place typed in by hand: the distance at busKmh.
  const typed = planTrip(rules, 1214, 'one-way');
  assert.ok(Math.abs(typed.homeAt - (typed.dropAt + rules.stationHours + 1214 / rules.busKmh)) < 1e-9);
});

test('the way home: ₹120 an hour from the drop, at most ₹1,200 in any 24 hours', () => {
  assert.equal(returnCost(0, 120, 1200), 0);
  assert.equal(returnCost(6, 120, 1200), 720);
  assert.equal(returnCost(14, 120, 1200), 1200);
  assert.equal(returnCost(27, 120, 1200), 1200 + 360);
  assert.equal(returnCost(38, 120, 1200), 2400);
  assert.equal(returnCost(Number.NaN, 120, 1200), 0);
});

test('the customer books more days (stops on the way): each is a full day, he drops the car on the last one', () => {
  const two = trip('delhi');
  const four = trip('delhi', 'one-way', 4);
  assert.deepEqual([four.minDays, four.days, four.fullDays, four.extraHours], [2, 4, 4, 0]);
  assert.ok(Math.abs(four.dropAt - two.dropAt - 48) < 1e-9);
  assert.equal(price(four)[0], 4 * 1550 + estimate(rules, four).returnCharge);
  // Fewer days than the drive needs change nothing; a typo like 500 is capped.
  assert.deepEqual([trip('delhi', 'one-way', 1).fullDays, trip('delhi', 'one-way', 1).extraHours], [2, 1]);
  assert.equal(planTrip(rules, 300, 'one-way', 500).days, 60);
});

test('a round trip is days of the trip; back home within the 24 hours is ONE day', () => {
  const jharsuguda = trip('jharsuguda', 'round');
  assert.deepEqual([jharsuguda.days, jharsuguda.fullDays, jharsuguda.returnHours], [1, 1, 0]);
  assert.deepEqual(price(jharsuguda), [1550, 1650]);
  assert.equal(trip('nagpur', 'round').days, 1);
  assert.equal(trip('jabalpur', 'round').days, 2, '766 km');
  assert.equal(trip('bhopal', 'round').days, 2);
  assert.equal(trip('delhi', 'round').days, 4);
  assert.equal(trip('jharsuguda', 'round', 2).days, 2);
});

test('closer than localWithinKm is flagged as a local trip; a strange start falls back to 7 AM', () => {
  assert.equal(planTrip(rules, fromRaipur('bhilai'), 'one-way').local, true);
  assert.equal(planTrip(rules, fromRaipur('rajnandgaon'), 'one-way').local, false);
  assert.equal(planTrip(rules, 300, 'one-way', 0, {}, Number.NaN).startHour, 7);
  assert.equal(planTrip(rules, 300, 'one-way', 0, {}, { hour: 31, weekday: 9 }).startHour, 7);
  assert.equal(planTrip(rules, 300, 'one-way', 0, {}, { hour: 31, weekday: 9 }).weekday, undefined);
});

/* ------------------------------------------------------- the quote ---- */
/* Driver costs here are made-up round numbers (the repository is public). */

const base = { driverReturnHourPay: 90, days: 1, returnHours: 23, extraHours: 11, ticket: 0, partnerPercent: 0, minProfitPercent: 15 };

test('quote: driver cost + 15%, rounded up to ₹50 a day; hours at the published ₹120 or the cost-based rate', () => {
  const q = quote(rules, { ...base, driverDayCost: 1000 });
  assert.equal(q.dayRate, 1200); // 1000 / 0.85 = 1176.5 → 1200
  assert.equal(q.returnHourRate, 120); // 90 / 0.85 = 105.9 → 110, never below the shown 120
  assert.equal(q.returnCharge, 1200); // 23 h, at most 10 hours' worth a day
  assert.equal(q.extraHourRate, 120);
  assert.equal(q.charges, 1200 + 11 * 120 + 1200);
  assert.equal(q.profit, q.charges - q.driverPay);
  assert.ok(q.profitPercent >= 15 && q.ok);
  assert.equal(quote(rules, { ...base, driverDayCost: 1250 }).dayRate, 1500);
});

test('quote: a drive shorter than a day — 0 full days, everything by the hour', () => {
  const q = quote(rules, { ...base, driverDayCost: 1000, days: 0, extraHours: 6, returnHours: 6 });
  assert.deepEqual([q.days, q.charges], [0, 6 * 120 + 6 * 120]);
  // Nothing at all is one day.
  assert.equal(quote(rules, { ...base, driverDayCost: 1000, days: 0, extraHours: 0, returnHours: 0 }).days, 1);
});

test('quote: a ticket we bought is passed through with no profit on it', () => {
  const without = quote(rules, { ...base, driverDayCost: 1000 });
  const withTicket = quote(rules, { ...base, driverDayCost: 1000, ticket: 650 });
  assert.equal(withTicket.total, without.total + 650);
  assert.equal(withTicket.profit, without.profit);
});

test('quote: a partner commission is priced in, so the profit still holds', () => {
  const q = quote(rules, { ...base, driverDayCost: 1000, extraHours: 0, returnHours: 0, partnerPercent: 10 });
  assert.equal(q.dayRate, 1350);
  assert.equal(q.partnerPay, 135);
  assert.ok(q.ok, `profit ${q.profitPercent}%`);
});

test('quote: a dearer driver for the way home raises the rate, never below the shown ₹120', () => {
  const dearer = quote(rules, { ...base, driverDayCost: 1000, driverReturnHourPay: 120 });
  assert.equal(dearer.returnHourRate, 150);
  assert.equal(dearer.returnCharge, 1500); // the same 10-hour daily maximum
  assert.equal(dearer.aboveShownRange, true);
  assert.ok(dearer.ok, `profit ${dearer.profitPercent}%`);
});

test('quote: the minimum profit always holds', () => {
  for (const cost of [900, 1000, 1200, 1300, 1400, 1550])
    for (const pay of [60, 90, 120, 150])
      for (const back of [0, 4, 11, 30, 50])
        for (const partnerPercent of [0, 10]) {
          const q = quote(rules, { ...base, driverDayCost: cost, driverReturnHourPay: pay, returnHours: back, extraHours: 3, partnerPercent });
          assert.ok(q.ok, `cost ${cost}, pay ${pay}, ${back} h, partner ${partnerPercent}%: ${q.profitPercent}%`);
        }
  assert.equal(quote(rules, { ...base, driverDayCost: 1500 }).aboveShownRange, true);
});

test('quote: nonsense input never produces NaN', () => {
  const q = quote(rules, { ...base, driverDayCost: Number.NaN, days: -2, extraHours: -1, ticket: Number.NaN, returnHours: Number.NaN });
  for (const v of Object.values(q)) if (typeof v === 'number') assert.ok(Number.isFinite(v));
});

/* ------------------------------------------------- the app's table ---- */

test('the app table has every destination from every pickup city, and what the app needs to redo the plan', () => {
  const table = destinationTable(rules);
  assert.equal(table.length, destinations.length);
  for (const row of table)
    for (const city of pickupCities) {
      const t = row.from[city];
      assert.ok(t && t.km >= 0 && t.oneWay.days >= 1 && t.roundDays >= 1, `${city} → ${row.id}`);
      assert.ok(Number.isFinite(t.oneWay.driveHours) && t.oneWay.driveHours >= 0, `${city} → ${row.id}`);
      assert.ok(Number.isFinite(t.oneWay.homeHours) && t.oneWay.homeHours >= 0, `${city} → ${row.id}`);
    }
  const nagpur = table.find((r) => r.id === 'nagpur');
  assert.deepEqual([nagpur.from.Raipur.km, nagpur.from.Raipur.oneWay.days, nagpur.from.Raipur.oneWay.returnHours], [284, 1, 6]);
  const blr = table.find((r) => r.id === 'bengaluru');
  assert.deepEqual(blr.trains, findDestination('bengaluru').home.trains);
  assert.ok(Math.abs(blr.from.Raipur.oneWay.driveHours - 1370 / rules.averageKmh) < 0.001);
});

/* ------------------------------------------------- the profit guard ---- */

test('site-settings.ts passes its own checks', () => {
  assert.doesNotThrow(() => checkSettings(settings));
});

test('profit guard: passes when the prices cover the costs', () => {
  assert.doesNotThrow(() => checkSettings(settings, 'outstation=1000-1100; fullDay=700'));
  assert.doesNotThrow(() => checkSettings(settings, ''));
});

test('profit guard: a price too low stops the build, without printing the cost', () => {
  assert.throws(
    () => checkSettings(settings, 'outstation=1600-1700'),
    (err) => {
      assert.match(err.message, /prices\.outstation\.from/);
      assert.match(err.message, /prices\.outstation\.to/);
      assert.doesNotMatch(err.message, /1600|1700/, 'the public build log must not show costs');
      return true;
    },
  );
  assert.throws(() => checkSettings(settings, 'outstation 1000'), /part 1 cannot be read/);
  assert.throws(() => checkSettings(settings, 'taxi=100'), /"taxi", which is not one of the prices/);
});
