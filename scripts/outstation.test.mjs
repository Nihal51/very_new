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
  pickupCities,
  planTrip,
  quote,
  returnCost,
  returnHours,
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
/** A trip from Raipur as the booking form plans it: with the real train/bus time home. */
const trip = (id, kind = 'one-way', days = 0) =>
  planTrip(rules, fromRaipur(id), kind, days, homeTravelHours(findDestination(id), 'Raipur'));

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

test('Raipur → Nagpur one-way: the driver is home the same day, so one day is all', () => {
  // Start 6 AM, drop ~12:30 PM, 1 h to the station, ~5 h by train: inside the 24 hours paid for.
  const plan = trip('nagpur');
  assert.deepEqual([plan.days, plan.returnHours, plan.local], [1, 0, false]);
  const e = estimate(rules, plan);
  assert.deepEqual([e.from, e.to, e.returnCharge], [lo, hi, 0]);
  assert.deepEqual([e.from, e.to], [1450, 1650]);
});

test('Raipur → Bhopal one-way: 2 days, home before they end', () => {
  const plan = trip('bhopal');
  assert.deepEqual([plan.days, plan.returnHours], [2, 0]);
});

test('Raipur → Delhi one-way: 3 days + the hours he is still on the train', () => {
  // Last day ~9 h of driving, 1 h to the station, ~22½ h by train: ~9 h after the 72 paid hours.
  const plan = trip('delhi');
  assert.deepEqual([plan.minDays, plan.days, plan.returnHours], [3, 3, 9]);
  const e = estimate(rules, plan);
  assert.equal(e.returnCharge, 9 * 120);
  assert.deepEqual([e.from, e.to], [3 * lo + 1080, 3 * hi + 1080]);
  assert.deepEqual([e.from, e.to], [5430, 6030]);
});

test('Raipur → Mumbai one-way: ~18 h by train, 3 hours after the last day, ₹360', () => {
  const plan = trip('mumbai');
  assert.deepEqual([plan.days, plan.returnHours], [3, 3]);
  assert.equal(estimate(rules, plan).returnCharge, 3 * 120);
});

test('the train/bus time home comes from the timetables, per pickup city', () => {
  const delhi = findDestination('delhi');
  assert.deepEqual(
    pickupCities.map((c) => homeTravelHours(delhi, c)),
    [delhi.home.raipur, delhi.home.durg, delhi.home.durg, delhi.home.bilaspur],
    'Bhilai uses the Durg times',
  );
  // Kolkata trains reach Bilaspur ~2 h before Raipur: a Bilaspur driver is home sooner.
  const kolkata = findDestination('kolkata');
  assert.ok(homeTravelHours(kolkata, 'Bilaspur') < homeTravelHours(kolkata, 'Raipur'));
  // Every place has a time home, and none is silly.
  for (const d of destinations) {
    for (const c of pickupCities) {
      const h = homeTravelHours(d, c);
      assert.ok(Number.isFinite(h) && h >= 0 && h <= 40, `${d.id} → ${c}: ${h}`);
    }
  }
  // Without a timetable (a place typed in), the distance at busKmh is the fallback.
  assert.equal(returnHours(rules, 1214), planTrip(rules, 1214, 'one-way').returnHours);
});

test('a ~20 h train home from Lucknow costs more than a ~13 h one from Kolkata, though Kolkata is further', () => {
  assert.ok(fromRaipur('kolkata') > fromRaipur('lucknow'));
  assert.ok(trip('lucknow').returnHours > trip('kolkata').returnHours);
  assert.equal(trip('kolkata').returnHours, 0);
});

test('the return hours are measured from the end of the paid days, as the owner explained', () => {
  // "Starts at 6 AM, home by 6 AM next day: no charge. Home at 10 AM: 4 hours."
  assert.equal(returnCost(0, 120, 1200), 0);
  assert.equal(returnCost(4, 120, 1200), 480);
  assert.equal(returnCost(10, 120, 1200), 1200);
  assert.equal(returnCost(14, 120, 1200), 1200, 'at most ₹1,200 in any 24 hours');
  assert.equal(returnCost(30, 120, 1200), 1200 + 6 * 120, 'a second day starts a new maximum');
  assert.equal(returnHours(rules, 0), 0);
  assert.equal(returnHours(rules, 440), 0, 'a full day of driving still gets him home in the day');
});

