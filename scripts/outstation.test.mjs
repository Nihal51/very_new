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
  homeWay,
  pickupCities,
  planTrip,
  quote,
  returnCost,
  returnDayCost,
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
/** A trip from Raipur as the booking form plans it: with the real trains home, leaving at `start` (7 AM). */
const trip = (id, kind = 'one-way', days = 0, start = 7) =>
  planTrip(rules, fromRaipur(id), kind, days, homeWay(findDestination(id), 'Raipur'), start);

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
/* Agreed with the owner, 28 Oct 2026: 600 km a day; a driving day is a
   driving day and the trip home is its own day; the start time decides the
   train. Prices at ₹1,550–1,650 a day, ₹1,200 return day, ₹120 a late hour. */

test('Raipur → Nagpur one-way: home the same evening, so one day is all', () => {
  const plan = trip('nagpur');
  assert.deepEqual([plan.days, plan.returnHours, plan.returnDay, plan.local], [1, 0, false, false]);
  const e = estimate(rules, plan);
  assert.deepEqual([e.from, e.to, e.returnCharge], [lo, hi, 0]);
  assert.deepEqual([e.from, e.to], [1550, 1650]);
});

test('Raigarh and Jagdalpur one-way: one day, home the same day', () => {
  for (const id of ['raigarh', 'jagdalpur']) {
    const e = estimate(rules, trip(id));
    assert.deepEqual([e.from, e.to], [1550, 1650], id);
  }
});

test('Raipur → Mumbai one-way: 2 driving days + 1 return day = ₹4,300–4,500 (the owner: "2 days to reach, 1 day to reach home")', () => {
  const plan = trip('mumbai');
  assert.equal(plan.days, 2);
  // Drops the car on day 2 in the evening, takes the 9:10 PM Mumbai–Howrah Mail.
  assert.equal(plan.train.no, '12809');
  assert.ok(plan.returnDay && plan.returnHours > 0 && plan.returnHours <= 24, `${plan.returnHours} h`);
  assert.equal(plan.lateHours, 0);
  const e = estimate(rules, plan);
  assert.deepEqual([e.returnDayCharge, e.lateCharge], [1200, 0]);
  assert.deepEqual([e.from, e.to], [4300, 4500]);
});

test('Raipur → Delhi one-way: 2 days (1,214 km at 600 a day) + the return day', () => {
  const plan = trip('delhi');
  assert.deepEqual([plan.minDays, plan.days, plan.returnDay, plan.lateHours], [2, 2, true, 0]);
  assert.deepEqual([estimate(rules, plan).from, estimate(rules, plan).to], [4300, 4500]);
});

test('Raipur → Hyderabad: the start time picks the train — a 12-hour wait for the night train means a return day', () => {
  // 600 km on day 1, 180 km on day 2: drops ~10:30 AM, the train home leaves at 10:40 PM.
  const at9 = trip('hyderabad', 'one-way', 0, 9);
  assert.equal(at9.days, 2);
  assert.equal(at9.train.no, '12771');
  assert.ok(at9.leaveAt - at9.dropAt > 9, 'he waits for the night train');
  assert.ok(at9.returnDay);
  assert.deepEqual([estimate(rules, at9).from, estimate(rules, at9).to], [4300, 4500]);
});

test('Raipur → Kolkata: drops before noon on day 2, the afternoon Gitanjali gets him home before day 2 ends', () => {
  const plan = trip('kolkata');
  assert.equal(plan.train.no, '12860');
  assert.deepEqual([plan.days, plan.returnHours], [2, 0]);
  assert.equal(estimate(rules, plan).from, 2 * lo);
});

test('the first train he can catch is at least stationHours after the drop, and the one home soonest wins', () => {
  for (const d of destinations) {
    if (!d.home.trains) continue;
    for (const start of [0, 5, 7, 9.5, 13, 18, 23]) {
      const plan = trip(d.id, 'one-way', 0, start);
      assert.ok(plan.leaveAt >= plan.dropAt + rules.stationHours - 1e-9, `${d.id} @${start}`);
      assert.ok(plan.leaveAt - plan.dropAt <= 24 + rules.stationHours, `${d.id} @${start}: waits at most a day`);
      // The departure is really at that train's time of day.
      const [h, m] = plan.train.dep.split(':').map(Number);
      const clock = (((start + plan.leaveAt) % 24) + 24) % 24;
      assert.ok(Math.abs(clock - (h + m / 60)) < 1e-6, `${d.id} @${start}: leaves at ${clock}`);
    }
  }
});

