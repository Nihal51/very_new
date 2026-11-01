'use client';

import { useEffect, useMemo, useState } from 'react';

import { findReturn, type ReturnLookup, type ReturnOption } from '@/lib/rail';
import { makeFetcher, RETRYABLE } from '@/lib/rail-client';
import { railLookupUrl, railRules } from '@/lib/settings';
import { railInput, withTrain, type TripView } from '@/lib/trip';

/**
 * Where the train lookup is for a trip:
 *   off         not a one-way drop on a train route (round trips, bus routes)
 *   need-date   a train route, but no date picked yet
 *   not-set-up  no robot address in site-settings.ts (trains.lookupUrl)
 *   loading     asking
 *   ok          trains found (the estimate uses the chosen one)
 *   none        the searches worked but found no train home in the window
 *   error       nothing could be checked (API down, quota, network)
 */
export type ReturnStatus = 'off' | 'need-date' | 'not-set-up' | 'loading' | 'ok' | 'none' | 'error';

export type ReturnTrains = {
  status: ReturnStatus;
  /** Still 'loading': the train service was busy or slow, and it is asking again. */
  retrying: boolean;
  lookup?: ReturnLookup;
  options: ReturnOption[];
  selected?: ReturnOption;
  select: (id: string) => void;
  /** The trip with the chosen train applied (or as it was, on the typical time). */
  view: TripView | null;
};

/**
 * The real trains home for the trip's drop, looked up whenever the
 * destination, pickup city, date, time or day-and-night choice changes
 * (after a short pause, so typing a time does not fire a search per key).
 * The first route is recommended; the customer can pick another, and the
 * estimate follows.
 */
/** Waits before asking again when the train service was busy or slow: past the robot's per-minute cap, then once more. */
const RETRY_DELAYS = [20_000, 45_000];

export function useReturnTrains(view: TripView | null, city: string): ReturnTrains {
  const fetcher = useMemo(() => makeFetcher(railLookupUrl), []);
  const input = view ? railInput(view, city) : undefined;
  const key = input ? `${input.stations.join('.')}>${input.home}@${input.drop}` : '';
  const [result, setResult] = useState<{ key: string; lookup: ReturnLookup } | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [chosen, setChosen] = useState<{ key: string; id: string } | null>(null);

  useEffect(() => {
    if (!input || !railLookupUrl) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    // A busy or slow answer is asked again — after the robot's minute has passed — before
    // the customer is told the trains could not be checked. Answers already in stay remembered.
    const attempt = async (n: number) => {
      const lookup = await findReturn({ fetcher, ...input, now: Date.now(), rules: railRules });
      if (!alive) return;
      const errors = lookup.problems.flatMap((p) => (p.error ? [p.error] : []));
      const retry = lookup.status === 'error' && errors.length > 0 && errors.every((e) => RETRYABLE.includes(e));
      if (retry && n < RETRY_DELAYS.length) {
        setRetrying(key);
        timer = setTimeout(() => void attempt(n + 1), RETRY_DELAYS[n]);
        return;
      }
      setRetrying(null);
      setResult({ key, lookup });
    };
    timer = setTimeout(() => void attempt(0), 500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // `input` is fully described by `key`.
  }, [key, fetcher]);

  const onTrainRoute = Boolean(view && view.kind === 'one-way' && view.dest?.rail && view.plan);
  const lookup = result && result.key === key ? result.lookup : undefined;
  const options = lookup?.options ?? [];
  const selected = options.find((o) => o.id === (chosen?.key === key ? chosen.id : undefined)) ?? options[0];

  const status: ReturnStatus = !onTrainRoute
    ? 'off'
    : !input
      ? 'need-date'
      : !railLookupUrl
        ? 'not-set-up'
        : !lookup
          ? 'loading'
          : lookup.status;

  return {
    status,
    retrying: status === 'loading' && retrying === key,
    ...(lookup && { lookup }),
    options,
    ...(selected && { selected }),
    select: (id) => setChosen({ key, id }),
    view: view && selected ? withTrain(view, selected) : view,
  };
}
