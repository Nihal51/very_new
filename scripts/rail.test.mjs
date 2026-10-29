/**
 * The train home from real timetable data (lib/rail.ts) and the website's
 * lookup client (lib/rail-client.ts). The answers here are made-up test
 * trains in RailRadar's documented shape — they test the maths, they are not
 * a timetable.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { estimate, planTrip, returnCost, withReturn } from '../lib/outstation.ts';
import {
  addDays,
  directQueries,
  findReturn,
  hubQueries,
  istDate,
  istInstant,
  legsFrom,
  planReturn,
  weekdayOf,
} from '../lib/rail.ts';
import { makeFetcher, parseLookup } from '../lib/rail-client.ts';
import { settings } from '../site-settings.ts';

const RULES = {
  transferBufferMinutes: settings.trains.transferBufferMinutes,
  maxTransferHours: settings.trains.maxTransferHours,
  directWithinHours: settings.trains.directWithinHours,
  maxWaitHours: settings.trains.maxWaitHours,
  maxOptions: settings.trains.maxOptions,
};
const ist = (s) => Date.parse(`${s}:00+05:30`);
const iso = (ms) => new Date(ms + 330 * 60_000).toISOString().slice(0, 16).replace('T', ' ');

/** A test train in the robot's shape. */
const t = (number, dep, depDay, arr, arrDay, duration, extra = {}) => ({
  number, name: `Test ${number}`, type: 'Express', runDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
  dep, depDay, arr, arrDay, duration, live: null, ...extra,
});
const ok = (from, to, date, trains, extra = {}) => ({
  ok: true, query: { from, to, date }, checkedAt: ist('2026-10-30T10:00'), live: false, fromName: `${from} stn`, toName: `${to} stn`, trains, ...extra,
});

/* ----------------------------------------------------------- time zone ---- */

test('India time: the date and HH:MM are read as India time, whatever the computer’s time zone', () => {
  assert.equal(new Date(istInstant('2026-10-31', '23:40')).toISOString(), '2026-10-31T18:10:00.000Z');
  assert.equal(new Date(istInstant('2026-10-31', '00:05', 2)).toISOString(), '2026-11-01T18:35:00.000Z');
  assert.equal(istDate(Date.parse('2026-10-31T18:40:00Z')), '2026-11-01', '00:10 in India is already the next day');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(weekdayOf('2026-10-30'), 'fri');
  for (const bad of [['2026-02-30', '10:00'], ['2026-10-31', '24:00'], ['2026-10-31', '7:5'], ['31-10-2026', '10:00']])
    assert.equal(istInstant(...bad), undefined, bad.join(' '));
});

/* -------------------------------------------- reading the timetable ---- */

test('a train crossing midnight: day numbers put the arrival on the right date', () => {
  const { legs, dropped } = legsFrom(ok('NGP', 'R', '2026-10-31', [t('11111', '22:30', 1, '03:10', 2, 280)]));
  assert.equal(dropped.length, 0);
  assert.equal(iso(legs[0].depart), '2026-10-31 22:30');
  assert.equal(iso(legs[0].arrive), '2026-11-01 03:10');
});

test('a multi-day journey: boards on its 2nd day, arrives on its 3rd', () => {
  const { legs } = legsFrom(ok('YPR', 'R', '2026-10-30', [t('22222', '23:40', 2, '00:05', 4, 1465)]));
  assert.equal(iso(legs[0].depart), '2026-10-30 23:40');
  assert.equal(iso(legs[0].arrive), '2026-11-01 00:05');
});

test('wrong or incomplete train data is left out and reported, never guessed', () => {
  const { legs, dropped } = legsFrom(
    ok('SC', 'R', '2026-10-31', [
      t('33333', '25:00', 1, '10:00', 1, 100), // not a time
      t('33334', '10:00', 2, '09:00', 1, 100), // day numbers backwards
      t('33335', '10:00', 1, '09:00', 1, 60), // arrives before it leaves
      t('33336', '10:00', 1, '12:00', 1, 300), // duration disagrees with the times
      t('33337', '10:00', 1, '12:00', 1, 120, { runDays: ['mon'] }), // 31 Oct 2026 is a Saturday
      t('', '10:00', 1, '12:00', 1, 120), // no number
      t('33338', '10:00', 1, '12:00', 1, 120), // fine
    ]),
  );
  assert.deepEqual(legs.map((l) => l.train.number), ['33338']);
  assert.deepEqual(
    dropped.map((d) => d.reason),
    ['times missing or not HH:MM', 'day numbers missing or out of order', 'arrives before it leaves', 'duration does not match the times', 'does not run on sat', 'no train number or name'],
  );
});

