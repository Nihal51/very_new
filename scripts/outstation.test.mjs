/**
 * The outstation estimate and the /admin quote (lib/outstation.ts): the
 * driver's TIME, decided with the owner on 8 Nov 2026 — from when he leaves
 * until he is home, each 24 hours at the day price for the distance, the hours
 * past them by the hour (never more than one more day); up to 160 km one
 * price for the trip. Also the timings, the final bill (and the older quotes
 * it still bills), and the checks on site-settings.ts (lib/settings-schema.ts).
 *
 * Driver costs in this file are made-up round numbers: the repository is
 * public, so real costs never go in it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  billDays,
  chargeHours,
  dayRateFor,
  destinationTable,
  destinations,
  dropTime,
  estimate,
  finalBill,
  findDestination,
  homeTravelHours,
  homeWay,
  pickupCities,
  planTrip,
  pricedByTime,
  quote,
  returnCost,
  roadKm,
  timeBlocks,
  timePrice,
  timeQuote,
  timeWords,
  withReturn,
} from '../lib/outstation.ts';
import { checkSettings } from '../lib/settings-schema.ts';
import { settings } from '../site-settings.ts';

/** The same mapping as tripRules in lib/settings.ts (which uses the @/ alias Node cannot read). */
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
const band = {
  targetProfitPercent: settings.outstation.targetProfitPercent,
  minProfitPercent: settings.outstation.minProfitPercent,
  maxProfitPercent: settings.outstation.maxProfitPercent,
};
const money = (n) => `₹${n}`;

const fromRaipur = (id) => roadKm('Raipur', findDestination(id));
/** A trip from Raipur as the booking form plans it before the train lookup (the route's average wait and ride), leaving at `start` (7 AM, any day). */
const trip = (id, kind = 'one-way', days = 0, start = 7, nonstop = false) =>
  planTrip(rules, fromRaipur(id), kind, days, homeWay(findDestination(id), 'Raipur'), start, nonstop);
const price = (plan) => {
  const e = estimate(rules, plan);
  return [e.from, e.to];
};

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


/* -------------------------------------------------- the settings ---- */

test('the rule in site-settings.ts (8 Nov 2026): same-day drops up to 160 km, then each 24 h, ₹130 an hour past them', () => {
  assert.deepEqual(settings.prices.outstationNear, [{ upToKm: 160, from: 1050, to: 1350 }]);
  assert.deepEqual(settings.prices.outstation, { from: 1450, to: 1750 });
  assert.deepEqual([settings.outstation.nearFromKm, settings.outstation.dayTopFromKm, settings.outstation.extraHour], [60, 300, 130]);
  assert.deepEqual([band.minProfitPercent, band.targetProfitPercent, band.maxProfitPercent], [20, 25, 30]);
});

/* ------------------------------------------- the day price for the km ---- */

test('the day price rises with the distance, to the nearest ₹50 (8 Nov 2026)', () => {
  const at = (km) => dayRateFor(rules, km);
  // Close by: the first tier's from; rising to its to at 160 km (same-day drops).
  assert.deepEqual([30, 60, 74, 113, 127, 160].map((km) => at(km).from), [1050, 1050, 1100, 1200, 1250, 1350]);
  // Farther: ₹1,450 rising to ₹1,750 at 300 km; farther still, the same.
  assert.deepEqual([161, 216, 258, 284, 300, 546, 1214].map((km) => at(km).from), [1450, 1550, 1650, 1700, 1750, 1750, 1750]);
  // One number for a place in the list.
  for (const km of [113, 284, 1214]) assert.equal(at(km).from, at(km).to);
  // A place not in the list (no km): the whole span, as a range — the team quotes it on the call.
  assert.deepEqual(at(0), { from: 1050, to: 1750 });
  assert.deepEqual(at(undefined), { from: 1050, to: 1750 });
  // Older settings (no nearFromKm): each tier's range.
  const old = { dayRate: { from: 1550, to: 1650 }, nearRates: [{ upToKm: 150, from: 1300, to: 1400 }] };
  assert.deepEqual([dayRateFor(old, 113), dayRateFor(old, 284)], [{ from: 1300, to: 1400 }, { from: 1550, to: 1650 }]);
  // Never cheaper farther away.
  let last = 0;
  for (let km = 1; km <= 1500; km += 7) {
    assert.ok(at(km).from >= last, `${km} km`);
    last = at(km).from;
  }
});

/* ----------------------------------------- the price for his time ---- */

test('the 24-hour blocks: past them by the hour, never more than one more day', () => {
  const b = (h) => timeBlocks(h, 1750, 130);
  assert.deepEqual(b(0), { days: 1, extraHours: 0 });
  assert.deepEqual(b(8), { days: 1, extraHours: 0 }, 'arrives in 8 h: the other 16 are his wait and train home');
  assert.deepEqual(b(24), { days: 1, extraHours: 0 });
  assert.deepEqual(b(25), { days: 1, extraHours: 1 });
  assert.deepEqual(b(37), { days: 1, extraHours: 13 }, '13 × ₹130 = ₹1,690, still less than a day');
  assert.deepEqual(b(38), { days: 2, extraHours: 0 }, '14 × ₹130 = ₹1,820: one more day instead');
  assert.deepEqual(b(48), { days: 2, extraHours: 0 });
  assert.deepEqual(b(57), { days: 2, extraHours: 9 });
  assert.deepEqual(b(66), { days: 3, extraHours: 0 });
  assert.deepEqual(b(24.2), { days: 1, extraHours: 1 }, 'a started hour counts');
  assert.deepEqual(b(Number.NaN), { days: 1, extraHours: 0 });
});

