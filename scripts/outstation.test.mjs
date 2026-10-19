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
  pickupCities,
  planTrip,
  quote,
  returnDays,
  roadKm,
} from '../lib/outstation.ts';
import { checkSettings } from '../lib/settings-schema.ts';
import { settings } from '../site-settings.ts';

/** The same mapping as tripRules in lib/settings.ts (which uses the @/ alias Node cannot read). */
const rules = {
  dayRate: { ...settings.prices.outstation },
  returnDay: { ...settings.outstation.returnDay },
  extraHour: settings.outstation.extraHour,
  hoursPerDay: settings.outstation.hoursPerDay,
  kmPerDay: settings.outstation.kmPerDay,
  averageKmh: settings.outstation.averageKmh,
  returnKmPerDay: settings.outstation.returnKmPerDay,
  localWithinKm: settings.outstation.localWithinKm,
};
const { from: lo, to: hi } = rules.dayRate;
const back = rules.returnDay; // a range: the driver on a bus/train home, not driving

const fromRaipur = (id) => roadKm('Raipur', findDestination(id));

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

test('Raipur → Nagpur one-way: 1 driving day + 1 day home by bus/train', () => {
  const plan = planTrip(rules, fromRaipur('nagpur'), 'one-way');
  assert.deepEqual([plan.days, plan.returnDays, plan.local], [1, 1, false]);
  const e = estimate(rules, plan);
  assert.deepEqual([e.from, e.to], [lo + back.from, hi + back.to]);
  assert.deepEqual([e.from, e.to], [2450, 2850], '₹1,450–1,650 + ₹1,000–1,200');
});

test('Raipur → Bilaspur one-way: back the same day, no return charge', () => {
  const plan = planTrip(rules, fromRaipur('bilaspur'), 'one-way');
  assert.deepEqual([plan.days, plan.returnDays], [1, 0]);
  assert.deepEqual(estimate(rules, plan).returnCharge, { from: 0, to: 0 });
});

test('Raipur → Bhopal one-way: 2 driving days + 1 return day', () => {
  const plan = planTrip(rules, fromRaipur('bhopal'), 'one-way');
  assert.deepEqual([plan.days, plan.returnDays], [2, 1]);
});

test('1,200 km one-way: 3 driving days + 2 return days', () => {
  const plan = planTrip(rules, 1200, 'one-way');
  assert.deepEqual([plan.minDays, plan.days, plan.returnDays], [3, 3, 2]);
  const e = estimate(rules, plan);
  assert.deepEqual([e.from, e.to], [3 * lo + 2 * back.from, 3 * hi + 2 * back.to]);
  assert.deepEqual([e.from, e.to], [6350, 7350]);
});

test('a little over a full day of driving does not add a day', () => {
  assert.equal(planTrip(rules, fromRaipur('delhi'), 'one-way').days, 3, 'Delhi, 1,214 km');
  assert.equal(planTrip(rules, 1240, 'one-way').days, 3);
  assert.equal(planTrip(rules, 1250, 'one-way').days, 4);
  assert.equal(planTrip(rules, 440, 'one-way').days, 1);
  assert.equal(planTrip(rules, 450, 'one-way').days, 2);
});

test('the customer books more days (resting, sightseeing): every day is charged', () => {
  const plan = planTrip(rules, 1200, 'one-way', 5);
  assert.deepEqual([plan.minDays, plan.days, plan.returnDays], [3, 5, 2]);
  assert.equal(estimate(rules, plan).from, 5 * lo + 2 * back.from);
  // Fewer days than the distance allows are not possible.
  assert.equal(planTrip(rules, 1200, 'one-way', 1).days, 3);
  // A typo like 500 days is capped.
  assert.equal(planTrip(rules, 300, 'one-way', 500).days, 60);
});

test('a round trip drives the distance twice and has no return days', () => {
  const plan = planTrip(rules, fromRaipur('nagpur'), 'round');
  assert.deepEqual([plan.days, plan.returnDays], [2, 0]);
});

test('closer than localWithinKm is flagged as a local trip', () => {
  assert.equal(planTrip(rules, fromRaipur('bhilai'), 'one-way').local, true);
  assert.equal(planTrip(rules, fromRaipur('rajnandgaon'), 'one-way').local, false);
});

