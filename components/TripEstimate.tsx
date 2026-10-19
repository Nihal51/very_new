import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { priceText, rupeeRange, rupees, settings, tripRules } from '@/lib/settings';
import { estimateLines, kmText, tripDays, type TripView } from '@/lib/trip';

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
  const returnRate = `${priceText.outstationReturnDay} for each day the driver needs to get home`;

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
        An estimate: we confirm the exact price on the call, before the driver leaves. Up to{' '}
        {priceText.outstationHours} of driving a day, {rupees(tripRules.extraHour)} an hour beyond.
        Fuel, tolls and parking{oneWay ? ', and the driver’s bus or train ticket home,' : ''} are extra.
        Please give the driver his meals, or {rupees(settings.outstation.mealAllowance)} a meal.
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
