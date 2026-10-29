/**
 * The driver's train home after a one-way drop, from REAL timetable data:
 * RailRadar's "trains between stations" search for a date, fetched by the
 * alerts robot (apps-script/Code.js, which holds the API key) and planned
 * here. No train, time or running day is typed into this code — if the
 * lookup cannot confirm a train, the caller shows a warning and a link to
 * check by hand instead.
 *
 * All times are India time (Asia/Kolkata, UTC+5:30, no daylight saving),
 * worked out from the date and the HH:MM the timetable gives, plus its day
 * numbers for trains that arrive after midnight — never from the computer's
 * own time zone.
 *
 * Pure: no Firebase and no @/ imports, so Node tests (scripts/rail.test.mjs)
 * run it as it is. The fetching is in lib/rail-client.ts.
 */

/* ---------------------------------------------------------------- time ---- */

const IST_MS = 330 * 60_000;

const dateRe = /^(\d{4})-(\d{2})-(\d{2})$/;
const timeRe = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "2026-10-31" + "23:40" (India time), `plusDays` later → the instant (epoch ms); undefined if either is not valid. */
export function istInstant(date: string, hhmm: string, plusDays = 0): number | undefined {
  const d = dateRe.exec(date ?? '');
  const t = timeRe.exec(hhmm ?? '');
  if (!d || !t || !Number.isInteger(plusDays)) return undefined;
  const [, y, m, day] = d.map(Number) as [number, number, number, number];
  const utc = Date.UTC(y, m - 1, day + plusDays, Number(t[1]), Number(t[2]));
  // Date.UTC rolls 31 Feb over to March: refuse dates that do not exist.
  const check = new Date(Date.UTC(y, m - 1, day));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== day) return undefined;
  return utc - IST_MS;
}

/** An instant → its date in India ("2026-10-31"). */
export function istDate(ms: number): string {
  return new Date(ms + IST_MS).toISOString().slice(0, 10);
}

/** "2026-10-31" + 1 → "2026-11-01". */
export function addDays(date: string, n: number): string {
  const d = dateRe.exec(date);
  if (!d) return date;
  return new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]) + n)).toISOString().slice(0, 10);
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
/** "2026-10-31" → "sat". */
export const weekdayOf = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;

/* ---------------------------------------------------------- the lookup ---- */

/** One "trains between stations" search: from and to station codes, and the date the train leaves `from`. */
export type RailQuery = { from: string; to: string; date: string };

export const queryKey = (q: RailQuery) => `${q.from}-${q.to}-${q.date}`;

const codeRe = /^[A-Z]{1,5}$/;
export const isStationCode = (s: string) => codeRe.test(s);

/** A train as the robot passes it on (RailRadar's documented fields, nothing added). */
export type RawTrain = {
  number: string;
  name: string;
  type?: string;
  /** Days the train leaves its FIRST station: "mon" … "sun". */
  runDays?: string[];
  /** HH:MM at `from`, and the day of the train's run (1 = the day it started). */
  dep: string;
  depDay: number;
  /** HH:MM at `to`, and its day of the run. */
  arr: string;
  arrDay: number;
  /** Minutes from `from` to `to`. */
  duration?: number;
  /** Live status at `from`, only when the robot asked for it (today's run) and got it. */
  live?: { delayMinutes?: number } | null;
};

export type RailError =
  | 'not-configured' // no API key on the robot, or no robot address on the website
  | 'not-found' // a station or route the API does not know
  | 'rate-limited' // the API's quota or burst limit
  | 'busy' // the robot's own per-minute / per-day cap
  | 'unavailable' // the API is down or answered with an error
  | 'bad-request'
  | 'bad-response' // an answer that is not the documented shape
  | 'timeout'
  | 'network';

/** One search's answer from the robot. `checkedAt`: when the API was asked (a cached answer keeps that time). */
export type RailResult =
  | {
      ok: true;
      query: RailQuery;
      checkedAt: number;
      /** Live status was asked for and is in `trains[].live`. */
      live: boolean;
      fromName?: string;
      toName?: string;
      trains: RawTrain[];
    }
  | { ok: false; query: RailQuery; error: RailError };

export type RailStation = { code: string; name: string };

/** One train ride, with real instants. */
export type RailLeg = {
  train: { number: string; name: string; type?: string };
  from: RailStation;
  to: RailStation;
  /** Scheduled departure and arrival (timetable). */
  depart: number;
  arrive: number;
  /** Live delay at the boarding station, only when the API returned live data for this run. */
  delayMinutes?: number;
  /** When the data was fetched from the API. */
  checkedAt: number;
};