test('a little over a full day of driving does not add a day', () => {
  assert.equal(planTrip(rules, fromRaipur('delhi'), 'one-way').days, 3, 'Delhi, 1,214 km');
  assert.equal(planTrip(rules, 1240, 'one-way').days, 3);
  assert.equal(planTrip(rules, 1250, 'one-way').days, 4);
  assert.equal(planTrip(rules, 440, 'one-way').days, 1);
  assert.equal(planTrip(rules, 450, 'one-way').days, 2);
});

test('the customer books more days (resting, sightseeing): every day is charged, the return hours stay the same', () => {
  const plan = trip('delhi', 'one-way', 5);
  assert.deepEqual([plan.minDays, plan.days, plan.returnHours], [3, 5, 9]);
  assert.equal(estimate(rules, plan).from, 5 * lo + 1080);
  // Fewer days than the distance allows are not possible.
  assert.equal(planTrip(rules, 1200, 'one-way', 1).days, 3);
  // A typo like 500 days is capped.
  assert.equal(planTrip(rules, 300, 'one-way', 500).days, 60);
});

test('a round trip back home within the 24 hours is ONE day, like a one-way drop', () => {
  // Raipur → Jharsuguda → Raipur: 640 km, ~14 h of driving — out at 6 AM, home that night.
  const jharsuguda = trip('jharsuguda', 'round');
  assert.deepEqual([jharsuguda.days, jharsuguda.returnHours], [1, 0]);
  assert.deepEqual([estimate(rules, jharsuguda).from, estimate(rules, jharsuguda).to], [1450, 1650]);
  assert.equal(trip('nagpur', 'round').days, 1);
  // Too far to be back the same day: the distance twice, with a night away.
  assert.equal(trip('jabalpur', 'round').days, 2, '766 km, ~17 h of driving');
  assert.equal(trip('bhopal', 'round').days, 4);
  assert.equal(trip('delhi', 'round').days, 6);
  assert.equal(trip('delhi', 'round').returnHours, 0);
  // Booking more days is still allowed.
  assert.equal(trip('jharsuguda', 'round', 2).days, 2);
});

test('closer than localWithinKm is flagged as a local trip', () => {
  assert.equal(planTrip(rules, fromRaipur('bhilai'), 'one-way').local, true);
  assert.equal(planTrip(rules, fromRaipur('rajnandgaon'), 'one-way').local, false);
});

/* ------------------------------------------------------- the quote ---- */

const base = { driverReturnHourPay: 100, days: 3, returnHours: 11, extraHours: 0, ticket: 0, partnerPercent: 0, minProfitPercent: 15 };

test('quote: driver cost + 15%, rounded up to ₹50 a day; return hours at ₹120, at most ₹1,200 a day', () => {
  const q = quote(rules, { ...base, driverDayCost: 1000 });
  assert.equal(q.dayRate, 1200); // 1000 / 0.85 = 1176.5 → 1200
  assert.equal(q.returnHourRate, 120); // 100 / 0.85 = 117.6 → 120
  assert.equal(q.returnCharge, 1200); // 11 h, capped at 10 h a day
  assert.equal(q.charges, 3 * 1200 + 1200);
  assert.equal(q.driverPay, 3 * 1000 + 1000); // the driver's ₹100/h is capped the same way
  assert.equal(q.profit, q.charges - q.driverPay);
  assert.ok(q.profitPercent >= 15 && q.ok);
  assert.equal(q.aboveShownRange, false);

  const dearer = quote(rules, { ...base, driverDayCost: 1250 });
  assert.equal(dearer.dayRate, 1500); // 1250 / 0.85 = 1470.6 → 1500
});

test('quote: no return hours, no return charge', () => {
  const q = quote(rules, { ...base, driverDayCost: 1000, days: 1, returnHours: 0 });
  assert.deepEqual([q.returnCharge, q.charges], [0, 1200]);
});

test('quote: the ticket is passed through with no profit on it', () => {
  const without = quote(rules, { ...base, driverDayCost: 1000 });
  const withTicket = quote(rules, { ...base, driverDayCost: 1000, ticket: 650 });
  assert.equal(withTicket.total, without.total + 650);
  assert.equal(withTicket.profit, without.profit);
});

