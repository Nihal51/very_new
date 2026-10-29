import type { ReactNode } from 'react';

import type { ReturnTrains } from '@/components/useReturnTrains';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import type { ReturnOption } from '@/lib/rail';
import { priceText, rupeeRange, rupees, settings, tripRules } from '@/lib/settings';
import {
  estimateLines,
  hmText,
  kmText,
  notIncluded,
  startText,
  tripDays,
  tripTimeline,
  whenText,
  type TripView,
} from '@/lib/trip';

/** Where anyone can check a train or book a ticket themselves. */
const NTES = 'https://enquiry.indianrail.gov.in/mntes/';
const IRCTC = 'https://www.irctc.co.in/nget/train-search';

/**
 * The live estimate under the destination picker on the booking form, for
 * outstation trips and one-way drops. The figures come from lib/outstation.ts
 * and site-settings.ts; the team confirms the exact price on the call.
 */
export function TripEstimate({
  view,
  city,
  elsewhere,
  onUseLocal,
  rail,
  className,
}: {
  view: TripView;
  city: string;
  /** "Somewhere else" was picked. */
  elsewhere: boolean;
  /** Switches the form to the Local Full Day package. */
  onUseLocal: () => void;
  /** The train lookup for a one-way drop (useReturnTrains); `view` already has the chosen train applied. */
  rail?: ReturnTrains;
  className?: string;
}) {
  const oneWay = view.kind === 'one-way';
  const dayRate = `${priceText.outstation} a day`;
  const returnRate = `his way home from the drop, ${priceText.outstationReturnRule}`;

  let body: ReactNode;
  if (!city) {
    body = <p className="text-fg-muted">Choose your city above to see the estimate.</p>;
  } else if (elsewhere) {
    body = (
      <p className="text-fg-muted">
        We work out the distance and call you with the price: {dayRate}
        {oneWay ? <>, plus {returnRate}</> : null}.
      </p>
    );
  } else if (!view.dest) {
    body = <p className="text-fg-muted">Choose where you are going to see the estimate.</p>;
  } else if (view.sameCity) {
    body = (
      <p className="text-fg-muted">
        That is your pickup city. For driving around {city}, a local package is the right one.{' '}
        <LocalButton onClick={onUseLocal} />
      </p>
    );
  } else if (view.est && view.plan) {
    const lines = estimateLines(view);
    const timeline = tripTimeline(view, city);
    body = (
      <>
        <p className="text-fg-subtle text-xs font-semibold tracking-wide uppercase">Estimated price</p>
        <p className="tabular font-display mt-1 text-2xl font-bold">{rupeeRange(view.est.from, view.est.to)}</p>
        <p className="text-fg-muted mt-1">
          {city} → {view.dest.name} · about {kmText(view.km)} one way · {tripDays(view)}
        </p>
        <ul className="border-border mt-3 flex flex-col gap-1.5 border-t pt-3">
          {lines.map((l) => (
            <li key={l.label} className="flex justify-between gap-4">
              <span className="text-fg-muted">{l.label}</span>
              <span className="tabular font-semibold whitespace-nowrap">{l.amount}</span>
            </li>
          ))}
        </ul>
        {rail && rail.status !== 'off' && <TrainsHome rail={rail} view={view} city={city} />}
        <div className="border-border mt-3 border-t pt-3">
          <p className="text-fg-subtle text-xs font-semibold tracking-wide uppercase">Not in this price</p>
          <ul className="text-fg-muted mt-1 list-disc pl-5 text-[0.8125rem]">
            {notIncluded(view).map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
        {timeline.length > 0 && (
          <div className="border-border mt-3 border-t pt-3">
            <p className="text-fg-subtle text-xs font-semibold tracking-wide uppercase">
              The driver’s trip{view.startKnown ? '' : `, leaving at ${startText(view)}`}
            </p>
            <dl className="mt-2 grid gap-1 text-[0.8125rem]">
              {timeline.map((r) => (
                <div key={r.label} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <dt className="text-fg-muted">{r.label}</dt>
                  <dd className="tabular ml-auto text-right font-medium">{r.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {view.plan.local && (
          <p className="bg-bg-subtle mt-3 rounded-lg p-3">
            {view.dest.name} is only about {kmText(view.km)} away — a Local Full Day ({priceText.fullDay}{' '}
            for 8 hours) usually costs less. <LocalButton onClick={onUseLocal} />
          </p>
        )}
      </>
    );
  }

  return (
    <div
      className={cn('border-border bg-bg rounded-xl border p-4 text-sm', className)}
      aria-live="polite"
      aria-atomic="true"
    >
      {body}
      <div className="bg-bg-subtle text-fg-muted mt-3 rounded-lg p-3 text-[0.8125rem] leading-relaxed">
        <p className="text-fg font-semibold">How the time is counted, in simple words</p>
        {oneWay ? (
          <ul className="mt-1 list-disc pl-5">
            <li>
              Driving: every {priceText.outstationHours} of driving is one day ({priceText.outstation}). Hours left
              over: up to {settings.outstation.extraFullDayAfterHours} are {rupees(tripRules.extraHour)} each; more than{' '}
              {settings.outstation.extraFullDayAfterHours} count as one more full day. A drive shorter than that is by
              the hour.
            </li>
            <li>
              After he hands over the car, the time until he is home counts — <strong>waiting for his train
              too</strong>: each 24 hours is {priceText.outstationReturnMax}; the hours left over are{' '}
              {priceText.outstationReturnHour} each, and more than {settings.outstation.returnFullDayAfterHours} hours
              count as a full day ({priceText.outstationReturnMax}). So 56 hours = 2 days + 8 hours = 3 days. For example: he drops the car on 2 Oct at 12 PM and his train leaves at 3 PM — that is 3 hours of
              waiting, then the hours on the train until he reaches home.
            </li>
            <li>The final bill uses the real times; a late train adds hours, an early one saves them.</li>
          </ul>
        ) : (
          <ul className="mt-1 list-disc pl-5">
            <li>
              Your days are counted from the time the driver starts: each 24 hours is one day (
              {priceText.outstation}, up to {priceText.outstationHours} of driving).
            </li>
            <li>
              If he is back later than that time on the last day, each extra hour is{' '}
              {rupees(tripRules.extraHour)}. For example: he starts on 1 Oct at 7 AM and is back on 3 Oct at 10 AM —
              that is 2 days + 3 hours × {rupees(tripRules.extraHour)}.
            </li>
          </ul>
        )}
      </div>
      <p className="text-fg-subtle mt-3 text-xs leading-relaxed">
        An estimate
        {oneWay && !view.startKnown ? ` for a driver leaving at ${startText(view)} — pick the date & time for yours` : ''}
        , and it may change: we confirm the exact price on the call, before the driver leaves. Fuel, tolls and parking
        are extra. Please give the driver his meals, or {rupees(settings.outstation.mealAllowance)} a day.
      </p>
    </div>
  );
}

function LocalButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-accent-text font-semibold underline underline-offset-4"
    >
      Switch to Local Full Day
    </button>
  );
}

/* --------------------------------------------------------- trains home -- */

const linkCls = 'text-accent-text font-semibold underline underline-offset-4';

function CheckLinks() {
  return (
    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem]">
      <a href={NTES} target="_blank" rel="noopener noreferrer" className={linkCls}>
        Check trains on NTES (Indian Railways)
      </a>
      <a href={IRCTC} target="_blank" rel="noopener noreferrer" className={linkCls}>
        Book his ticket on IRCTC
      </a>
    </p>
  );
}

/** "Direct" or "Change at Nagpur", and the trains: "12345 Some Express". */
function routeTitle(o: ReturnOption) {
  return o.legs.map((l) => `${l.train.number} ${l.train.name}`).join(' + ');
}

/**
 * The driver's train home for the drop: what the lookup found for that date
 * (scheduled times, or live ones when there are any — never one passed off as
 * the other), the routes to choose from, and plain warnings when it could not
 * check. Nothing here claims a seat or a ticket.
 */
function TrainsHome({ rail, view, city }: { rail: ReturnTrains; view: TripView; city: string }) {
  const lookup = rail.lookup;
  let body: ReactNode;
  if (rail.status === 'need-date') {
    body = (
      <p className="text-fg-muted">
        Pick the date and time above to see the real trains home for that day. Until then the price uses the typical
        time home.
      </p>
    );
  } else if (rail.status === 'not-set-up') {
    body = (
      <>
        <p className="text-fg-muted">
          The live train check is not switched on yet, so the price uses the typical time home — not a particular
          train. We confirm his train on the call.
        </p>
        <CheckLinks />
      </>
    );
  } else if (rail.status === 'loading') {
    body = (
      <p className="text-fg-muted flex items-center gap-2">
        <Spinner className="size-4" /> Checking the trains home for that day…
      </p>
    );
  } else if (rail.status === 'error' || rail.status === 'none') {
    body = (
      <>
        <p className="bg-error-subtle text-fg rounded-lg p-2">
          {rail.status === 'none'
            ? `No train home found for that day, direct${view.dest?.rail?.hubs?.length ? ' or with one change' : ''}. `
            : (lookup?.problems ?? []).some((p) => p.error === 'busy' || p.error === 'rate-limited')
              ? 'The train check has reached its limit for today, so the trains were not checked. '
              : 'We could not check the trains just now. '}
          The price uses the typical time home, which may be different — please check before you travel, and we
          confirm on the call.
        </p>
        <CheckLinks />
      </>
    );
  } else {
    const selected = rail.selected;
    const dropped = (lookup?.problems ?? []).reduce((n, p) => n + (p.dropped?.length ?? 0), 0);
    const failed = (lookup?.problems ?? []).filter((p) => p.error).length;
    body = (
      <>
        <fieldset>
          <legend className="sr-only">Choose the driver’s train home</legend>
          <ul className="flex flex-col gap-2">
            {rail.options.map((o, i) => {
              const on = selected?.id === o.id;
              return (
                <li key={o.id}>
                  <label
                    className={cn(
                      'flex cursor-pointer gap-3 rounded-lg border p-2.5',
                      on ? 'border-accent bg-accent-subtle/40' : 'border-border',
                    )}
                  >
                    <input
                      type="radio"
                      name="train-home"
                      className="mt-1 size-4 shrink-0"
                      checked={on}
                      onChange={() => rail.select(o.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">
                        {i === 0 ? 'Recommended: ' : ''}
                        {routeTitle(o)}
                      </span>
                      {o.legs.map((l, j) => (
                        <span key={`${l.train.number}-${j}`} className="text-fg-muted block text-[0.8125rem]">
                          {l.from.name} {whenText(l.depart)} → {l.to.name} {whenText(l.arrive)}
                          {l.delayMinutes !== undefined ? ` · live: ${l.delayMinutes} min late` : ''}
                        </span>
                      ))}
                      <span className="text-fg-muted block text-[0.8125rem]">
                        {o.transfer
                          ? `Change at ${o.transfer.station.name}: ${hmText(o.transfer.minutes)} between the trains · `
                          : 'Direct · '}
                        waits {hmText(o.waitMinutes)} after the drop · home {o.scheduled ? 'about ' : ''}
                        {whenText(o.expectedArrive)} · {hmText(o.totalMinutes)} in all
                      </span>
                      <span className="text-fg-subtle block text-xs">
                        {i === 0
                          ? 'Gets him home soonest after the drop.'
                          : o.transfer
                            ? 'Another way home with a change of train.'
                            : 'Another direct train.'}
                      </span>
                      {o.warnings.map((w) => (
                        <span key={w} className="text-error block text-xs">
                          {w}
                        </span>
                      ))}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
        <p className="text-fg-subtle mt-2 text-xs">
          {lookup?.live ? 'Includes live running status' : 'Scheduled timetable times, not live'} · from RailRadar
          {lookup?.checkedAt ? `, checked ${whenText(lookup.checkedAt)}` : ''}. Seats and tickets are not checked —
          you book his ticket. Trains can run late or be changed.
          {dropped ? ` ${dropped} train${dropped === 1 ? ' was' : 's were'} left out because the timetable data did not add up.` : ''}
          {failed ? ' Some searches could not be checked.' : ''}
        </p>
        <CheckLinks />
      </>
    );
  }
  return (
    <div className="border-border mt-3 border-t pt-3">
      <p className="text-fg-subtle text-xs font-semibold tracking-wide uppercase">
        The driver’s train home to {city}
      </p>
      <div className="mt-2 text-[0.8125rem]">{body}</div>
    </div>
  );
}
