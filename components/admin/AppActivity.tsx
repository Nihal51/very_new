'use client';

import type { User } from 'firebase/auth';
import { useEffect, useState } from 'react';

import { Detail, SectionTitle } from '@/components/admin/kit';
import { Button } from '@/components/ui/Button';
import { confirmDriver, watchRating, watchTripTaps } from '@/lib/admin';
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

/** Who confirmed the driver on the booking (driverConfirmed.by). */
const CONFIRMED_BY: Record<string, string> = {
  telegram: 'Driver confirmed by call ✓',
  admin: 'Driver confirmed in /admin ✓',
  office: 'Driver assigned by the office ✓',
  auto: 'Driver confirmed automatically ✓ (calls are off: CONFIRM_BY_CALL)',
};

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
export function AppActivity({ b, user }: { b: Booking; user: User }) {
  const [taps, setTaps] = useState<TripTaps | null>(null);
  const [rating, setRating] = useState<Rating | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmErr, setConfirmErr] = useState(false);
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
  // The driver sees the customer's details only once he is confirmed: by the
  // call (Telegram), here, or because the office assigned him itself.
  const confirmed = isDriverConfirmed(b);
  const driver = b.assignedDriver;
  const showConfirm = confirmed || (b.status === 'assigned' && Boolean(driver));
  async function confirmNow() {
    if (!driver) return;
    setConfirming(true);
    setConfirmErr(false);
    try {
      await confirmDriver(user, b.id, driver);
    } catch {
      setConfirmErr(true);
    } finally {
      setConfirming(false);
    }
  }

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
                {CONFIRMED_BY[b.driverConfirmed?.by ?? ''] ?? 'Driver confirmed ✓'}
                {b.driverConfirmed?.at ? ` (${formatDateTime(b.driverConfirmed.at)})` : ''}
              </span>
            ) : (
              <span className="flex flex-col items-start gap-2">
                <span>
                  Not confirmed yet: {driver?.name ?? 'the driver'} has the job but does not see the customer&apos;s name, number
                  or address. Call him, then press Confirmed ✓ in Telegram or here.
                </span>
                <Button variant="outline" loading={confirming} onClick={() => void confirmNow()}>
                  Confirm driver ✓
                </Button>
                {confirmErr && <span className="text-sm">Could not save. Check your internet and try again.</span>}
              </span>
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