/** Why a train in an answer was left out (shown to the team; never silently dropped). */
export type DroppedTrain = { number: string; reason: string };

/**
 * An answer → train rides with real instants. A train is left out (and listed
 * in `dropped`) if its times are not valid HH:MM, its day numbers go
 * backwards, its arrival is not after its departure, its duration disagrees
 * with its times by more than 10 minutes, or its running days say it does not
 * run on the date asked.
 */
export function legsFrom(result: RailResult): { legs: RailLeg[]; dropped: DroppedTrain[] } {
  const legs: RailLeg[] = [];
  const dropped: DroppedTrain[] = [];
  if (!result.ok) return { legs, dropped };
  const { query } = result;
  for (const t of result.trains ?? []) {
    const number = String(t?.number ?? '').trim();
    const name = String(t?.name ?? '').trim();
    const drop = (reason: string) => dropped.push({ number: number || '?', reason });
    if (!/^\d{4,5}$/.test(number) || !name) {
      drop('no train number or name');
      continue;
    }
    if (!Number.isInteger(t.depDay) || !Number.isInteger(t.arrDay) || t.depDay < 1 || t.arrDay < t.depDay || t.arrDay > 8) {
      drop('day numbers missing or out of order');
      continue;
    }
    const depart = istInstant(query.date, t.dep);
    const arrive = istInstant(query.date, t.arr, t.arrDay - t.depDay);
    if (depart === undefined || arrive === undefined) {
      drop('times missing or not HH:MM');
      continue;
    }
    if (arrive <= depart) {
      drop('arrives before it leaves');
      continue;
    }
    if (typeof t.duration === 'number' && Number.isFinite(t.duration) && Math.abs((arrive - depart) / 60_000 - t.duration) > 10) {
      drop('duration does not match the times');
      continue;
    }
    if (Array.isArray(t.runDays) && t.runDays.length > 0) {
      const started = addDays(query.date, -(t.depDay - 1));
      const days = t.runDays.map((d) => String(d).toLowerCase().slice(0, 3));
      if (!days.includes(weekdayOf(started))) {
        drop(`does not run on ${weekdayOf(started)}`);
        continue;
      }
    }
    const delay = result.live && t.live && typeof t.live.delayMinutes === 'number' && Number.isFinite(t.live.delayMinutes)
      ? Math.max(0, Math.round(t.live.delayMinutes))
      : undefined;
    legs.push({
      train: { number, name, ...(t.type && { type: String(t.type) }) },
      from: { code: query.from, name: result.fromName || query.from },
      to: { code: query.to, name: result.toName || query.to },
      depart,
      arrive,
      ...(delay !== undefined && { delayMinutes: delay }),
      checkedAt: result.checkedAt,
    });
  }
  return { legs, dropped };
}

/* ------------------------------------------------------------ planning ---- */

export type RailRules = {
  /** The least time to change trains, minutes. */
  transferBufferMinutes: number;
  /** A longer wait at the change is not counted as a connection, hours. */
  maxTransferHours: number;
  /** A direct train leaving within this many hours after he is at the station counts; otherwise look for a change. */
  directWithinHours: number;
  /** Trains leaving later than this after he is ready are not offered, hours. */
  maxWaitHours: number;
  /** How many routes to offer. */
  maxOptions: number;
};

export type ReturnOption = {
  /** "12345", or "12345+67890" with a change of train. */
  id: string;
  legs: RailLeg[];
  /** First train's departure and last train's scheduled arrival. */
  depart: number;
  arrive: number;
  /** With a live delay, when known; otherwise the scheduled arrival. */
  expectedArrive: number;
  /** A change of train, with the minutes between arriving and leaving. */
  transfer?: { station: RailStation; minutes: number };
  /** From the drop to the first train leaving (getting to the station included). */
  waitMinutes: number;
  /** From the drop until he is home (scheduled). */
  totalMinutes: number;
  /** The times are only from the timetable (no live data for these runs). */
  scheduled: boolean;
  /** Why to be careful with this route — never empty silence about a risk. */
  warnings: string[];
};

const minutes = (ms: number) => Math.round(ms / 60_000);
const hm = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min - h * 60;
  return h && m ? `${h} h ${m} m` : h ? `${h} h` : `${m} m`;
};

/** The same train from two boarding stations: keep the one from the first station listed (the main one). */
function dedupe(legs: RailLeg[], order: string[]): RailLeg[] {
  const best = new Map<string, RailLeg>();
  for (const l of legs) {
    const k = `${l.train.number}@${l.arrive}`;
    const had = best.get(k);
    if (!had || order.indexOf(l.from.code) < order.indexOf(had.from.code)) best.set(k, l);
  }
  return [...best.values()];
}

