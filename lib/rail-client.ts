/**
 * The website's side of the train lookup: asks the alerts robot (its web app
 * URL, site-settings.ts `trains.lookupUrl`) for a batch of "trains between
 * stations" searches and checks every answer against the shape it promises.
 * The RailRadar key never reaches the browser — the robot holds it.
 *
 * No @/ imports, so scripts/rail.test.mjs runs it with a fake fetch.
 */

import { queryKey, type RailError, type RailFetcher, type RailQuery, type RailResult, type RawTrain } from './rail.ts';

const ERRORS: readonly RailError[] = [
  'not-configured',
  'not-found',
  'rate-limited',
  'busy',
  'unavailable',
  'bad-request',
  'bad-response',
  'timeout',
  'network',
];
const asError = (e: unknown): RailError => (ERRORS.includes(e as RailError) ? (e as RailError) : 'bad-response');

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function rawTrain(v: unknown): RawTrain | undefined {
  if (!isObj(v)) return undefined;
  const live = isObj(v.live) && typeof v.live.delayMinutes === 'number' ? { delayMinutes: v.live.delayMinutes } : null;
  return {
    number: String(v.number ?? ''),
    name: String(v.name ?? ''),
    ...(typeof v.type === 'string' && v.type && { type: v.type }),
    ...(Array.isArray(v.runDays) && { runDays: v.runDays.map(String) }),
    dep: String(v.dep ?? ''),
    depDay: Number(v.depDay),
    arr: String(v.arr ?? ''),
    arrDay: Number(v.arrDay),
    ...(typeof v.duration === 'number' && { duration: v.duration }),
    live,
  };
}

/**
 * The robot's JSON → one RailResult per query, in the order asked; anything
 * missing or odd is a failed search. `keyOf`: how the robot names each
 * search (a whole timetable is "SBC-R", without the date).
 */
export function parseLookup(json: unknown, queries: RailQuery[], keyOf: (q: RailQuery) => string = queryKey): RailResult[] {
  if (!isObj(json)) return queries.map((query) => ({ ok: false, query, error: 'bad-response' }));
  if (json.ok !== true) return queries.map((query) => ({ ok: false, query, error: asError(json.error) }));
  const list = Array.isArray(json.results) ? json.results : [];
  const byKey = new Map<string, Obj>();
  for (const r of list) if (isObj(r) && typeof r.q === 'string') byKey.set(r.q, r);
  return queries.map((query): RailResult => {
    const r = byKey.get(keyOf(query));
    if (!r) return { ok: false, query, error: 'bad-response' };
    if (r.ok !== true) return { ok: false, query, error: asError(r.error) };
    const checkedAt = Date.parse(String(r.checkedAt ?? ''));
    if (!Number.isFinite(checkedAt) || !Array.isArray(r.trains)) return { ok: false, query, error: 'bad-response' };
    const name = (side: unknown) => (isObj(side) && typeof side.name === 'string' && side.name ? side.name : undefined);
    const fromName = name(r.from);
    const toName = name(r.to);
    return {
      ok: true,
      query,
      checkedAt,
      live: r.live === true,
      ...(r.timetable === true && { timetable: true }),
      ...(fromName && { fromName }),
      ...(toName && { toName }),
      trains: r.trains.map(rawTrain).filter((t): t is RawTrain => Boolean(t)),
    };
  });
}

/** "SBC-R": the robot's name for a whole timetable (no date). */
export const pairKey = (q: Pick<RailQuery, 'from' | 'to'>) => `${q.from}-${q.to}`;

/** Failures worth asking again a little later: a cap, a slow or lost answer. */
export const RETRYABLE: readonly RailError[] = ['busy', 'rate-limited', 'timeout', 'network', 'unavailable'];

/**
 * A fetcher for findReturn: one GET to the robot per batch, with a time
 * limit (Apps Script can take a few seconds), answers remembered for the
 * session so changing the time back and forth does not ask again.
 *
 * Without live status it asks for whole timetables ("SBC-R": every train
 * with its running days), one per station pair whatever the date, and
 * answers each dated search from them — legsFrom keeps only the trains that
 * run that day. So a customer trying dates, and every other customer on the
 * same route, costs no more calls (the robot caches each timetable for 6
 * hours). A robot without timetables (before its update) answers
 * 'bad-request'; then it asks by date, as before.
 */
export function makeFetcher(
  endpoint: string,
  { fetchImpl = globalThis.fetch, timeoutMs = 20_000 }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): RailFetcher {
  const memo = new Map<string, RailResult>();
  let timetables = true;

  /** One GET for `keys` (the robot's names); every key gets an answer, ok or failed. */
  const ask = async (todo: RailQuery[], keyOf: (q: RailQuery) => string, live: boolean): Promise<RailResult[]> => {
    const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}action=trains&q=${encodeURIComponent(todo.map(keyOf).join(','))}&live=${live ? 1 : 0}`;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timer = setTimeout(() => ctrl?.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { method: 'GET', ...(ctrl && { signal: ctrl.signal }) });
      if (!res.ok) return todo.map((query) => ({ ok: false, query, error: 'unavailable' }));
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return parseLookup(json, todo, keyOf);
    } catch (err) {
      const aborted = (err as { name?: string })?.name === 'AbortError';
      return todo.map((query) => ({ ok: false, query, error: aborted ? 'timeout' : 'network' }));
    } finally {
      clearTimeout(timer);
    }
  };

  /** Dated searches, as before (and always for live status, which needs the day). */
  const byDate = async (queries: RailQuery[], live: boolean): Promise<RailResult[]> => {
    const memoKey = (q: RailQuery) => `${queryKey(q)}:${live}`;
    const todo = queries.filter((q) => !memo.has(memoKey(q)));
    const failed = new Map<string, RailResult>();
    if (todo.length) {
      const results = await ask(todo, queryKey, live);
      // Remember only real answers; a failure is asked again next time.
      for (const r of results) (r.ok ? memo.set(memoKey(r.query), r) : failed.set(queryKey(r.query), r));
    }
    return queries.map((q) => memo.get(memoKey(q)) ?? failed.get(queryKey(q))!);
  };

  /** Whole timetables, one per pair, used for each dated search; null when the robot cannot do them. */
  const byTimetable = async (queries: RailQuery[]): Promise<RailResult[] | null> => {
    const memoKey = (q: Pick<RailQuery, 'from' | 'to'>) => `tt:${pairKey(q)}`;
    const pairs = [...new Map(queries.map((q) => [pairKey(q), { from: q.from, to: q.to, date: '' }])).values()];
    const todo = pairs.filter((p) => !memo.has(memoKey(p)));
    const failed = new Map<string, RailResult>();
    if (todo.length) {
      const results = await ask(todo, pairKey, false);
      // A robot from before timetables turns the whole request down as a bad request.
      if (results.length && results.every((r) => !r.ok && r.error === 'bad-request')) return null;
      for (const r of results) (r.ok ? memo.set(memoKey(r.query), r) : failed.set(pairKey(r.query), r));
    }
    return queries.map((query): RailResult => {
      const r = memo.get(memoKey(query)) ?? failed.get(pairKey(query))!;
      return r.ok ? { ...r, query, timetable: true } : { ok: false, query, error: r.error };
    });
  };

  return async (queries, live) => {
    if (!endpoint) return queries.map((query) => ({ ok: false, query, error: 'not-configured' }));
    if (!live && timetables) {
      const answers = await byTimetable(queries);
      if (answers) return answers;
      timetables = false;
    }
    return byDate(queries, live);
  };
}
