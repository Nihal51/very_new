'use client';

import type { User } from 'firebase/auth';
import { useState } from 'react';

import { SectionTitle } from '@/components/admin/kit';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { formatDateTime, type Booking } from '@/lib/bookings';
import { setReturnChoice } from '@/lib/admin';
import { seatsLink } from '@/lib/rail';
import { rupees } from '@/lib/settings';

/**
 * The train check at the drop (24 Nov 2026), in the booking drawer: the
 * trains home the robot found (returnCheck), the one the customer booked
 * (returnChoice — the office can set or clear it), and the final price with
 * it (returnPrice, the robot's).
 */
export function ReturnTrains({ b, user }: { b: Booking; user: User }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const check = b.returnCheck;
  if (!check && !b.returnChoice) return null;

  async function choose(choice: { train: string; dep: Date } | null) {
    setBusy(choice?.train ?? 'clear');
    setErr('');
    try {
      await setReturnChoice(user, b.id, choice);
    } catch {
      setErr('Could not save. Check your internet and try again.');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="border-border mt-5 border-t pt-5 text-sm">
      <SectionTitle>Train home (at the drop)</SectionTitle>
      {check && (
        <p className="text-fg-muted">
          Checked {check.at ? formatDateTime(check.at) : ''}
          {check.dropAt ? ` · car dropped ${formatDateTime(check.dropAt)}` : ''}
          {check.failed ? ' · the lookup could not run — call the customer' : check.bus ? ' · no train within 12 h: a bus' : ''}
        </p>
      )}
      {check && check.options.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {check.options.map((o) => {
            const chosen = b.returnChoice?.train === o.train;
            return (
              <li key={`${o.train}-${o.dep?.getTime() ?? ''}`} className="border-border flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-2">
                <span className="tabular min-w-0 flex-1">
                  <span className="font-semibold">{o.train}</span> {o.name} · {o.from} {o.dep ? formatDateTime(o.dep) : ''} →{' '}
                  {o.arr ? formatDateTime(o.arr) : ''}
                  {o.change ? ` · change at ${o.change.station} to ${o.change.train}` : ''} · wait {Math.round(o.waitMin / 6) / 10} h ·{' '}
                  <strong>{rupees(o.price)}</strong>
                  {o.waitCharge ? ` (wait ${rupees(o.waitCharge)})` : ''}
                </span>
                {seatsLink(o.train) && (
                  <a href={seatsLink(o.train)} target="_blank" rel="noopener noreferrer" className="text-accent-text text-xs font-semibold underline">
                    Check seats ↗
                  </a>
                )}
                {chosen ? (
                  <span className="text-success text-xs font-semibold">Chosen</span>
                ) : (
                  o.dep && (
                    <Button size="sm" variant="outline" loading={busy === o.train} onClick={() => choose({ train: o.train, dep: o.dep! })}>
                      Set as booked
                    </Button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
      {b.returnChoice && (
        <p className="mt-2">
          Booked: train <strong>{b.returnChoice.train}</strong>
          {b.returnChoice.dep ? ` at ${formatDateTime(b.returnChoice.dep)}` : ''}
          {b.returnPrice && b.returnPrice.train === b.returnChoice.train ? (
            <>
              {' '}
              · final price <strong>{rupees(b.returnPrice.price)}</strong>
              {b.returnPrice.waitCharge ? ` (wait ${rupees(b.returnPrice.waitCharge)})` : ''}
            </>
          ) : (
            ' · the robot prices it within a few minutes'
          )}{' '}
          <Button size="sm" variant="ghost" loading={busy === 'clear'} onClick={() => choose(null)}>
            Clear
          </Button>
        </p>
      )}
      <p className="text-fg-subtle mt-1 text-xs">
        The customer books his ticket — nothing here checks seats. The final bill goes by his Boarded tap.
      </p>
      {err && (
        <Alert tone="error" className="mt-2">
          {err}
        </Alert>
      )}
    </div>
  );
}
