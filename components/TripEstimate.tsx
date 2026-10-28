import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { priceText, rupeeRange, rupees, settings, tripRules } from '@/lib/settings';
import { estimateLines, kmText, startText, tripDays, tripTimeline, type TripView } from '@/lib/trip';

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
  className,
}: {
  view: TripView;
  city: string;
  /** "Somewhere else" was picked. */
  elsewhere: boolean;
  /** Switches the form to the Local Full Day package. */
  onUseLocal: () => void;
  className?: string;
}) {
  const oneWay = view.kind === 'one-way';
  const dayRate = `${priceText.outstation} a day`;
  const returnRate = `a ${priceText.outstationReturnMax} return day if the driver is not home when the driving days end`;

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
      <p className="text-fg-subtle mt-3 text-xs leading-relaxed">
        An estimate
        {oneWay && !view.startKnown ? ` for a driver leaving at ${startText(view)} — pick the date & time for yours` : ''}:
        we confirm the exact price on the call, before the driver leaves. Each driving day is the
        driver&apos;s 24 hours from the start, with up to {priceText.outstationHours} of driving
        ({rupees(tripRules.extraHour)} an hour beyond).
        {oneWay
          ? ` If he is not home when the driving days end, one return day (${priceText.outstationReturnMax}) is added; still travelling after that, ${priceText.outstationReturnHour} an hour (max ${priceText.outstationReturnMax} a day). The final bill uses the time he really gets home. You book his train or bus ticket home.`
          : ''}{' '}
        Fuel, tolls and parking are extra. Please give the driver his meals, or{' '}
        {rupees(settings.outstation.mealAllowance)} a day.
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