test('quote: a partner commission is priced in, so the profit still holds', () => {
  const q = quote(rules, { ...base, driverDayCost: 1000, days: 1, returnHours: 0, partnerPercent: 10 });
  assert.equal(q.dayRate, 1350); // 1000 / 0.75 = 1333 → 1350
  assert.equal(q.partnerPay, 135);
  assert.ok(q.ok, `profit ${q.profitPercent}%`);
});

test('quote: overtime at the published rate or the cost-based rate, whichever is higher', () => {
  const q = quote(rules, { ...base, driverDayCost: 1000, extraHours: 3 });
  assert.equal(q.extraHourRate, Math.max(rules.extraHour, 100));
  assert.equal(q.charges, 3 * 1200 + 1200 + 3 * q.extraHourRate);
});

test('quote: a dearer driver for the return raises the hourly rate, never below the shown ₹120', () => {
  const low = quote(rules, { ...base, driverDayCost: 1000, driverReturnHourPay: 60 });
  assert.equal(low.returnHourRate, rules.returnHour);
  const dearer = quote(rules, { ...base, driverDayCost: 1000, driverReturnHourPay: 120 });
  assert.equal(dearer.returnHourRate, 150); // 120 / 0.85 = 141 → 150
  assert.equal(dearer.returnCharge, 1500); // the same 10-hour daily maximum
  assert.equal(dearer.aboveShownRange, true);
  assert.ok(dearer.ok, `profit ${dearer.profitPercent}%`);
});

test('quote: the minimum profit always holds', () => {
  for (const cost of [900, 1000, 1200, 1300, 1400, 1550])
    for (const pay of [60, 100, 120, 150])
      for (const back of [0, 4, 11, 30])
        for (const partnerPercent of [0, 10]) {
          const q = quote(rules, { ...base, driverDayCost: cost, driverReturnHourPay: pay, returnHours: back, extraHours: 3, partnerPercent });
          assert.ok(q.ok, `cost ${cost}, return pay ${pay}, ${back} h, partner ${partnerPercent}%: ${q.profitPercent}%`);
        }
  assert.equal(quote(rules, { ...base, driverDayCost: 1500 }).aboveShownRange, true);
});

test('quote: nonsense input never produces NaN', () => {
  const q = quote(rules, { ...base, driverDayCost: Number.NaN, days: -2, extraHours: -1, ticket: Number.NaN, returnHours: Number.NaN });
  for (const v of Object.values(q)) if (typeof v === 'number') assert.ok(Number.isFinite(v));
});

/* ------------------------------------------------- the app's table ---- */

test('the app table has every destination from every pickup city', () => {
  const table = destinationTable(rules);
  assert.equal(table.length, destinations.length);
  for (const row of table) {
    for (const city of pickupCities) {
      const t = row.from[city];
      assert.ok(t && t.km >= 0 && t.oneWay.days >= 1 && t.roundDays >= t.oneWay.days, `${city} → ${row.id}`);
    }
  }
  const nagpur = table.find((r) => r.id === 'nagpur');
  assert.deepEqual(nagpur.from.Raipur, { km: 284, oneWay: { days: 1, returnHours: 0 }, roundDays: 1 });
  const delhi = table.find((r) => r.id === 'delhi');
  assert.deepEqual(delhi.from.Raipur, { km: 1214, oneWay: { days: 3, returnHours: 9 }, roundDays: 6 });
  // The table uses the timetable for each pickup city, as the booking form does.
  assert.equal(delhi.from.Bilaspur.oneWay.returnHours, trip('delhi').returnHours - 3);
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
    () => checkSettings(settings, 'outstation=1300-1530'),
    (err) => {
      assert.match(err.message, /prices\.outstation\.from/);
      assert.match(err.message, /prices\.outstation\.to/);
      assert.doesNotMatch(err.message, /1300|1530/, 'the public build log must not show costs');
      return true;
    },
  );
  assert.throws(() => checkSettings(settings, 'outstation 1000'), /part 1 cannot be read/);
  assert.throws(() => checkSettings(settings, 'taxi=100'), /"taxi", which is not one of the prices/);
});