test('running days are checked against the day the train STARTED, not the boarding day', () => {
  // Boards on its 2nd day, Saturday 31 Oct → it started on Friday.
  const { legs } = legsFrom(ok('YPR', 'R', '2026-10-31', [t('44444', '06:00', 2, '22:00', 2, 960, { runDays: ['fri'] })]));
  assert.equal(legs.length, 1);
});

/* ---------------------------------------------------------- planning ---- */

const drop = ist('2026-10-31T12:00'); // the user's example day
const ready = drop + 60 * 60_000; // an hour to get to the station

const leg = (number, from, to, dep, arr, extra = {}) => ({
  train: { number, name: `Test ${number}` },
  from: { code: from, name: `${from} stn` },
  to: { code: to, name: `${to} stn` },
  depart: ist(dep),
  arrive: ist(arr),
  checkedAt: ist('2026-10-30T10:00'),
  ...extra,
});

test('the train he cannot catch is never offered; the earliest home comes first; the wait is counted', () => {
  const opts = planReturn({
    drop,
    ready,
    stations: ['SBC'],
    rules: RULES,
    direct: [
      leg('10001', 'SBC', 'R', '2026-10-31T12:30', '2026-11-01T12:00'), // leaves before he can get there
      leg('10002', 'SBC', 'R', '2026-10-31T15:00', '2026-11-01T18:00'),
      leg('10003', 'SBC', 'R', '2026-10-31T20:00', '2026-11-01T16:00'),
    ],
  });
  assert.deepEqual(opts.map((o) => o.id), ['10003', '10002']);
  // The user's example: drops at 12 PM, train at 3 PM → 3 h waiting, then the train.
  const at3 = opts.find((o) => o.id === '10002');
  assert.equal(at3.waitMinutes, 180);
  assert.equal(at3.totalMinutes, 30 * 60);
  assert.equal(at3.scheduled, true);
});

test('no direct train soon enough: a connection whose BOTH trains were confirmed, with the transfer buffer', () => {
  const toHub = [
    leg('20001', 'SBC', 'NGP', '2026-10-31T14:00', '2026-11-01T08:00'),
    leg('20002', 'SBC', 'NGP', '2026-10-31T13:30', '2026-11-01T09:00'),
  ];
  const fromHub = [
    leg('30001', 'NGP', 'R', '2026-11-01T08:30', '2026-11-01T13:00'), // 30 min after 20001: below the buffer
    leg('30002', 'NGP', 'R', '2026-11-01T10:00', '2026-11-01T14:30'), // 2 h after 20001, 1 h after 20002
    leg('30003', 'NGP', 'R', '2026-11-02T08:00', '2026-11-02T12:30'), // 24 h later: over maxTransferHours
    leg('20001', 'NGP', 'R', '2026-11-01T08:20', '2026-11-01T12:40'), // the same train: not a change
  ];
  const opts = planReturn({ drop, ready, stations: ['SBC'], rules: RULES, direct: [], toHub, fromHub });
  assert.deepEqual(opts.map((o) => o.id), ['20001+30002']);
  const o = opts[0];
  assert.equal(o.transfer.station.code, 'NGP');
  assert.equal(o.transfer.minutes, 120);
  assert.ok(o.warnings.some((w) => /Two tickets/.test(w)));
  assert.ok(!o.warnings.some((w) => /tight change/.test(w)), '2 h is a comfortable change');
  // 1 h 45 m: allowed (over the 90 min buffer) but flagged as tight.
  const tight = planReturn({
    drop, ready, stations: ['SBC'], rules: RULES, direct: [],
    toHub: [leg('20001', 'SBC', 'NGP', '2026-10-31T14:00', '2026-11-01T08:00')],
    fromHub: [leg('30009', 'NGP', 'R', '2026-11-01T09:45', '2026-11-01T14:00')],
  });
  assert.equal(tight[0].transfer.minutes, 105);
  assert.ok(tight[0].warnings.some((w) => /tight change at NGP stn: 1 h 45 m/.test(w)));
});

