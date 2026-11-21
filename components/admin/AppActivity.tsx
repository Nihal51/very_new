'use client';

import { useEffect, useState } from 'react';

import { Detail, SectionTitle } from '@/components/admin/kit';
import { watchRating, watchTripTaps } from '@/lib/admin';
import { type Booking, type Rating, type TripTaps, formatDateTime, isInstantBooking } from '@/lib/bookings';
import { rupees } from '@/lib/settings';

/**
 * What happened in the apps without the office: the robot's instant
 * confirmation, the price the customer accepted, the driver's taps, the
 * automatic bill, the payment link and the customer's rating. Shown only
 * when there is something to show.
 */
export function AppActivity({ b }: { b: Booking }) {
  const [taps, setTaps] = useState<TripTaps | null>(null);
  const [rating, setRating] = useState<Rating | null>(null);
  const hasDriver = Boolean(b.assignedDriver);

  useEffect(() => {
    const offs: (() => void)[] = [];
    let alive = true;
    const keep = (u: () => void) => (alive ? offs.push(u) : u());
    // Taps exist once a driver is on the job; ratings once it is completed.
    if (hasDriver || b.status === 'completed') void watchTripTaps(b.id, setTaps).then(keep);
    if (b.status === 'completed') void watchRating(b.id, setRating).then(keep);
    return () => {
      alive = false;
      offs.forEach((u) => u());
    };
  }, [b.id, b.status, hasDriver]);

  const instant = isInstantBooking(b);
  const tapRows = taps
    ? ([
        ['Start (on his way)', taps.leftAt],
        ['Arrived', taps.arrivedAt],
        [b.package === 'one-way-drop' ? 'Job done (car dropped)' : 'Job done', taps.doneAt],
        ['Reached home', taps.homeAt],
      ] as const).filter(([, at]) => at)
    : [];
  const bill = b.localBill;
  const pay = b.payment;

  if (!instant && !b.acceptedPrice && !tapRows.length && !bill && !pay && !rating) return null;

  return (
    <div className="border-border mt-5 border-t pt-5">
      <SectionTitle>In the apps</SectionTitle>
      <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
        {instant && b.status !== 'cancelled' && (
          <Detail label="Confirmation" wide>
            {b.status === 'new'
              ? 'Instant booking: the robot confirms it within a minute, no call needed.'
              : 'Instant booking: confirmed automatically by the robot (see the history).'}
          </Detail>
        )}
        {b.acceptedPrice && (
          <Detail label="Price accepted in the app" wide>
            {rupees(b.acceptedPrice.amount)}
            {b.acceptedPrice.at ? ` · ${formatDateTime(b.acceptedPrice.at)}` : ''}
          </Detail>
        )}
        {tapRows.map(([label, at]) => (
          <Detail key={label} label={label}>
            {formatDateTime(at)}
          </Detail>
        ))}
        {bill && (
          <Detail label="Bill (worked out from the taps)" wide>
            <strong>{rupees(bill.amount)}</strong> · {bill.usedHours} h used, the package has {bill.baseHours} h
            {bill.extraHours > 0 && (
              <>
                {' '}
                · {bill.extraHours} extra h at {rupees(bill.extraHourRate)}
              </>
            )}
          </Detail>
        )}
        {pay && (
          <Detail label="Payment" wide>
            {pay.status === 'paid' ? (
              <span className="text-success font-semibold">
                Paid online ✓ {rupees(pay.amount)}
                {pay.paidAt ? ` · ${formatDateTime(pay.paidAt)}` : ''}
              </span>
            ) : (
              <>
                Link sent by SMS for {rupees(pay.amount)} · not paid yet
                {pay.at ? ` (sent ${formatDateTime(pay.at)})` : ''}
              </>
            )}
            {pay.url && (
              <a href={pay.url} target="_blank" rel="noopener noreferrer" className="text-accent-text ml-2 text-sm font-semibold underline">
                Open the link
              </a>
            )}
          </Detail>
        )}
        {rating && (
          <Detail label="Customer's rating" wide>
            <span aria-label={`${rating.stars} of 5 stars`} className="tracking-wide">
              {'★'.repeat(rating.stars)}
              <span className="text-fg-subtle">{'★'.repeat(Math.max(0, 5 - rating.stars))}</span>
            </span>{' '}
            {rating.stars} of 5{rating.comment ? ` — “${rating.comment}”` : ''}
          </Detail>
        )}
      </dl>
    </div>
  );
}