test('every regular train is sensible: HH:MM, and hours close to the route\'s average', () => {
  for (const d of destinations)
    for (const t of d.home.trains ?? []) {
      assert.match(t.dep, /^([01]\d|2[0-3]):[0-5]\d$/, `${d.id} ${t.no}`);
      assert.match(t.no, /^\d{5}$/, `${d.id} ${t.no}`);
      assert.ok(t.hours > 0 && Math.abs(t.hours - d.home.raipur) <= 8, `${d.id} ${t.no}: ${t.hours} h`);
    }
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
  const raipur = planTrip(rules, 831, 'one-way', 0, homeWay(kolkata, 'Raipur'));
  const bilaspur = planTrip(rules, 831, 'one-way', 0, homeWay(kolkata, 'Bilaspur'));
  assert.ok(Math.abs(raipur.homeAt - bilaspur.homeAt - 2) < 1e-9);
  // Every place has a time home, and none is silly.
  for (const d of destinations) {
    for (const c of pickupCities) {
      const h = homeTravelHours(d, c);
      assert.ok(Number.isFinite(h) && h >= 0 && h <= 40, `${d.id} → ${c}: ${h}`);
    }
  }
  // Without a timetable (a place typed in), the distance at busKmh is the fallback.
  const typed = planTrip(rules, 1214, 'one-way');
  assert.ok(Math.abs(typed.homeAt - (typed.dropAt + rules.stationHours + 1214 / rules.busKmh)) < 1e-9);
});

test('the return day and late hours, as the owner explained', () => {
  // Home in time: nothing. Any hours after the driving days: the ₹1,200 return day.
  assert.equal(returnDayCost(0, 120, 1200), 0);
  assert.equal(returnDayCost(2, 120, 1200), 1200);
  assert.equal(returnDayCost(24, 120, 1200), 1200);
  // Still travelling after the return day: ₹120 a late hour, at most ₹1,200 in any 24 hours.
  assert.equal(returnDayCost(30, 120, 1200), 1200 + 6 * 120, 'his example: home 6 h after the return day');
  assert.equal(returnDayCost(24 + 14, 120, 1200), 2400);
  assert.equal(returnDayCost(Number.NaN, 120, 1200), 0);
  // The hourly cost with its daily maximum, used for the late hours.
  assert.equal(returnCost(4, 120, 1200), 480);
  assert.equal(returnCost(14, 120, 1200), 1200);
  assert.equal(returnCost(30, 120, 1200), 1200 + 6 * 120);
  const e = estimate(rules, { days: 2, returnHours: 30 });
  assert.deepEqual([e.returnDayCharge, e.lateCharge, e.from], [1200, 720, 2 * lo + 1920]);
});

test('a little over a full day of driving does not add a day', () => {
  assert.equal(planTrip(rules, fromRaipur('delhi'), 'one-way').days, 2, 'Delhi, 1,214 km');
  assert.equal(planTrip(rules, 1260, 'one-way').days, 2);
  assert.equal(planTrip(rules, 1270, 'one-way').days, 3);
  assert.equal(planTrip(rules, 660, 'one-way').days, 1);
  assert.equal(planTrip(rules, 670, 'one-way').days, 2);
});

test('the customer books more days (resting, sightseeing): every day is charged, he drops the car on the last one', () => {
  const two = trip('delhi');
  const four = trip('delhi', 'one-way', 4);
  assert.deepEqual([four.minDays, four.days], [2, 4]);
  assert.ok(Math.abs(four.dropAt - two.dropAt - 48) < 1e-9);
  assert.equal(four.returnHours, two.returnHours);
  assert.equal(estimate(rules, four).from, 4 * lo + 1200);
  // Fewer days than the distance allows are not possible.
  assert.equal(planTrip(rules, 1200, 'one-way', 1).days, 2);
  // A typo like 500 days is capped.
  assert.equal(planTrip(rules, 300, 'one-way', 500).days, 60);
});