test('a change only where the first train arrives (a second train from another station is not a connection)', () => {
  const opts = planReturn({
    drop, ready, stations: ['SBC'], rules: RULES, direct: [],
    toHub: [leg('20001', 'SBC', 'NGP', '2026-10-31T14:00', '2026-11-01T08:00')],
    fromHub: [leg('30002', 'BPQ', 'R', '2026-11-01T10:00', '2026-11-01T14:30')],
  });
  assert.equal(opts.length, 0);
});

test('a live delay that eats the change makes the connection risky', () => {
  const opts = planReturn({
    drop, ready, stations: ['SBC'], rules: RULES, direct: [],
    toHub: [leg('20001', 'SBC', 'NGP', '2026-10-31T14:00', '2026-11-01T08:00', { delayMinutes: 75 })],
    fromHub: [leg('30002', 'NGP', 'R', '2026-11-01T10:00', '2026-11-01T14:30')],
  });
  assert.ok(opts[0].warnings.some((w) => /Risky: the first train is running 75 min late \(live\)/.test(w)));
  assert.equal(opts[0].scheduled, false);
});

test('the same train from two stations of the city is offered once, from the main station', () => {
  const opts = planReturn({
    drop, ready, stations: ['SMVB', 'YPR'], rules: RULES,
    direct: [
      leg('12345', 'YPR', 'R', '2026-10-31T23:40', '2026-11-02T00:05'),
      leg('12345', 'SMVB', 'R', '2026-10-31T23:10', '2026-11-02T00:05'),
    ],
  });
  assert.equal(opts.length, 1);
  assert.equal(opts[0].legs[0].from.code, 'SMVB');
});

test('the searches: direct on the day he is ready and the next; connections only through listed change stations', () => {
  assert.deepEqual(directQueries(['SBC', 'YPR'], 'R', ready), [
    { from: 'SBC', to: 'R', date: '2026-10-31' }, { from: 'YPR', to: 'R', date: '2026-10-31' },
    { from: 'SBC', to: 'R', date: '2026-11-01' }, { from: 'YPR', to: 'R', date: '2026-11-01' },
  ]);
  assert.equal(hubQueries(['SBC'], ['NGP'], 'R', ready).length, 2 + 3);
  // Ready at 00:30 on 1 Nov in India: the searches start on 1 Nov.
  assert.equal(directQueries(['SBC'], 'R', ist('2026-11-01T00:30'))[0].date, '2026-11-01');
});

/* ------------------------------------------------------- the lookup ---- */

const fake = (answers, calls = []) => async (queries, live) => {
  calls.push({ queries: queries.map((q) => `${q.from}-${q.to}-${q.date}`), live });
  return queries.map((q) => answers(q) ?? { ok: false, query: q, error: 'not-found' });
};

test('direct trains first: with a good direct train the change station is never searched', async () => {
  const calls = [];
  const res = await findReturn({
    fetcher: fake((q) => (q.to === 'R' && q.date === '2026-10-31' ? ok(q.from, q.to, q.date, [t('10003', '20:00', 1, '16:00', 2, 1200)]) : ok(q.from, q.to, q.date, [])), calls),
    stations: ['SBC'], hubs: ['NGP'], home: 'R', drop, ready, now: ist('2026-10-29T09:00'), rules: RULES,
  });
  assert.equal(res.status, 'ok');
  assert.deepEqual(res.options.map((o) => o.id), ['10003']);
  assert.equal(calls.length, 1, 'no connection searches');
  assert.equal(calls[0].live, false, 'two days ahead: no live status');
  assert.equal(res.checkedAt, ist('2026-10-30T10:00'));
});