test('the price for his time: Bilaspur, Visakhapatnam, Delhi — the examples agreed with the owner', () => {
  // Up to 160 km he is home the same day: one price for the trip.
  const bsp = timePrice(rules, 113, 6);
  assert.deepEqual([bsp.price, bsp.short, bsp.days, bsp.extraHours, bsp.dayRate], [1200, true, 1, 0, 1200]);
  // Visakhapatnam, away 26 h: one 24 h + 2 h × ₹130.
  const vskp = timePrice(rules, 546, 25.2);
  assert.deepEqual([vskp.price, vskp.short, vskp.days, vskp.hours, vskp.extraHours, vskp.extraCharge], [2010, false, 1, 26, 2, 260]);
  // Delhi, away 66 h: 2 × 24 h + 18 h — more than a day, so 3 × ₹1,750.
  const del = timePrice(rules, 1214, 66);
  assert.deepEqual([del.price, del.days, del.extraHours], [5250, 3, 0]);
  // The agreed rates on a quote or a bill replace the shown ones.
  const agreed = timePrice(rules, 1214, 57, { dayRate: 1800, extraHour: 140 });
  assert.deepEqual([agreed.price, agreed.dayRate, agreed.extraHourRate], [2 * 1800 + 9 * 140, 1800, 140]);
  // Unknown place: no price for the time (the team quotes it).
  assert.equal(timePrice(rules, 0, 20), undefined);
  // A same-day drop that keeps him a day and more: the same blocks.
  assert.equal(timePrice(rules, 113, 30).price, 1200 + 6 * 130);
  assert.equal(timePrice(rules, 113, 40).price, 2 * 1200);
});

test('his time never costs more than the day price for each started 24 h, and an hour more never jumps', () => {
  for (const km of [74, 113, 160, 216, 284, 546, 1214]) {
    const day = dayRateFor(rules, km).from;
    let last = timePrice(rules, km, 0).price;
    for (let h = 0; h <= 150; h++) {
      const p = timePrice(rules, km, h).price;
      assert.ok(p >= last && p - last <= rules.extraHour, `${km} km, ${h} h: ₹${last} → ₹${p}`);
      assert.ok(p <= Math.max(1, Math.ceil(h / 24)) * day, `${km} km, ${h} h: ₹${p}`);
      last = p;
    }
  }
});

test('the time price in words', () => {
  assert.deepEqual(timeWords(timePrice(rules, 113, 6), money), ['One price for the trip (he is home the same day)']);
  assert.deepEqual(timeWords(timePrice(rules, 546, 26), money), ['1 × 24 h of the driver’s time × ₹1750', '2 h past the 24 h × ₹130']);
  assert.deepEqual(timeWords(timePrice(rules, 1118, 57), money), ['2 × 24 h of the driver’s time × ₹1750', '9 h past them × ₹130']);
});

/* ------------------------------------------------- the estimate ---- */

test('the estimate from Raipur at 7 AM, with the route’s average wait and ride home', () => {
  const one = (id) => estimate(rules, trip(id)).time;
  const rows = ['bilaspur', 'kanker', 'janjgir', 'korba', 'nagpur', 'jabalpur', 'visakhapatnam', 'bhubaneswar', 'mumbai', 'delhi', 'bengaluru', 'chennai'].map((id) => {
    const t = one(id);
    return [id, t.hours, t.days, t.extraHours, t.price];
  });
  assert.deepEqual(rows, [
    ['bilaspur', 6, 1, 0, 1200],
    ['kanker', 8, 1, 0, 1250],
    ['janjgir', 10, 1, 0, 1350],
    ['korba', 14, 1, 0, 1550],
    ['nagpur', 13, 1, 0, 1700],
    ['jabalpur', 24, 1, 0, 1750],
    ['visakhapatnam', 26, 1, 2, 2010],
    ['bhubaneswar', 33, 1, 9, 2920],
    ['mumbai', 57, 2, 9, 4670],
    ['delhi', 66, 3, 0, 5250],
    ['bengaluru', 87, 4, 0, 7000],
    ['chennai', 84, 3, 12, 6810],
  ]);
  // One number, no range, for a place in the list.
  for (const id of ['nagpur', 'delhi']) assert.equal(estimate(rules, trip(id)).from, estimate(rules, trip(id)).to);
});

test('the estimate follows the train picked: its wait and its arrival, never counted twice', () => {
  const plan = trip('visakhapatnam');
  const at = (wait, ride = 9.5) => estimate(rules, withReturn(plan, plan.dropAt + wait, plan.dropAt + wait + ride));
  assert.equal(at(1).from, 1750, 'home in 22 h: inside the 24');
  assert.equal(at(3.5).from, 1750, 'home in 24 h');
  assert.deepEqual([at(4).time.extraHours, at(4).from], [1, 1750 + 130]);
  assert.deepEqual([at(12).time.extraHours, at(12).from], [9, 1750 + 9 * 130]);
  assert.deepEqual([at(17).time.days, at(17).from], [2, 3500], '14 h past: one more day instead');
  // The driving is untouched by the train.
  const train = withReturn(plan, plan.dropAt + 12, plan.dropAt + 21.5);
  assert.deepEqual([train.fullDays, train.extraHours, train.homeBasis], [plan.fullDays, plan.extraHours, 'train']);
});