/**
 * The routes home: direct trains first; connections only through a change
 * station whose BOTH trains came back from the lookup (so the API confirmed
 * each stops there), with at least transferBufferMinutes and at most
 * maxTransferHours between them. Sorted by when he gets home, a direct train
 * first when two arrive together.
 *
 * `drop`: when he hands over the car; `ready`: when he can board (drop +
 * getting to the station). `stations`: the destination's stations in order of
 * preference.
 */
export function planReturn(input: {
  drop: number;
  ready: number;
  direct: RailLeg[];
  toHub?: RailLeg[];
  fromHub?: RailLeg[];
  stations: string[];
  rules: RailRules;
}): ReturnOption[] {
  const { drop, ready, rules } = input;
  const latest = ready + rules.maxWaitHours * 3_600_000;
  const usable = (l: RailLeg) => l.depart >= ready && l.depart <= latest;
  const options: ReturnOption[] = [];

  for (const l of dedupe(input.direct.filter(usable), input.stations)) {
    options.push(option([l], drop));
  }

  const buffer = rules.transferBufferMinutes * 60_000;
  const maxGap = rules.maxTransferHours * 3_600_000;
  for (const a of dedupe((input.toHub ?? []).filter(usable), input.stations)) {
    for (const b of input.fromHub ?? []) {
      if (b.from.code !== a.to.code) continue; // the change must be at the station the first train reaches
      if (b.train.number === a.train.number) continue; // the same train: that is a direct train
      const gap = b.depart - a.arrive;
      if (gap < buffer || gap > maxGap) continue;
      options.push(option([a, b], drop, rules));
    }
  }

  // Routes that end on the same last train get him home at the same time and
  // cost the same: offer that ending once — direct if there is one, else the
  // change with the most time between the trains (the safest).
  const seen = new Set<string>();
  const last = (o: ReturnOption) => {
    const l = o.legs[o.legs.length - 1]!;
    return `${l.train.number}@${l.arrive}`;
  };
  return options
    .sort(
      (x, y) =>
        x.arrive - y.arrive ||
        x.legs.length - y.legs.length ||
        (y.transfer?.minutes ?? 0) - (x.transfer?.minutes ?? 0) ||
        y.depart - x.depart,
    )
    .filter((o) => (seen.has(last(o)) ? false : (seen.add(last(o)), true)))
    .slice(0, Math.max(1, rules.maxOptions));
}

function option(legs: RailLeg[], drop: number, rules?: RailRules): ReturnOption {
  const first = legs[0]!;
  const last = legs[legs.length - 1]!;
  const warnings: string[] = [];
  const wait = minutes(first.depart - drop);
  if (wait > 8 * 60) warnings.push(`A long wait at the station: ${hm(wait)} after the drop.`);

  let transfer: ReturnOption['transfer'];
  // A live delay at the last train's boarding station carries on to its arrival (it may make some up, or lose more).
  const expectedArrive = last.arrive + (last.delayMinutes ?? 0) * 60_000;
  if (legs.length === 2) {
    const [a, b] = legs as [RailLeg, RailLeg];
    const gap = minutes(b.depart - a.arrive);
    transfer = { station: a.to, minutes: gap };
    const buffer = rules?.transferBufferMinutes ?? 0;
    if (gap < buffer + 30) warnings.push(`A tight change at ${a.to.name}: ${hm(gap)} between the trains.`);
    if (a.delayMinutes !== undefined && b.depart - (a.arrive + a.delayMinutes * 60_000) < buffer * 60_000)
      warnings.push(`Risky: the first train is running ${a.delayMinutes} min late (live), which leaves too little time to change.`);
    warnings.push(`Two tickets: book both trains; the change at ${a.to.name} is not protected if the first train is late.`);
  }
  return {
    id: legs.map((l) => l.train.number).join('+'),
    legs,
    depart: first.depart,
    arrive: last.arrive,
    expectedArrive,
    ...(transfer && { transfer }),
    waitMinutes: wait,
    totalMinutes: minutes(last.arrive - drop),
    scheduled: legs.every((l) => l.delayMinutes === undefined),
    warnings,
  };
}

/* ------------------------------------------------------------- queries ---- */

/**
 * The searches for a drop: direct trains from each of the destination's
 * stations home, on the day he is ready and the next. Connections are only
 * looked up when no direct train leaves within directWithinHours
 * (hubQueries) — fewer calls on the API's quota.
 */
export function directQueries(stations: string[], home: string, ready: number): RailQuery[] {
  const day = istDate(ready);
  return [0, 1].flatMap((n) => stations.map((from) => ({ from, to: home, date: addDays(day, n) })));
}