test('no direct train: connections through Nagpur, both legs from the lookup', async () => {
  const calls = [];
  const res = await findReturn({
    fetcher: fake((q) => {
      if (q.from === 'SBC' && q.to === 'R') return ok(q.from, q.to, q.date, []);
      if (q.from === 'SBC' && q.to === 'NGP' && q.date === '2026-10-31') return ok(q.from, q.to, q.date, [t('20001', '14:00', 1, '08:00', 2, 1080)]);
      if (q.from === 'NGP' && q.to === 'R' && q.date === '2026-11-01') return ok(q.from, q.to, q.date, [t('30002', '10:00', 1, '14:30', 1, 270)]);
      return ok(q.from, q.to, q.date, []);
    }, calls),
    stations: ['SBC'], hubs: ['NGP'], home: 'R', drop, ready, now: ist('2026-10-29T09:00'), rules: RULES,
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(res.options.map((o) => o.id), ['20001+30002']);
  assert.equal(iso(res.options[0].arrive), '2026-11-01 14:30');
});

test('the API down or slow: status "error" with the reasons — no train is made up', async () => {
  const res = await findReturn({
    fetcher: async () => { throw new Error('offline'); },
    stations: ['SBC'], hubs: [], home: 'R', drop, ready, now: drop, rules: RULES,
  });
  assert.equal(res.status, 'error');
  assert.equal(res.options.length, 0);
  assert.ok(res.problems.every((p) => p.error === 'network'));
});

test('searches that worked but found nothing: status "none" (not an error)', async () => {
  const res = await findReturn({
    fetcher: fake((q) => ok(q.from, q.to, q.date, [])),
    stations: ['SBC'], hubs: [], home: 'R', drop, ready, now: drop, rules: RULES,
  });
  assert.equal(res.status, 'none');
});

test('some searches fail: the rest still count, and the failures are listed', async () => {
  const res = await findReturn({
    fetcher: fake((q) => (q.from === 'SBC' ? { ok: false, query: q, error: 'rate-limited' } : ok(q.from, q.to, q.date, q.date === '2026-10-31' ? [t('10003', '20:00', 1, '16:00', 2, 1200)] : []))),
    stations: ['SBC', 'YPR'], hubs: [], home: 'R', drop, ready, now: drop, rules: RULES,
  });
  assert.equal(res.status, 'ok');
  assert.equal(res.problems.filter((p) => p.error === 'rate-limited').length, 2);
});

test('live status is asked for only when he boards within the next 18 hours', async () => {
  const calls = [];
  await findReturn({ fetcher: fake((q) => ok(q.from, q.to, q.date, []), calls), stations: ['NGP'], hubs: [], home: 'R', drop, ready, now: drop - 3600_000, rules: RULES });
  assert.equal(calls[0].live, true);
});

/* -------------------------------------------------------- the client ---- */

const robotAnswer = (results) => ({ ok: true, source: 'RailRadar', results });
const robotTrain = { number: '12251', name: 'Test 12251', type: 'Express', runDays: ['tue', 'fri'], dep: '23:40', depDay: 1, arr: '00:05', arrDay: 3, duration: 1465, live: null };

test('the client reads the robot’s answer, and treats anything odd as a failed search', () => {
  const qs = [{ from: 'YPR', to: 'R', date: '2026-10-30' }, { from: 'SBC', to: 'R', date: '2026-10-30' }, { from: 'SMVB', to: 'R', date: '2026-10-30' }];
  const out = parseLookup(
    robotAnswer([
      { q: 'YPR-R-2026-10-30', ok: true, checkedAt: '2026-10-30T04:30:00.000Z', live: false, from: { code: 'YPR', name: 'Yesvantpur Jn' }, to: { code: 'R', name: 'Raipur Jn' }, trains: [robotTrain] },
      { q: 'SBC-R-2026-10-30', ok: false, error: 'busy' },
      { q: 'SMVB-R-2026-10-30', ok: true, checkedAt: 'not a date', trains: [] },
    ]),
    qs,
  );
  assert.deepEqual(out.map((r) => (r.ok ? 'ok' : r.error)), ['ok', 'busy', 'bad-response']);
  assert.equal(out[0].fromName, 'Yesvantpur Jn');
  const legs = legsFrom(out[0]).legs;
  assert.equal(iso(legs[0].arrive), '2026-11-01 00:05');
  assert.deepEqual(parseLookup({ ok: false, error: 'not-configured' }, qs).map((r) => r.error), ['not-configured', 'not-configured', 'not-configured']);
  assert.deepEqual(parseLookup('<html>', qs.slice(0, 1)).map((r) => r.error), ['bad-response']);
});

test('the client: one GET per batch, a time limit, and answers remembered for the session', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return { ok: true, json: async () => robotAnswer([{ q: 'YPR-R-2026-10-30', ok: true, checkedAt: '2026-10-30T04:30:00.000Z', live: false, trains: [robotTrain] }]) };
  };
  const fetcher = makeFetcher('https://script.google.com/macros/s/X/exec', { fetchImpl });
  const q = [{ from: 'YPR', to: 'R', date: '2026-10-30' }];
  const a = await fetcher(q, false);
  const b = await fetcher(q, false);
  assert.equal(urls.length, 1, 'the second ask comes from memory');
  assert.equal(urls[0], 'https://script.google.com/macros/s/X/exec?action=trains&q=YPR-R-2026-10-30&live=0');
  assert.equal(a[0].ok && b[0].ok, true);

  const slow = makeFetcher('https://x.example/exec', {
    timeoutMs: 20,
    fetchImpl: (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })))),
  });
  assert.equal((await slow(q, false))[0].error, 'timeout');
  const down = makeFetcher('https://x.example/exec', { fetchImpl: async () => ({ ok: false, json: async () => ({}) }) });
  assert.equal((await down(q, false))[0].error, 'unavailable');
  assert.equal((await makeFetcher('')(q, false))[0].error, 'not-configured');
});