test('round trips and places not in the list', () => {
  // Round trips: the days at the day price for the distance.
  assert.deepEqual(price(trip('jharsuguda', 'round')), [1750, 1750]);
  assert.deepEqual(price(trip('nagpur', 'round')), [1700, 1700]);
  assert.deepEqual(price(trip('bilaspur', 'round')), [1200, 1200]);
  assert.deepEqual(price(trip('delhi', 'round')), [4 * 1750, 4 * 1750]);
  assert.equal(estimate(rules, trip('delhi', 'round')).time, undefined);
  // Surat and back in 7 days (the owner's example): 7 × ₹1,750.
  assert.deepEqual(price(planTrip(rules, 1050, 'round', 7)), [12250, 12250]);
  // A place not in the list: the days at the whole span, as a range.
  assert.deepEqual(price(planTrip(rules, 0, 'one-way')), [1050, 1750]);
  assert.deepEqual(price(planTrip(rules, 0, 'round', 3)), [3 * 1050, 3 * 1750]);
});


test('Raipur → Kolkata: drops before noon on day 2; the route’s average wait and ride home', () => {
  const plan = trip('kolkata');
  const home = findDestination('kolkata').home;
  assert.ok(plan.dropAt > 24 && plan.dropAt < 24 + 5, `drops at ${plan.dropAt}`);
  assert.equal(plan.returnHours, Math.ceil(home.wait + home.raipur));
  assert.ok(Math.abs(plan.leaveAt - plan.dropAt - home.wait) < 1e-9, 'the average wait, not the 1 h to the station');
  assert.deepEqual(price(plan), [2 * 1750, 2 * 1750]);
});