export function hubQueries(stations: string[], hubs: string[], home: string, ready: number): RailQuery[] {
  const day = istDate(ready);
  const out: RailQuery[] = [];
  for (const hub of hubs) {
    for (const n of [0, 1]) for (const from of stations) out.push({ from, to: hub, date: addDays(day, n) });
    // The train on from the change can leave up to two days later (overnight first train, long wait).
    for (const n of [0, 1, 2]) out.push({ from: hub, to: home, date: addDays(day, n) });
  }
  return out;
}

/** True when a direct train leaves within directWithinHours after he is ready. */
export const hasGoodDirect = (direct: RailLeg[], ready: number, rules: RailRules) =>
  direct.some((l) => l.depart >= ready && l.depart <= ready + rules.directWithinHours * 3_600_000);

/* ------------------------------------------------------------ the lookup -- */

export type ReturnLookup = {
  status: 'ok' | 'none' | 'error';
  options: ReturnOption[];
  /** Searches that failed, and trains left out because their data did not add up. */
  problems: { query?: RailQuery; error?: RailError; dropped?: DroppedTrain[] }[];
  /** When the oldest answer used was fetched. */
  checkedAt?: number;
  /** Any live data was used. */
  live: boolean;
};

/** Ask the robot for a batch of searches. Implemented by lib/rail-client.ts (fetch) and by the tests (a fake). */
export type RailFetcher = (queries: RailQuery[], live: boolean) => Promise<RailResult[]>;

/**
 * The whole lookup for a drop: direct trains first; if none leaves soon
 * enough, connections through the destination's change stations. Any search
 * that fails is reported in `problems`; status 'none' only when EVERY search
 * worked and found no route, 'error' when nothing was found and any search
 * failed (so "no train" is never said about a search that did not happen).
 */
export async function findReturn(args: {
  fetcher: RailFetcher;
  stations: string[];
  hubs: string[];
  home: string;
  drop: number;
  ready: number;
  now: number;
  rules: RailRules;
}): Promise<ReturnLookup> {
  const { fetcher, stations, hubs, home, drop, ready, now, rules } = args;
  const valid = stations.filter(isStationCode);
  if (!isStationCode(home) || valid.length === 0) return { status: 'error', options: [], problems: [{ error: 'bad-request' }], live: false };
  // Live running status only means something for a train leaving today or tomorrow morning.
  const live = ready - now < 18 * 3_600_000;

  const problems: ReturnLookup['problems'] = [];
  const checked: number[] = [];
  let anyLive = false;
  const run = async (queries: RailQuery[]) => {
    let answers: RailResult[] = [];
    try {
      answers = await fetcher(queries, live);
    } catch {
      answers = [];
    }
    // One answer per search, matched by its stations and date; a search with no answer counts as failed.
    const byKey = new Map((Array.isArray(answers) ? answers : []).filter((r) => r?.query).map((r) => [queryKey(r.query), r]));
    const results: RailResult[] = queries.map(
      (query) => byKey.get(queryKey(query)) ?? { ok: false as const, query, error: answers.length ? ('bad-response' as const) : ('network' as const) },
    );
    const legs: RailLeg[] = [];
    for (const r of results) {
      if (!r.ok) {
        problems.push({ query: r.query, error: r.error });
        continue;
      }
      checked.push(r.checkedAt);
      anyLive ||= r.live;
      const out = legsFrom(r);
      legs.push(...out.legs);
      if (out.dropped.length) problems.push({ query: r.query, dropped: out.dropped });
    }
    return { legs, failed: results.some((r) => !r.ok) };
  };

  const direct = await run(directQueries(valid, home, ready));
  let toHub: RailLeg[] = [];
  let fromHub: RailLeg[] = [];
  let failed = direct.failed;
  const hubCodes = hubs.filter(isStationCode).filter((h) => h !== home && !valid.includes(h));
  if (hubCodes.length && !hasGoodDirect(direct.legs, ready, rules)) {
    const hubbed = await run(hubQueries(valid, hubCodes, home, ready));
    failed ||= hubbed.failed;
    toHub = hubbed.legs.filter((l) => hubCodes.includes(l.to.code));
    fromHub = hubbed.legs.filter((l) => hubCodes.includes(l.from.code));
  }

  const options = planReturn({ drop, ready, direct: direct.legs, toHub, fromHub, stations: valid, rules });
  return {
    // "No train" only when every search worked; a search that failed means "could not check".
    status: options.length ? 'ok' : failed ? 'error' : 'none',
    options,
    problems,
    ...(checked.length && { checkedAt: Math.min(...checked) }),
    live: anyLive && options.some((o) => !o.scheduled),
  };
}
