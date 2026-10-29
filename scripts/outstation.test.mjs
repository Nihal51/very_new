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
  billDays,
  chargeHours,
  destinationTable,
  finalBill,
  destinations,
  estimate,
  findDestination,
  homeTravelHours,
  dropTime,
  homeWay,
  pickupCities,
  planTrip,
  quote,
  dayRateFor,
  returnCost,
  roadKm,
} from '../lib/outstation.ts';
import { checkSettings } from '../lib/settings-schema.ts';
import { settings } from '../site-settings.ts';

/** The same mapping as tripRules in lib/settings.ts (which uses the @/ alias Node cannot read). */
const rules = {
  dayRate: { ...settings.prices.outstation },
  nearRates: settings.prices.outstationNear,
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
const { from: lo, to: hi } = rules.dayRate;

const fromRaipur = (id) => roadKm('Raipur', findDestination(id));
/** A trip from Raipur as the booking form plans it before the train lookup (the typical time home), leaving at `start` (7 AM, any day). */
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

test('Raipur → Mumbai one-way: 22.4 h of driving = 1 day + 11 h, and 11 h > 7 = 2 full days; the typical 18 h home — ₹4,300–4,500', () => {
  const plan = trip('mumbai');
  assert.deepEqual([plan.fullDays, plan.extraHours, plan.days], [2, 0, 2]);
  assert.equal(plan.homeBasis, 'allowance', 'no train is invented: the typical time until the lookup confirms one');
  assert.equal(plan.returnHours, 1 + 18);
  const e = estimate(rules, plan);
  assert.deepEqual([e.extraCharge, e.returnCharge], [0, 1200]);
  assert.deepEqual(price(plan), [2 * 1550 + 1200, 2 * 1650 + 1200]);
});

test('no train, time or running day is typed into the destinations — train routes list only their stations', () => {
  for (const d of destinations) {
    assert.equal('trains' in d.home, false, `${d.id}: train times come from the lookup, never from this file`);
    if (!d.rail) continue;
    assert.equal(d.home.by, 'train', `${d.id}: stations only on train routes`);
    assert.ok(d.rail.stations.length >= 1 && d.rail.stations.length <= 3, `${d.id}: 1–3 stations`);
    for (const code of [...d.rail.stations, ...(d.rail.hubs ?? [])]) assert.match(code, /^[A-Z]{1,5}$/, `${d.id}: ${code}`);
    for (const hub of d.rail.hubs ?? []) assert.ok(!d.rail.stations.includes(hub), `${d.id}: a change station is not a boarding one`);
  }
  // Long train routes all have their stations; the change at Nagpur where direct trains are few.
  for (const id of ['nagpur', 'jabalpur', 'visakhapatnam', 'varanasi', 'hyderabad', 'kolkata', 'pune', 'mumbai', 'delhi', 'bengaluru'])
    assert.ok(findDestination(id).rail, id);
  assert.deepEqual([...findDestination('bengaluru').rail.hubs], ['NGP']);
});

test('Raipur → Kolkata: drops before noon on day 2; the typical way home', () => {
  const plan = trip('kolkata');
  assert.equal(plan.returnHours, Math.ceil(1 + findDestination('kolkata').home.raipur));
  assert.deepEqual(price(plan), [1550 + 5 * 120 + 1200, 1650 + 5 * 120 + 1200]);
});

test('day and night (non-stop): the same driving price, an earlier drop', () => {
  const normal = trip('mumbai');
  const nonstop = trip('mumbai', 'one-way', 0, 7, true);
  assert.equal(nonstop.nonstop, true);
  assert.deepEqual([nonstop.fullDays, nonstop.extraHours], [normal.fullDays, normal.extraHours]);
  assert.ok(Math.abs(nonstop.dropAt - nonstop.driveHours) < 1e-9);
  assert.ok(nonstop.dropAt < normal.dropAt);
  // Whether that saves time home depends on the trains for the date (lib/rail.ts); the allowance is the same.
  assert.equal(nonstop.returnHours, normal.returnHours);
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

test('the typical time home (the allowance) per pickup city', () => {
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

test('the day price by distance (decided 29 Oct 2026): nearer places cost less a day', () => {
  // Up to 150 km ₹1,300–1,400; up to 300 km ₹1,450–1,550; farther ₹1,550–1,650.
  assert.deepEqual(dayRateFor(rules, 113), { from: 1300, to: 1400 }, 'Bilaspur');
  assert.deepEqual(dayRateFor(rules, 150), { from: 1300, to: 1400 }, 'up to and including 150 km');
  assert.deepEqual(dayRateFor(rules, 151), { from: 1450, to: 1550 });
  assert.deepEqual(dayRateFor(rules, 284), { from: 1450, to: 1550 }, 'Nagpur');
  assert.deepEqual(dayRateFor(rules, 301), { from: 1550, to: 1650 });
  assert.deepEqual(dayRateFor(rules, 0), { from: 1550, to: 1650 }, 'a place not in the list: the long-trip price (quoted on the call)');
  assert.deepEqual(dayRateFor({ dayRate: rules.dayRate }, 113), { from: 1550, to: 1650 }, 'no tiers: one price everywhere');

  // Round trips: the days at the price for the distance.
  assert.deepEqual(price(trip('bilaspur', 'round')), [1300, 1400]);
  assert.deepEqual(price(trip('rajnandgaon', 'round')), [1300, 1400]);
  assert.deepEqual(price(trip('korba', 'round')), [1450, 1550]);
  assert.deepEqual(price(trip('nagpur', 'round')), [1450, 1550]);
  assert.deepEqual(price(trip('bilaspur', 'round', 3)), [3900, 4200], '3 days at Bilaspur');
  assert.deepEqual(price(trip('jabalpur', 'round')), [3100, 3300], 'farther than 300 km: the full price');
  // From Bilaspur, Raipur itself is close by.
  assert.deepEqual(dayRateFor(rules, roadKm('Bilaspur', findDestination('raipur'))), { from: 1300, to: 1400 });
  // One-way: a short drop stays by the hour; long drops are farther than every tier.
  assert.deepEqual(price(trip('bilaspur')), [720, 720]);
  assert.deepEqual(price(trip('mumbai')), [4300, 4500]);
});

test('quote: "above what customers were shown" uses the price for the distance', () => {
  const base = { driverDayCost: 1150, driverReturnHourPay: 100, days: 1, returnHours: 0, extraHours: 0, ticket: 0, partnerPercent: 0, minProfitPercent: 15 };
  const q = quote(rules, { ...base, km: 113 });
  assert.equal(q.dayRate, 1400); // 1150 / 0.85 = 1352.9 → ₹1,400
  assert.equal(q.aboveShownRange, false, 'Bilaspur was shown ₹1,300–1,400');
  assert.equal(quote(rules, { ...base, driverDayCost: 1200, km: 113 }).aboveShownRange, true, '₹1,450 > ₹1,400');
  assert.equal(quote(rules, { ...base, driverDayCost: 1200, km: 400 }).aboveShownRange, false, 'a long trip was shown ₹1,550–1,650');
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
  // 11 driving hours typed: more than 7, so one more full day.
  assert.equal(q.days, 2);
  assert.equal(q.charges, 2 * 1200 + 1200);
  assert.equal(quote(rules, { ...base, extraHours: 7, driverDayCost: 1000 }).charges, 1200 + 7 * 120 + 1200, 'up to 7 h: by the hour');
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
  assert.equal('trains' in blr, false, 'no train list for the app either');
  assert.deepEqual(blr.rail, { stations: ['SMVB', 'SBC', 'YPR'], hubs: ['NGP'] });
  assert.ok(Math.abs(blr.from.Raipur.oneWay.driveHours - 1370 / rules.averageKmh) < 0.001);
});

/* ------------------------------------------------- the profit guard ---- */

test('site-settings.ts passes its own checks', () => {
  assert.doesNotThrow(() => checkSettings(settings));
});

test('the nearby day prices are checked: nearest first, never dearer than farther ones or the long-trip price', () => {
  const near = (outstationNear) => ({ ...settings, prices: { ...settings.prices, outstationNear } });
  assert.doesNotThrow(() => checkSettings(near([])), 'no tiers: one price everywhere');
  assert.throws(() => checkSettings(near([{ upToKm: 300, from: 1450, to: 1550 }, { upToKm: 150, from: 1300, to: 1400 }])), /must be farther than the tier before/);
  assert.throws(() => checkSettings(near([{ upToKm: 150, from: 1500, to: 1600 }, { upToKm: 300, from: 1450, to: 1550 }])), /must not be cheaper than the nearer tier/);
  assert.throws(() => checkSettings(near([{ upToKm: 150, from: 1600, to: 1700 }])), /must not cost more than prices\.outstation/);
  assert.throws(() => checkSettings(near([{ upToKm: 150, from: 1400, to: 1300 }])), /is bigger than/);
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
  // The nearby days pay the same driver: a cost the long-trip price covers can still be too much for them.
  assert.throws(
    () => checkSettings(settings, 'outstation=1200-1300'),
    (err) => {
      assert.match(err.message, /prices\.outstationNear\[1\]\.from/);
      assert.doesNotMatch(err.message, /prices\.outstation\.from/);
      return true;
    },
  );
  assert.throws(() => checkSettings(settings, 'outstation 1000'), /part 1 cannot be read/);
  assert.throws(() => checkSettings(settings, 'outstationNear=100'), /not one of the prices/);
  assert.throws(() => checkSettings(settings, 'taxi=100'), /"taxi", which is not one of the prices/);
});

/* ------------------------------------------------------ the final bill -- */

const GRACE = settings.outstation.graceMinutes;
/** India time → epoch ms. */
const ist = (s) => Date.parse(`${s}:00+05:30`);
const bill = (over) =>
  finalBill(rules, {
    kind: 'one-way',
    nonstop: false,
    dayRate: 1600,
    extraHourRate: 120,
    returnHourRate: 120,
    ticket: 0,
    graceMinutes: GRACE,
    ...over,
  });

test('final bill: the first 15 minutes of an hour are free', () => {
  assert.equal(GRACE, 15);
  assert.equal(chargeHours(0, 15), 0);
  assert.equal(chargeHours(15, 15), 0);
  assert.equal(chargeHours(16, 15), 1);
  assert.equal(chargeHours(4 * 60 + 15, 15), 4);
  assert.equal(chargeHours(4 * 60 + 16, 15), 5);
  assert.equal(chargeHours(-30, 15), 0);
  assert.equal(chargeHours(NaN, 15), 0);
});

test('final bill: days from the clock — 24 h with a night rest, or 12 h day and night', () => {
  const h = (hours, min = 0) => hours * 60 + min;
  // Day and night: every 12 h a day.
  assert.deepEqual(billDays(rules, h(28, 55), true, GRACE), { days: 2, hours: 5 });
  assert.deepEqual(billDays(rules, h(27, 25), true, GRACE), { days: 2, hours: 4 });
  assert.deepEqual(billDays(rules, h(11, 10), true, GRACE), { days: 1, hours: 0 }, '11 h > 7: a full day');
  assert.deepEqual(billDays(rules, h(7), true, GRACE), { days: 0, hours: 7 }, 'up to 7 h: by the hour');
  // With the night's rest: 24 h = a day, then 12 h driving = a day, the rest by the hour.
  assert.deepEqual(billDays(rules, h(6, 5), false, GRACE), { days: 0, hours: 6 }); // Nagpur, a short drive
  assert.deepEqual(billDays(rules, h(12), false, GRACE), { days: 1, hours: 0 });
  assert.deepEqual(billDays(rules, h(37, 10), false, GRACE), { days: 2, hours: 1 }); // Delhi, Mon 6:00 → Tue 19:10
  assert.deepEqual(billDays(rules, h(51, 25), false, GRACE), { days: 2, hours: 4 }); // Bengaluru with two nights
  assert.deepEqual(billDays(rules, h(48), false, GRACE), { days: 2, hours: 0 });
});

test('final bill: Raipur → Bengaluru day and night, the example shown to the owner', () => {
  const real = bill({
    nonstop: true,
    startAt: ist('2026-10-29T07:45'),
    dropAt: ist('2026-10-30T12:40'), // 28 h 55 m
    homeAt: ist('2026-11-01T02:20'), // 37 h 40 m after the drop
  });
  assert.equal(real.driveMinutes, 28 * 60 + 55);
  assert.equal(real.returnMinutes, 37 * 60 + 40);
  assert.deepEqual(
    [real.days, real.extraHours, real.extraCharge, real.returnHours, real.returnCharge, real.amount],
    [2, 5, 600, 38, 2400, 6200],
  );
  // The estimate's times (start 7:30, drop ~10:55, home ~00:05 Sun) give ₹6,080 at ₹1,600 a day.
  const est = bill({
    nonstop: true,
    startAt: ist('2026-10-29T07:30'),
    dropAt: ist('2026-10-30T10:55'),
    homeAt: ist('2026-11-01T00:05'),
  });
  assert.deepEqual([est.days, est.extraHours, est.returnHours, est.amount], [2, 4, 37, 6080]); // 37 h 10 m: 10 minutes free
});

test('final bill: a short one-way drop is all by the hour', () => {
  const b = bill({ startAt: ist('2026-11-02T07:00'), dropAt: ist('2026-11-02T13:20'), homeAt: ist('2026-11-02T20:10') });
  // 7 h home: more than 6 h counts as a full day (₹1,200).
  assert.deepEqual([b.days, b.extraHours, b.extraCharge, b.returnHours, b.returnCharge, b.amount], [0, 7, 840, 7, 1200, 2040]);
});

test('final bill: round trips — 24 h a day plus hours, at least one day', () => {
  const round = (start, back, nonstop = false) =>
    bill({ kind: 'round', nonstop, startAt: ist(start), homeAt: ist(back) });
  // Back after 2 days 5 h: 2 days + 5 h.
  let b = round('2026-11-02T06:00', '2026-11-04T11:00');
  assert.deepEqual([b.days, b.extraHours, b.returnHours, b.returnCharge, b.amount], [2, 5, 0, 0, 2 * 1600 + 600]);
  // Same-day trip of 8 h: still one day.
  b = round('2026-11-02T08:00', '2026-11-02T16:00');
  assert.deepEqual([b.days, b.extraHours, b.amount], [1, 0, 1600]);
  // 16 h out: one day + 4 h.
  b = round('2026-11-02T06:00', '2026-11-02T22:00');
  assert.deepEqual([b.days, b.extraHours, b.amount], [1, 4, 1600 + 480]);
  // Day and night: every 12 h a day.
  b = round('2026-11-02T06:00', '2026-11-03T13:30', true); // 31 h 30 m = 2 days + 8 h, and 8 > 7
  assert.deepEqual([b.days, b.extraHours, b.amount], [3, 0, 3 * 1600]);
});

test('final bill: extra hours never cost more than a day; the ticket is passed on', () => {
  const b = bill({ extraHourRate: 200, ticket: 650, startAt: ist('2026-11-02T07:00'), dropAt: ist('2026-11-02T18:40'), homeAt: ist('2026-11-02T18:40') });
  // 11 h 40 m → 12 h, more than 7: a full day, never the hours.
  assert.deepEqual([b.days, b.extraHours, b.extraCharge], [1, 0, 0]);
  assert.equal(b.amount, 1600 + 650);
});

test('final bill: matches the estimate when the trip goes exactly to plan', () => {
  for (const id of ['nagpur', 'jabalpur', 'hyderabad', 'bengaluru', 'delhi', 'mumbai', 'kolkata']) {
    const dest = findDestination(id);
    for (const nonstop of [false, true]) {
      const plan = planTrip(rules, roadKm('Raipur', dest), 'one-way', 0, homeWay(dest, 'Raipur'), { hour: 7, weekday: 1 }, nonstop);
      const start = ist('2026-11-02T07:00'); // a Monday
      const at = (h) => start + Math.round(h * 60) * 60000;
      const real = bill({ nonstop, dayRate: rules.dayRate.from, startAt: start, dropAt: at(plan.dropAt), homeAt: at(plan.homeAt) });
      const est = estimate({ ...rules, dayRate: { from: rules.dayRate.from, to: rules.dayRate.from } }, plan);
      // The estimate rounds every started hour up; the bill forgives 15 minutes — never dearer.
      assert.ok(real.amount <= est.from, `${id}${nonstop ? ' non-stop' : ''}: bill ${real.amount} > estimate ${est.from}`);
      assert.ok(est.from - real.amount <= 2 * rules.extraHour, `${id}${nonstop ? ' non-stop' : ''}: bill ${real.amount} far below ${est.from}`);
      assert.equal(real.days, plan.fullDays, `${id}${nonstop ? ' non-stop' : ''}: days`);
    }
  }
});

test('the way home: each 24 h a day (₹1,200); up to 6 h left over by the hour, more = a full day (decided 29 Oct 2026)', () => {
  const after = settings.outstation.returnFullDayAfterHours;
  assert.equal(after, 6);
  const c = (h) => returnCost(h, 120, 1200, after);
  assert.deepEqual([0, 5, 6, 7, 8, 24, 30, 31, 32, 48, 54, 56].map(c), [0, 600, 720, 1200, 1200, 1200, 1920, 2400, 2400, 2400, 3120, 3600]);
  // The owner's example: 56 h = 2 days + 8 h = 3 days.
  assert.equal(c(56), 3 * 1200);
  // The driver's pay follows the same rule at his rate.
  assert.equal(returnCost(56, 100, 1000, after), 3000);
  assert.equal(returnCost(30, 100, 1000, after), 1000 + 600);
});