test('day and night (non-stop): an earlier drop, the same way home', () => {
  const normal = trip('mumbai');
  const nonstop = trip('mumbai', 'one-way', 0, 7, true);
  assert.equal(nonstop.nonstop, true);
  assert.deepEqual([nonstop.fullDays, nonstop.extraHours], [normal.fullDays, normal.extraHours]);
  assert.ok(Math.abs(nonstop.dropAt - nonstop.driveHours) < 1e-9);
  assert.ok(nonstop.dropAt < normal.dropAt);
  assert.equal(nonstop.returnHours, normal.returnHours);
  // Home sooner: his time costs less (Mumbai: 45 h = 1 × 24 h + 21 h → 2 × 24 h, instead of 57 h).
  assert.ok(estimate(rules, nonstop).from < estimate(rules, normal).from);
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
  // Odisha, Ranchi and Bhopal (4 Nov 2026): direct overnight trains as quick as the bus, checked on the robot.
  for (const id of ['nagpur', 'jabalpur', 'visakhapatnam', 'varanasi', 'hyderabad', 'kolkata', 'pune', 'mumbai', 'delhi', 'bengaluru', 'bhubaneswar', 'puri', 'ranchi', 'bhopal'])
    assert.ok(findDestination(id).rail, id);
  // By bus where it is quicker than any train, or there is no daily one: no train box.
  for (const id of ['sambalpur', 'ambikapur', 'jagdalpur', 'indore', 'patna']) assert.equal(findDestination(id).rail, undefined, id);
  assert.deepEqual([...findDestination('bengaluru').rail.hubs], ['NGP']);
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

test('the average way home per pickup city: the wait from the timetables, the ride to each city', () => {
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
  // Every place beyond the same-day ones has its average wait: train routes from the timetables, bus routes 1.5 h.
  // (Up to 160 km the price is one price for the trip, whatever the wait.)
  for (const d of destinations) {
    if (d.home.wait === undefined) {
      assert.ok(d.fromRaipur.road <= 160, `${d.id}: an average wait is needed beyond 160 km`);
      continue;
    }
    assert.ok(d.home.wait !== undefined && d.home.wait > 0 && d.home.wait <= 24, `${d.id}: wait ${d.home.wait}`);
    if (d.home.by !== 'train') assert.equal(d.home.wait, 1.5, `${d.id}: a bus route`);
    assert.deepEqual(homeWay(d, 'Raipur'), { hours: d.home.raipur, wait: d.home.wait });
  }
  // A place without an average: the 1 h to the station; typed in by hand, the distance at busKmh.
  assert.deepEqual(homeWay(findDestination('durg'), 'Raipur'), { hours: findDestination('durg').home.raipur });
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

test('the customer books more days (stops on the way): he drops the car on the last one, and is away longer', () => {
  const two = trip('delhi');
  const four = trip('delhi', 'one-way', 4);
  assert.deepEqual([four.minDays, four.days, four.fullDays, four.extraHours], [2, 4, 4, 0]);
  assert.ok(Math.abs(four.dropAt - two.dropAt - 48) < 1e-9);
  assert.ok(estimate(rules, four).time.days >= estimate(rules, two).time.days + 2);
  // Fewer days than the drive needs change nothing; a typo like 500 is capped.
  assert.deepEqual([trip('delhi', 'one-way', 1).fullDays, trip('delhi', 'one-way', 1).extraHours], [2, 1]);
  assert.equal(planTrip(rules, 300, 'one-way', 500).days, 60);
});

test('a round trip is days of the trip; back home within the 24 hours is ONE day', () => {
  const jharsuguda = trip('jharsuguda', 'round');
  assert.deepEqual([jharsuguda.days, jharsuguda.fullDays, jharsuguda.returnHours], [1, 1, 0]);
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

const one = { ...band, km: 546, hours: 26, driverDayCost: 1500, driverHourPay: 90, ticket: 0, partnerPercent: 0 };

test('quote, one-way: the driver’s cost for each 24 h and the profit on top, to ₹50 (₹10 an hour)', () => {
  const q = timeQuote(rules, one);
  // ₹1,500 ÷ 0.75 = ₹2,000 a day; ₹90 ÷ 0.75 = ₹120 an hour; 26 h = 1 × 24 h + 2 h.
  assert.deepEqual([q.time.dayRate, q.time.extraHourRate, q.time.days, q.time.extraHours, q.time.price], [2000, 120, 1, 2, 2240]);
  assert.deepEqual([q.total, q.driverPay, q.profit, q.profitPercent, q.low, q.high, q.ok], [2240, 1500 + 180, 560, 25, false, false, true]);
  // The price customers were shown for the same hours, for comparison.
  assert.equal(q.shown.price, 2010);
  // The ticket is passed through with no profit on it.
  assert.deepEqual([timeQuote(rules, { ...one, ticket: 900 }).total, timeQuote(rules, { ...one, ticket: 900 }).profit], [2240 + 900, 560]);
});

test('quote, one-way: the blocks are counted the same for the customer and the driver', () => {
  // 38 h: 14 h × ₹120 = ₹1,680 — less than ₹2,000, so 1 × 24 h + 14 h.
  const a = timeQuote(rules, { ...one, hours: 38 });
  assert.deepEqual([a.time.days, a.time.extraHours, a.driverPay], [1, 14, 1500 + 14 * 90]);
  // 41 h: 17 h × ₹120 = ₹2,040 — more than a day, so 2 × 24 h for both.
  const b = timeQuote(rules, { ...one, hours: 41 });
  assert.deepEqual([b.time.days, b.time.extraHours, b.time.price, b.driverPay], [2, 0, 4000, 3000]);
  // A same-day drop: the driver's cost for the trip.
  const s = timeQuote(rules, { ...one, km: 113, hours: 6, driverDayCost: 700 });
  assert.deepEqual([s.time.short, s.time.days, s.time.price, s.driverPay], [true, 1, 950, 700]);
});

test('quote, one-way: the profit band — too little for us, or too much for the customer', () => {
  const low = timeQuote(rules, { ...one, dayRate: 1600 });
  assert.deepEqual([low.time.dayRate, low.low, low.high, low.ok], [1600, true, false, false]);
  const high = timeQuote(rules, { ...one, dayRate: 3000 });
  assert.deepEqual([high.low, high.high, high.ok], [false, true, false]);
  // A partner's commission is priced in, so the profit still holds.
  const p = timeQuote(rules, { ...one, partnerPercent: 10 });
  assert.deepEqual([p.time.dayRate, p.time.extraHourRate, p.partnerPay], [2300, 140, Math.round((2300 + 280) * 0.1)]);
  assert.ok(p.ok && p.profitPercent >= 20 && p.profitPercent <= 30, `${p.profitPercent}%`);
  // Over every made-up cost the price stays inside the band.
  for (let cost = 600; cost <= 2400; cost += 50)
    for (const hours of [6, 20, 26, 37, 45, 57, 66, 90]) {
      const q = timeQuote(rules, { ...one, driverDayCost: cost, hours });
      assert.ok(q.ok, `₹${cost}, ${hours} h: ${q.profitPercent}%`);
    }
});

test('quote, one-way: nothing to price without the km or a price; nonsense never gives NaN', () => {
  assert.equal(timeQuote(rules, { ...one, km: 0 }), undefined);
  assert.equal(timeQuote(rules, { ...one, driverDayCost: 0 }), undefined);
  const q = timeQuote(rules, { ...one, hours: Number.NaN, ticket: Number.NaN, driverHourPay: Number.NaN });
  for (const v of Object.values(q)) if (typeof v === 'number') assert.ok(Number.isFinite(v));
  // Without the hourly pay: the published ₹130 an hour.
  assert.equal(timeQuote(rules, { ...one, driverHourPay: 0 }).time.extraHourRate, 130);
});

const round = { ...band, driverDayCost: 1500, days: 2, extraHours: 3, ticket: 0, partnerPercent: 0, km: 284 };

test('quote, round trip: the days and the driving beyond the day, the profit on top', () => {
  const q = quote(rules, round);
  // ₹1,500 ÷ 0.75 = ₹2,000 a day; a 12th of the day ÷ 0.75 = ₹166.7 → ₹170 an hour (never below ₹130).
  assert.deepEqual([q.dayRate, q.days, q.extraHours, q.extraHourRate, q.extraCharge, q.charges], [2000, 2, 3, 170, 510, 4510]);
  assert.deepEqual([q.driverPay, q.profit, q.profitPercent, q.ok], [3000 + 375, 1135, 25.2, true]);
  // More than 7 hours over: one more day instead.
  const more = quote(rules, { ...round, extraHours: 9 });
  assert.deepEqual([more.days, more.extraHours, more.extraCharge], [3, 0, 0]);
  // Above the day price shown for the distance (₹1,700 for 284 km).
  assert.equal(q.aboveShownRange, true);
  assert.equal(quote(rules, { ...round, driverDayCost: 600 }).aboveShownRange, false);
  // Outside the band: not ok.
  assert.equal(quote(rules, { ...round, targetProfitPercent: 10 }).ok, false);
  // Older callers without a target use the minimum.
  const { targetProfitPercent, ...noTarget } = round;
  assert.equal(quote(rules, noTarget).dayRate, Math.round(1500 / 0.8 / 50) * 50);
  // Nonsense input never produces NaN.
  const bad = quote(rules, { ...round, driverDayCost: Number.NaN, days: -2, extraHours: -1, ticket: Number.NaN });
  for (const v of Object.values(bad)) if (typeof v === 'number') assert.ok(Number.isFinite(v));
});

test('a saved quote or bill priced by the driver’s time: the km, and no route hours or way-home charge', () => {
  assert.equal(pricedByTime({ km: 546, returnHours: 0, returnCharge: 0 }), true);
  assert.equal(pricedByTime({ km: 1214, awayHours: 60, returnHours: 0, returnCharge: 0 }), false, 'a route price');
  assert.equal(pricedByTime({ km: 284, returnHours: 6, returnCharge: 720 }), false, 'by the hours');
  assert.equal(pricedByTime({ returnHours: 0, returnCharge: 0 }), false, 'a round trip');
  assert.equal(pricedByTime({ km: 0, returnHours: 0, returnCharge: 0 }), false);
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
      assert.ok(Number.isFinite(t.oneWay.wait) && t.oneWay.wait >= 0 && t.oneWay.wait <= 24, `${city} → ${row.id}`);
    }
  const nagpur = table.find((r) => r.id === 'nagpur');
  assert.deepEqual(
    [nagpur.from.Raipur.km, nagpur.from.Raipur.oneWay.days, nagpur.from.Raipur.oneWay.wait, nagpur.from.Raipur.oneWay.homeHours, nagpur.from.Raipur.oneWay.returnHours],
    [284, 1, 2.5, 4.75, 8],
  );
  const blr = table.find((r) => r.id === 'bengaluru');
  assert.equal('trains' in blr, false, 'no train list for the app either');
  assert.deepEqual(blr.rail, { stations: ['SMVB', 'SBC', 'YPR'], hubs: ['NGP'] });
  assert.ok(Math.abs(blr.from.Raipur.oneWay.driveHours - 1370 / rules.averageKmh) < 0.001);
  // A place without an average wait: the 1 h to the station.
  assert.equal(table.find((r) => r.id === 'durg').from.Raipur.oneWay.wait, rules.stationHours);
});

/* ------------------------------------------------- the profit guard ---- */

test('site-settings.ts passes its own checks', () => {
  assert.doesNotThrow(() => checkSettings(settings));
});

test('the nearby day prices are checked: nearest first, never dearer than farther ones or the long-trip price', () => {
  const near = (outstationNear) => ({ ...settings, prices: { ...settings.prices, outstationNear } });
  assert.doesNotThrow(() => checkSettings(near([])), 'no tiers: one price everywhere');
  assert.throws(() => checkSettings(near([{ upToKm: 250, from: 1300, to: 1400 }, { upToKm: 150, from: 1200, to: 1300 }])), /must be farther than the tier before/);
  assert.throws(() => checkSettings(near([{ upToKm: 150, from: 1300, to: 1400 }, { upToKm: 250, from: 1250, to: 1450 }])), /must not be cheaper than the nearer tier/);
  assert.throws(() => checkSettings(near([{ upToKm: 150, from: 1500, to: 1700 }])), /must not cost more than prices\.outstation/);
  assert.throws(() => checkSettings(near([{ upToKm: 150, from: 1400, to: 1300 }])), /is bigger than/);
});

test('the price curve and the profit band are checked', () => {
  const o = (over) => ({ ...settings, outstation: { ...settings.outstation, ...over } });
  assert.throws(() => checkSettings(o({ nearFromKm: 200 })), /nearFromKm \(200\) must be closer than the first/);
  assert.throws(() => checkSettings(o({ dayTopFromKm: 150 })), /dayTopFromKm must be farther than the last/);
  assert.throws(() => checkSettings(o({ minProfitPercent: 26 })), /minProfitPercent ≤ targetProfitPercent ≤ maxProfitPercent/);
  assert.throws(() => checkSettings(o({ maxProfitPercent: 24 })), /minProfitPercent ≤ targetProfitPercent ≤ maxProfitPercent/);
});

test('profit guard: passes when the prices cover the costs', () => {
  assert.doesNotThrow(() => checkSettings(settings, 'outstation=1050-1350; outstationNear=700-750; fullDay=700'));
  assert.doesNotThrow(() => checkSettings(settings, ''));
  // The nearby tiers are a same-day trip: the long-trip cost no longer has to fit under them.
  assert.doesNotThrow(() => checkSettings(settings, 'outstation=1050-1350'));
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
  // A same-day drop's cost is checked against each nearby tier.
  assert.throws(
    () => checkSettings(settings, 'outstationNear=1020-1040'),
    (err) => {
      assert.match(err.message, /prices\.outstationNear\[1\]\.from/);
      assert.doesNotMatch(err.message, /prices\.outstationNear\[1\]\.to|prices\.outstation\.from|1020|1040/);
      return true;
    },
  );
  assert.throws(() => checkSettings(settings, 'outstation 1000'), /part 1 cannot be read/);
  assert.throws(() => checkSettings(settings, 'taxi=100'), /"taxi", which is not one of the prices/);
});

test('profit guard: its own threshold (guardProfitPercent), apart from the /admin profit band', () => {
  const guard = settings.outstation.guardProfitPercent;
  assert.ok(guard > 0 && guard <= settings.outstation.minProfitPercent, 'the guard is never stricter than the band');
  // A made-up cost that earns exactly the guard's profit on the lowest full-day price passes …
  const edge = Math.floor(settings.prices.fullDay.from * (1 - guard / 100));
  assert.doesNotThrow(() => checkSettings(settings, `fullDay=${edge}`));
  // … and fails once the guard asks for more.
  const stricter = { ...settings, outstation: { ...settings.outstation, guardProfitPercent: guard + 5, minProfitPercent: guard + 5 } };
  assert.throws(() => checkSettings(stricter, `fullDay=${edge}`), /prices\.fullDay earns less|prices\.fullDay\.from/);
});

/* ------------------------------------------------------ the final bill -- */

const GRACE = settings.outstation.graceMinutes;
/** India time → epoch ms. */
const ist = (s) => Date.parse(`${s}:00+05:30`);
/** A bill from before 8 Nov 2026 (by the hours) unless `time` or `route` is given. */
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

test('final bill: the driver’s time from the real times — start → home, in 24-hour blocks', () => {
  const time = { km: 1118 }; // Mumbai, at the agreed ₹1,750 for each 24 h and ₹130 an hour
  const mumbai = (home, over = {}) =>
    bill({ time, dayRate: 1750, extraHourRate: 130, startAt: ist('2026-11-05T07:45'), dropAt: ist('2026-11-06T17:00'), homeAt: ist(home), ...over });
  // Home 57 h 10 m after the start → 57 h (the first 15 minutes free): 2 × 24 h + 9 h.
  const b = mumbai('2026-11-07T16:55');
  assert.deepEqual(
    [b.days, b.extraHours, b.extraCharge, b.returnHours, b.returnCharge, b.returnHourRate, b.dayRate, b.amount],
    [2, 9, 1170, 0, 0, 0, 1750, 4670],
  );
  assert.deepEqual(b.time, { km: 1118, hours: 57, short: false });
  // Home 4 h later: 13 h past, still less than a day. 6 h later: one more day instead.
  assert.equal(mumbai('2026-11-07T20:55').amount, 3500 + 13 * 130);
  assert.equal(mumbai('2026-11-07T22:55').amount, 3 * 1750);
  // 57 h 16 m: the hour counts.
  assert.equal(mumbai('2026-11-07T17:01').amount, 3500 + 10 * 130);
  // The ticket is passed on.
  assert.equal(mumbai('2026-11-07T16:55', { ticket: 900 }).amount, 4670 + 900);
  // A same-day drop: one price for the trip.
  const bsp = bill({ time: { km: 113 }, dayRate: 1200, extraHourRate: 130, startAt: ist('2026-11-05T07:00'), dropAt: ist('2026-11-05T09:40'), homeAt: ist('2026-11-05T13:10') });
  assert.deepEqual([bsp.days, bsp.extraHours, bsp.amount, bsp.time.short, bsp.time.hours], [1, 0, 1200, true, 6]);
  // A round trip ignores it: the days, as before.
  const r = bill({ time, kind: 'round', dayRate: 1750, startAt: ist('2026-11-05T07:00'), homeAt: ist('2026-11-06T07:00') });
  assert.deepEqual([r.time, r.days], [undefined, 1]);
});

test('final bill: matches the estimate when the trip goes exactly to plan — never dearer', () => {
  for (const id of ['bilaspur', 'korba', 'nagpur', 'jabalpur', 'visakhapatnam', 'hyderabad', 'bengaluru', 'delhi', 'mumbai', 'kolkata']) {
    const dest = findDestination(id);
    for (const nonstop of [false, true]) {
      const plan = planTrip(rules, roadKm('Raipur', dest), 'one-way', 0, homeWay(dest, 'Raipur'), { hour: 7, weekday: 1 }, nonstop);
      const start = ist('2026-11-02T07:00'); // a Monday
      const at = (h) => start + Math.round(h * 60) * 60000;
      const est = estimate(rules, plan);
      const real = bill({ nonstop, time: { km: plan.km }, dayRate: est.time.dayRate, extraHourRate: rules.extraHour, startAt: start, dropAt: at(plan.dropAt), homeAt: at(plan.homeAt) });
      const label = `${id}${nonstop ? ' non-stop' : ''}`;
      // The estimate rounds every started hour up; the bill forgives 15 minutes — never dearer, at most an hour less.
      assert.ok(real.amount <= est.from, `${label}: bill ${real.amount} > estimate ${est.from}`);
      assert.ok(est.from - real.amount <= rules.extraHour, `${label}: bill ${real.amount} far below ${est.from}`);
    }
  }
});

/* Quotes and bills from before 8 Nov 2026 are still billed the way they
   were agreed: by the hours (the days of driving, the hours left over, his way
   home by the hour with the daily cap), or a route price with awayHours. */

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

test('final bill (by the hours, before 8 Nov 2026): a drive shorter than a day, his way home by the hour', () => {
  const b = bill({ startAt: ist('2026-11-02T07:00'), dropAt: ist('2026-11-02T13:20'), homeAt: ist('2026-11-02T20:10') });
  // 6 h 20 m of driving = 7 h × ₹120; 7 h home: more than 6 h = ₹1,200.
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

test('final bill: a route price for the days paid; only the hours past them cost extra (7 Nov 2026)', () => {
  const route = { price: 5550, awayHours: 60, km: 1214 }; // Delhi: 3 days paid (72 h)
  const start = '2026-11-02T07:00';
  // Home 60 h after the start: the price. 72 h (12 h of waiting or delay): still the price — the time left in the days.
  const on = bill({ route, startAt: ist(start), dropAt: ist('2026-11-03T08:00'), homeAt: ist('2026-11-04T19:00') });
  assert.deepEqual([on.amount, on.days, on.dayRate, on.extraHours, on.returnCharge, on.route.realAwayHours, on.route.paidDays], [5550, 1, 5550, 0, 0, 60, 3]);
  const full = bill({ route, startAt: ist(start), dropAt: ist('2026-11-03T08:00'), homeAt: ist('2026-11-05T07:00') });
  assert.deepEqual([full.route.realAwayHours, full.amount], [72, 5550]);
  // 77 h 30 m → 78 h: 6 h past the 3 days × ₹120.
  const late = bill({ route, ticket: 900, startAt: ist(start), dropAt: ist('2026-11-03T08:00'), homeAt: ist('2026-11-05T12:30') });
  assert.deepEqual([late.route.realAwayHours, late.extraHours, late.extraCharge, late.amount], [78, 6, 720, 5550 + 720 + 900]);
  // 20 h past: never more than ₹1,200 for each 24 h.
  const long = bill({ route, startAt: ist(start), dropAt: ist('2026-11-03T08:00'), homeAt: ist('2026-11-06T03:00') });
  assert.deepEqual([long.extraHours, long.extraCharge], [20, 1200]);
  // Early: never less than the price.
  const early = bill({ route, startAt: ist(start), dropAt: ist('2026-11-03T06:00'), homeAt: ist('2026-11-04T12:00') });
  assert.equal(early.amount, 5550);
  // A round trip ignores it.
  assert.equal(bill({ route, kind: 'round', startAt: ist(start), homeAt: ist('2026-11-03T07:00') }).route, undefined);
});

test('final bill: extra hours never cost more than a day; the ticket is passed on', () => {
  const b = bill({ extraHourRate: 200, ticket: 650, startAt: ist('2026-11-02T07:00'), dropAt: ist('2026-11-02T18:40'), homeAt: ist('2026-11-02T18:40') });
  // 11 h 40 m → 12 h, more than 7: a full day, never the hours.
  assert.deepEqual([b.days, b.extraHours, b.extraCharge], [1, 0, 0]);
  assert.equal(b.amount, 1600 + 650);
});

test('the way home: each 24 h a day (₹1,200); up to 6 h left over by the hour, more = a full day (decided 29 Oct 2026)', () => {
  const after = settings.outstation.returnFullDayAfterHours;
  assert.equal(after, 6);
  const c = (h) => returnCost(h, 120, 1200, after);
  assert.deepEqual([0, 5, 6, 7, 8, 24, 30, 31, 32, 48, 54, 56].map(c), [0, 600, 720, 1200, 1200, 1200, 1920, 2400, 2400, 2400, 3120, 3600]);
  // The owner's example: 56 h = 2 days + 8 h = 3 days.
  assert.equal(c(56), 3 * 1200);
  // The driver's pay follows the same rule at his rate.
  assert.equal(returnCost(56, 80, 800, after), 2400);
  assert.equal(returnCost(30, 80, 800, after), 800 + 480);
});

/* --------------------------- long one-way drops (decided 24 Nov 2026) ---- */

import {
  finalBill as finalBillLong,
  isLongOneWay,
  longDrivingDays,
  longOneWayPrice,
  longQuote,
  longReturn,
  longReturnDayFor,
  pricedLong,
} from '../lib/outstation.ts';

/** lib/settings.ts tripRules, with the long one-way settings (the rules above leave them out: the 8 Nov way). */
const longRules = {
  ...rules,
  oneWayLong: { ...settings.prices.oneWayLong },
  drivingGraceHours: settings.outstation.drivingGraceHours,
  graceMinutes: settings.outstation.graceMinutes,
};

test('long one-way drops: the five cases the website and the app must both give', () => {
  const hm = (h, m = 0) => h * 60 + m;
  const cases = [
    ['A', 616, 12.3, hm(10, 41), 3200],
    ['B', 1200, 24, hm(27), 5280],
    ['C', 1200, 24, hm(35), 6400],
    ['D', 300, 6, hm(5), 2400],
  ];
  for (const [name, km, drivingHours, returnMinutes, total] of cases) {
    assert.equal(isLongOneWay(longRules, km), true, name);
    assert.equal(longOneWayPrice(longRules, km, drivingHours, returnMinutes).price, total, name);
  }
  const a = longOneWayPrice(longRules, 616, 12.3, hm(10, 41));
  assert.deepEqual([a.drivingDays, a.returnFullDays, a.returnLeftoverHours, a.returnCharge, a.returnHours], [1, 0, 11, 1600, 11]);
  const b = longOneWayPrice(longRules, 1200, 24, hm(27));
  assert.deepEqual([b.drivingDays, b.returnFullDays, b.returnLeftoverHours, b.returnCharge], [2, 1, 3, 1600 + 3 * 160]);
  // E: 140 km is a same-day drop — today's near-tier price, untouched.
  assert.equal(isLongOneWay(longRules, 140), false);
  assert.equal(isLongOneWay(longRules, 160), false, 'up to the first tier');
  assert.equal(isLongOneWay(rules, 616), false, 'without the settings: the 8 Nov way');
  const e = trip('bilaspur');
  assert.deepEqual(estimate(longRules, e), estimate(rules, e), 'Bilaspur (113 km) priced as before');
});

test('long one-way drops: driving days with the grace hour; the way home after the 15-minute grace, capped per 24 h', () => {
  const days = (h) => longDrivingDays(longRules, h);
  assert.deepEqual([days(0), days(6), days(12), days(13), days(13.1), days(24), days(25), days(25.5), days(36)], [1, 1, 1, 1, 2, 2, 2, 3, 3]);
  const r = (m) => longReturn(settings.prices.oneWayLong, m, 15);
  assert.equal(r(15).charge, 0, '0 h 15 m → 0');
  assert.equal(r(16).charge, 160, '0 h 16 m → 1 hour');
  assert.equal(r(10 * 60).charge, 1600, '10 h = the day’s cap');
  assert.equal(r(11 * 60).charge, 1600, 'never more than a day for the hours left over');
  assert.equal(r(24 * 60 + 15).charge, 1600, '24 h 15 m → one day, nothing left over');
  assert.equal(r(48 * 60 + 61).charge, 2 * 1600 + 160, '1 h 01 m → 1 hour');
  assert.equal(r(48 * 60 + 76).charge, 2 * 1600 + 2 * 160, '1 h 16 m → 2 hours');
});

test('long one-way drops: the estimate from the plan — driving time, then the drop → home (wait + ride)', () => {
  for (const id of ['nagpur', 'mumbai', 'delhi', 'visakhapatnam']) {
    const plan = trip(id);
    if (!isLongOneWay(longRules, plan.km)) continue;
    const est = estimate(longRules, plan);
    const p = longOneWayPrice(longRules, plan.km, plan.driveHours, (plan.homeAt - plan.dropAt) * 60);
    assert.ok(est.long, id);
    assert.deepEqual([est.from, est.to, est.days], [p.price, p.price, p.drivingDays], id);
    assert.equal(est.long.drivingDays, plan.days, `${id}: the driving days are the calendar days the plan drives`);
  }
  // A train picked: its arrival home counts.
  const plan = trip('mumbai');
  const late = withReturn(plan, plan.dropAt + 2, plan.dropAt + 30);
  assert.equal(estimate(longRules, late).long.returnMinutes, 30 * 60);
});

test('long one-way drops: the /admin quote and the final bill fit the saved-quote and bill checks (firestore.rules)', () => {
  // isQuote / isBill: returnCharge <= returnHourRate × 10 × (returnHours / 24 + 1).
  for (let m = 0; m <= 200 * 60; m += 37) {
    const p = longOneWayPrice(longRules, 900, 18, m);
    assert.ok(p.returnCharge <= p.returnHourRate * 10 * (p.returnHours / 24 + 1), `${m} min`);
    assert.ok(p.returnHours <= 200 || m > 199 * 60);
  }
  const q = longQuote(longRules, { ...band, km: 616, drivingHours: 12.3, returnMinutes: 641, driverDayCost: 1000, driverHourPay: 100, ticket: 0, partnerPercent: 0 });
  assert.equal(q.total, 3200);
  assert.equal(q.long.price, q.long.drivingDays * q.long.drivingDay + q.long.returnCharge, 'amount = days × dayRate + returnCharge (+ ticket)');
  assert.equal(q.driverPay, 1000 + 1000, 'his day for driving; his hours home capped at his day');
  assert.equal(pricedLong(longRules, { km: 616, returnHourRate: 160 }), true);
  assert.equal(pricedLong(longRules, { km: 616, returnHourRate: 160, awayHours: 30 }), false, 'a route price stays one');
  assert.equal(pricedLong(longRules, { km: 140, returnHourRate: 160 }), false);
  assert.equal(longReturnDayFor(longRules, 160), 1600);
  assert.equal(longReturnDayFor(longRules, 100), 1000, 'an agreed hourly rate keeps the same proportion');
  // The final bill from the real times: start → drop driving, drop → home his way home.
  const t0 = Date.parse('2026-11-25T01:30:00Z');
  const H = 3_600_000;
  const bill = finalBillLong(longRules, {
    kind: 'one-way', nonstop: false, startAt: t0, dropAt: t0 + 24 * H, homeAt: t0 + 24 * H + 27 * H,
    dayRate: 1600, extraHourRate: 130, returnHourRate: 160, ticket: 650, graceMinutes: 15, long: { km: 1200 },
  });
  assert.deepEqual([bill.days, bill.dayRate, bill.returnHours, bill.returnCharge, bill.amount], [2, 1600, 27, 2080, 5280 + 650]);
  assert.equal(bill.amount, bill.dayRate * bill.days + bill.extraCharge + bill.returnCharge + bill.ticket);
  assert.ok(bill.returnCharge <= bill.returnHourRate * 10 * (bill.returnHours / 24 + 1));
  const a = finalBillLong(longRules, {
    kind: 'one-way', nonstop: false, startAt: t0, dropAt: t0 + 12.3 * H, homeAt: t0 + 12.3 * H + (10 * 60 + 41) * 60_000,
    dayRate: 1600, extraHourRate: 130, returnHourRate: 160, ticket: 0, graceMinutes: 15, long: { km: 616 },
  });
  assert.equal(a.amount, 3200);
});

test('long one-way settings: whole rupees, and the way home’s day at most 10 hours’ worth (the saved checks)', () => {
  const ow = settings.prices.oneWayLong;
  assert.throws(() => checkSettings({ ...settings, prices: { ...settings.prices, oneWayLong: { ...ow, returnDay: 10 * ow.returnHour + 10 } } }), /returnDay/);
  assert.throws(() => checkSettings({ ...settings, prices: { ...settings.prices, oneWayLong: { ...ow, drivingDay: 0 } } }), /drivingDay/);
  assert.equal(settings.outstation.hoursPerDay, 12, 'a driving day is outstation.hoursPerDay');
  assert.equal(settings.outstation.drivingGraceHours, 1);
});
