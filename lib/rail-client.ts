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

/** The robot's JSON → one RailResult per query, in the order asked; anything missing or odd is a failed search. */
export function parseLookup(json: unknown, queries: RailQuery[]): RailResult[] {
  if (!isObj(json)) return queries.map((query) => ({ ok: false, query, error: 'bad-response' }));
  if (json.ok !== true) return queries.map((query) => ({ ok: false, query, error: asError(json.error) }));
  const list = Array.isArray(json.results) ? json.results : [];
  const byKey = new Map<string, Obj>();
  for (const r of list) if (isObj(r) && typeof r.q === 'string') byKey.set(r.q, r);
  return queries.map((query): RailResult => {
    const r = byKey.get(queryKey(query));
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
      ...(fromName && { fromName }),
      ...(toName && { toName }),
      trains: r.trains.map(rawTrain).filter((t): t is RawTrain => Boolean(t)),
    };
  });
}

/**
 * A fetcher for findReturn: one GET to the robot per batch, with a time limit
 * (Apps Script can take a few seconds), and answers remembered for the
 * session so changing the time back and forth does not ask again.
 */
export function makeFetcher(
  endpoint: string,
  { fetchImpl = globalThis.fetch, timeoutMs = 20_000 }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): RailFetcher {
  const memo = new Map<string, RailResult>();
  return async (queries, live) => {
    if (!endpoint) return queries.map((query) => ({ ok: false, query, error: 'not-configured' }));
    const todo = queries.filter((q) => !memo.has(`${queryKey(q)}:${live}`));
    if (todo.length) {
      const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}action=trains&q=${encodeURIComponent(todo.map(queryKey).join(','))}&live=${live ? 1 : 0}`;
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
      const timer = setTimeout(() => ctrl?.abort(), timeoutMs);
      let results: RailResult[];
      try {
        const res = await fetchImpl(url, { method: 'GET', ...(ctrl && { signal: ctrl.signal }) });
        if (!res.ok) results = todo.map((query) => ({ ok: false, query, error: 'unavailable' }));
        else {
          let json: unknown;
          try {
            json = await res.json();
          } catch {
            json = null;
          }
          results = parseLookup(json, todo);
        }
      } catch (err) {
        const aborted = (err as { name?: string })?.name === 'AbortError';
        results = todo.map((query) => ({ ok: false, query, error: aborted ? 'timeout' : 'network' }));
      } finally {
        clearTimeout(timer);
      }
      // Remember only real answers; a failure is asked again next time.
      for (const r of results) if (r.ok) memo.set(`${queryKey(r.query)}:${live}`, r);
      const failed = new Map(results.filter((r) => !r.ok).map((r) => [queryKey(r.query), r]));
      return queries.map((q) => memo.get(`${queryKey(q)}:${live}`) ?? failed.get(queryKey(q))!);
    }
    return queries.map((q) => memo.get(`${queryKey(q)}:${live}`)!);
  };
}