/* ----------------------------------------------- pricing from the train ---- */

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

test('the way home from a train: whole hours from the drop, once, with the daily cap — never counted twice', () => {
  const plan = planTrip(rules, 1370, 'one-way', 0, { hours: 28 }, 7, true); // Bengaluru, day and night
  assert.equal(plan.homeBasis, 'allowance');
  // The train: leaves 12 h after the drop, home 24 h 25 m later.
  const train = withReturn(plan, plan.dropAt + 12, plan.dropAt + 36.42);
  assert.equal(train.homeBasis, 'train');
  assert.equal(train.returnHours, 37);
  const est = estimate(rules, train);
  assert.equal(est.returnCharge, returnCost(37, 120, 1200));
  assert.equal(est.returnCharge, 1200 + 1200, '24 h capped at ₹1,200, 13 h more capped at ₹1,200');
  // The driving is untouched by the train.
  assert.deepEqual([train.fullDays, train.extraHours], [plan.fullDays, plan.extraHours]);
  assert.equal(est.from, plan.fullDays * rules.dayRate.from + plan.extraHours * rules.extraHour + 2400);
});

test('a short wait and train: by the hour, under the cap', () => {
  const plan = planTrip(rules, 284, 'one-way', 0, { hours: 5 }, 7); // Nagpur
  const t2 = withReturn(plan, plan.dropAt + 3, plan.dropAt + 7.5); // the user's example: 3 h waiting + 4.5 h train
  assert.equal(t2.returnHours, 8);
  assert.equal(estimate(rules, t2).returnCharge, 1200, 'more than 6 h: a full day');
  const t3 = withReturn(plan, plan.dropAt + 2, plan.dropAt + 6);
  assert.equal(estimate(rules, t3).returnCharge, 6 * 120, 'up to 6 h: by the hour');
});

test('a train that does not get him home after the drop is ignored', () => {
  const plan = planTrip(rules, 284, 'one-way', 0, { hours: 5 }, 7);
  assert.equal(withReturn(plan, plan.dropAt - 2, plan.dropAt - 1), plan);
  assert.equal(withReturn(planTrip(rules, 300, 'round'), 1, 2).homeBasis, undefined);
});

test('the busy cap or any failed search is never reported as "no train"', async () => {
  const res = await findReturn({
    fetcher: async (qs) => qs.map((q) => (q.from === 'NGP' ? ok(q.from, q.to, q.date, []) : { ok: false, query: q, error: 'busy' })),
    stations: ['NDLS'], hubs: ['NGP'], home: 'R', drop, ready, now: drop, rules: RULES,
  });
  assert.equal(res.status, 'error');
  assert.ok(res.problems.some((p) => p.error === 'busy'));
});

test('routes ending on the same last train are offered once — the safest change', () => {
  const opts = planReturn({
    drop, ready, stations: ['SBC', 'YPR'], rules: RULES, direct: [],
    toHub: [
      leg('12213', 'YPR', 'NGP', '2026-10-31T23:40', '2026-11-01T16:15'),
      leg('22691', 'SBC', 'NGP', '2026-10-31T20:00', '2026-11-01T14:56'),
    ],
    fromHub: [
      leg('12833', 'NGP', 'R', '2026-11-01T18:05', '2026-11-01T23:15'),
      leg('12859', 'NGP', 'R', '2026-11-01T19:00', '2026-11-01T23:30'),
    ],
  });
  assert.deepEqual(opts.map((o) => o.legs.at(-1).train.number), ['12833', '12859']);
  assert.equal(opts[0].id, '22691+12833', '3 h 9 m to change beats 1 h 50 m');
});