test('a round trip back home within the 24 hours is ONE day, like a one-way drop', () => {
  // Raipur → Jharsuguda → Raipur: 640 km — out in the morning, home that night.
  const jharsuguda = trip('jharsuguda', 'round');
  assert.deepEqual([jharsuguda.days, jharsuguda.returnHours], [1, 0]);
  assert.deepEqual([estimate(rules, jharsuguda).from, estimate(rules, jharsuguda).to], [1550, 1650]);
  assert.equal(trip('nagpur', 'round').days, 1);
  // Too far to be back the same day: the distance twice, with a night away.
  assert.equal(trip('jabalpur', 'round').days, 2, '766 km');
  assert.equal(trip('bhopal', 'round').days, 2);
  assert.equal(trip('mumbai', 'round').days, 4);
  assert.equal(trip('delhi', 'round').days, 4);
  assert.equal(trip('delhi', 'round').returnHours, 0);
  assert.equal(trip('delhi', 'round').returnDay, false);
  // Booking more days is still allowed.
  assert.equal(trip('jharsuguda', 'round', 2).days, 2);
});

test('closer than localWithinKm is flagged as a local trip', () => {
  assert.equal(planTrip(rules, fromRaipur('bhilai'), 'one-way').local, true);
  assert.equal(planTrip(rules, fromRaipur('rajnandgaon'), 'one-way').local, false);
});

test('a strange start time falls back to 7 AM; 31 is 7 AM the next day', () => {
  assert.equal(planTrip(rules, 300, 'one-way', 0, {}, Number.NaN).startHour, 7);
  assert.equal(planTrip(rules, 300, 'one-way', 0, {}, 31).startHour, 7);
});

/* ------------------------------------------------------- the quote ---- */
/* Driver costs here are made-up round numbers (the repository is public). */

const base = { driverReturnHourPay: 90, days: 2, returnHours: 11, extraHours: 0, ticket: 0, partnerPercent: 0, minProfitPercent: 15 };

test('quote: driver cost + 15%, rounded up to ₹50 a day; the return day at 10 late-hours\' worth', () => {
  const q = quote(rules, { ...base, driverDayCost: 1000 });
  assert.equal(q.dayRate, 1200); // 1000 / 0.85 = 1176.5 → 1200
  assert.equal(q.returnHourRate, 120); // 90 / 0.85 = 105.9 → 110, never below the shown 120
  assert.equal(q.returnCharge, 1200); // the return day
  assert.equal(q.charges, 2 * 1200 + 1200);
  assert.equal(q.driverPay, 2 * 1000 + 900); // his return day is 10 of his late hours
  assert.equal(q.profit, q.charges - q.driverPay);
  assert.ok(q.profitPercent >= 15 && q.ok);
  assert.equal(q.aboveShownRange, false);

  const dearer = quote(rules, { ...base, driverDayCost: 1250 });
  assert.equal(dearer.dayRate, 1500); // 1250 / 0.85 = 1470.6 → 1500
});

test('quote: late hours after the return day — the owner\'s example, 6 hours late', () => {
  const q = quote(rules, { ...base, driverDayCost: 1000, returnHours: 30 });
  assert.equal(q.returnCharge, 1200 + 6 * 120);
  assert.equal(q.driverPay, 2 * 1000 + 900 + 6 * 90);
});

test('quote: home in time, no return charge', () => {
  const q = quote(rules, { ...base, driverDayCost: 1000, days: 1, returnHours: 0 });
  assert.deepEqual([q.returnCharge, q.charges], [0, 1200]);
});

test('quote: a ticket we bought is passed through with no profit on it', () => {
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
  assert.equal(q.charges, 2 * 1200 + 1200 + 3 * q.extraHourRate);
});

test('quote: a dearer driver for the return raises the rate, never below the shown ₹120', () => {
  const low = quote(rules, { ...base, driverDayCost: 1000, driverReturnHourPay: 60 });
  assert.equal(low.returnHourRate, rules.returnHour);
  const dearer = quote(rules, { ...base, driverDayCost: 1000, driverReturnHourPay: 120 });
  assert.equal(dearer.returnHourRate, 150); // 120 / 0.85 = 141 → 150
  assert.equal(dearer.returnCharge, 1500); // the return day is still 10 hours' worth
  assert.equal(dearer.aboveShownRange, true);
  assert.ok(dearer.ok, `profit ${dearer.profitPercent}%`);
});

test('quote: the minimum profit always holds', () => {
  for (const cost of [900, 1000, 1200, 1300, 1400, 1550])
    for (const pay of [60, 100, 120, 150])
      for (const back of [0, 4, 11, 30, 50])
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
  assert.deepEqual(delhi.from.Raipur, { km: 1214, oneWay: { days: 2, returnHours: trip('delhi').returnHours }, roundDays: 4 });
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