test('return days grow with the distance home', () => {
  assert.equal(returnDays(rules, 0), 0);
  assert.equal(returnDays(rules, 258), 0, 'Raigarh: drive and ride home fit in one day');
  assert.equal(returnDays(rules, 287), 1, 'Jagdalpur: home the next day');
  assert.equal(returnDays(rules, 1405), 2, 'Chennai');
});

/* ------------------------------------------------------- the quote ---- */

const base = { driverReturnPay: 850, days: 2, returnDays: 1, extraHours: 0, ticket: 0, partnerPercent: 0, minProfitPercent: 15 };

test('quote: driver cost + 15%, rounded up to ₹50 a day', () => {
  const q = quote(rules, { ...base, driverDayCost: 1000 });
  assert.equal(q.dayRate, 1200); // 1000 / 0.85 = 1176.5 → 1200
  assert.equal(q.returnDayRate, 1000); // 850 / 0.85
  assert.equal(q.charges, 2 * 1200 + 1000);
  assert.equal(q.driverPay, 2 * 1000 + 850);
  assert.equal(q.profit, q.charges - q.driverPay);
  assert.ok(q.profitPercent >= 15 && q.ok);
  assert.equal(q.aboveShownRange, false);

  const dearer = quote(rules, { ...base, driverDayCost: 1250 });
  assert.equal(dearer.dayRate, 1500); // 1250 / 0.85 = 1470.6 → 1500
});

test('quote: the ticket is passed through with no profit on it', () => {
  const without = quote(rules, { ...base, driverDayCost: 1000 });
  const withTicket = quote(rules, { ...base, driverDayCost: 1000, ticket: 650 });
  assert.equal(withTicket.total, without.total + 650);
  assert.equal(withTicket.profit, without.profit);
});

test('quote: a partner commission is priced in, so the profit still holds', () => {
  const q = quote(rules, { ...base, driverDayCost: 1000, returnDays: 0, partnerPercent: 10 });
  assert.equal(q.dayRate, 1350); // 1000 / 0.75 = 1333 → 1350
  assert.equal(q.partnerPay, 270);
  assert.ok(q.ok, `profit ${q.profitPercent}%`);
});

test('quote: overtime at the published rate or the cost-based rate, whichever is higher', () => {
  const q = quote(rules, { ...base, driverDayCost: 1000, extraHours: 3 });
  assert.equal(q.extraHourRate, Math.max(rules.extraHour, 100));
  assert.equal(q.charges, 2 * 1200 + 1000 + 3 * q.extraHourRate);
});

test('quote: a return day follows what the driver gets for it, never below the lowest shown', () => {
  const low = quote(rules, { ...base, driverDayCost: 1000, driverReturnPay: 500 });
  assert.equal(low.returnDayRate, back.from);
  const dearer = quote(rules, { ...base, driverDayCost: 1000, driverReturnPay: 1000 });
  assert.equal(dearer.returnDayRate, 1200); // 1000 / 0.85 = 1176 → 1200
  assert.equal(dearer.aboveShownRange, false);
  assert.ok(dearer.ok, `profit ${dearer.profitPercent}%`);
});

test('quote: the minimum profit always holds, and a price above the shown range is flagged', () => {
  for (const cost of [900, 1000, 1200, 1300, 1400, 1550])
    for (const pay of [600, 850, 1000, 1150])
      for (const partnerPercent of [0, 10]) {
        const q = quote(rules, { ...base, driverDayCost: cost, driverReturnPay: pay, extraHours: 3, partnerPercent });
        assert.ok(q.ok, `cost ${cost}, return pay ${pay}, partner ${partnerPercent}%: ${q.profitPercent}%`);
      }
  assert.equal(quote(rules, { ...base, driverDayCost: 1500 }).aboveShownRange, true);
  assert.equal(quote(rules, { ...base, driverDayCost: 1000, driverReturnPay: 1100 }).aboveShownRange, true);
});

test('quote: nonsense input never produces NaN', () => {
  const q = quote(rules, { ...base, driverDayCost: Number.NaN, days: -2, extraHours: -1, ticket: Number.NaN });
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
  assert.deepEqual(nagpur.from.Raipur, { km: 284, oneWay: { days: 1, returnDays: 1 }, roundDays: 2 });
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
