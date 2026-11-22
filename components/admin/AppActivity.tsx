'use client';

import { useEffect, useState } from 'react';

import { Detail, SectionTitle } from '@/components/admin/kit';
import { watchRating, watchTripTaps } from '@/lib/admin';
import {
  type Booking,
  type BookingPayment,
  type Rating,
  type TripTaps,
  formatDateTime,
  isDriverConfirmed,
  isInstantBooking,
} from '@/lib/bookings';
import { rupees } from '@/lib/settings';

/** How a paid job was paid, and who said so. */
function paidText(pay: BookingPayment, driver: string): string {
  const who = pay.by === 'driver' ? ` · confirmed by the driver${driver ? ` (${driver})` : ''} in the Driver app` : '';
  if (pay.method === 'cash') return `Paid ${rupees(pay.amount)} in cash ✓ — the driver kept the cash${who}`;
  if (pay.method === 'upi') return `Paid ${rupees(pay.amount)} by UPI ✓${who}`;
  return `Paid online ✓ ${rupees(pay.amount)}${who}`;
}

/**
 * What happened in the apps without the office: the robot's instant
 * confirmation, the price the customer accepted, the driver's taps, the
 * automatic bill, the payment (link, method, who confirmed it) and the
 * customer's rating. Shown only when there is something to show.
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
        [taps.paidBy === 'cash' ? 'Payment received (cash, driver)' : 'Payment received (UPI, driver)', taps.paidAt],
      ] as const).filter(([, at]) => at)
    : [];
  const bill = b.localBill;
  const pay = b.payment;
  // The call to the driver who took it: asked for in Telegram, confirmed there.
  const confirmed = isDriverConfirmed(b);
  const showConfirm = confirmed || (b.status === 'assigned' && Boolean(b.assignedDriver));

  if (!instant && !b.acceptedPrice && !showConfirm && !tapRows.length && !bill && !pay && !rating) return null;

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
        {showConfirm && (
          <Detail label="Driver" wide>
            {confirmed ? (
              <span className="text-success font-semibold">
                Driver confirmed by call ✓{b.driverConfirmed?.at ? ` (${formatDateTime(b.driverConfirmed.at)})` : ''}
              </span>
            ) : (
              'Not confirmed by call yet (Telegram: Confirmed ✓ or Give to someone else)'
            )}
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
                {paidText(pay, b.assignedDriver?.name ?? '')}
                {pay.paidAt ? ` · ${formatDateTime(pay.paidAt)}` : ''}
              </span>
            ) : pay.method === 'upi' ? (
              <>
                UPI pay link in the customer&apos;s app for {rupees(pay.amount)} · not paid yet
                {pay.at ? ` (since ${formatDateTime(pay.at)})` : ''}. The driver taps &quot;Paid by UPI&quot; or &quot;Paid in cash&quot; once
                the customer pays.
              </>
            ) : (
              <>
                Link sent by SMS for {rupees(pay.amount)} · not paid yet
                {pay.at ? ` (sent ${formatDateTime(pay.at)})` : ''}
              </>
            )}
            {pay.url && pay.method !== 'upi' && (
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
