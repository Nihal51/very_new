'use client';

import type { User } from 'firebase/auth';
import { useState } from 'react';

import { SectionTitle } from '@/components/admin/kit';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { saveQuote } from '@/lib/admin';
import { formatDateTime, type Booking } from '@/lib/bookings';
import { cn } from '@/lib/cn';
import { quote as workOut } from '@/lib/outstation';
import { priceText, rupeeRange, rupees, settings, tripRules } from '@/lib/settings';
import { quoteBreakdown } from '@/lib/trip';

const MIN_PROFIT = settings.outstation.minProfitPercent;
const PARTNER = settings.partners.commissionPercent;
/** What a driver usually gets for a return day: the return-day price less the minimum profit, to ₹50. */
const DEFAULT_RETURN_PAY = Math.floor((tripRules.returnDay.from * (1 - MIN_PROFIT / 100)) / 50) * 50;

const int = (v: string) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * The price for an outstation trip or one-way drop, worked out on the call:
 * type what this driver costs, and it adds the minimum profit (and a
 * partner's commission, if a partner sent the customer), rounds up, and shows
 * what you keep. Saving puts the customer's price on the booking and the
 * driver's cost and the profit in the admin-only history.
 */
export function QuoteCalculator({ b, user }: { b: Booking; user: User }) {
  const oneWay = b.package === 'one-way-drop';
  const [open, setOpen] = useState(!b.quote);
  const [cost, setCost] = useState('');
  const [days, setDays] = useState(String(b.quote?.days ?? b.trip?.days ?? 1));
  const [back, setBack] = useState(String(b.quote?.returnDays ?? (oneWay ? (b.trip?.returnDays ?? 0) : 0)));
  const [returnPay, setReturnPay] = useState(String(DEFAULT_RETURN_PAY));
  const [extraHours, setExtraHours] = useState(String(b.quote?.extraHours ?? 0));
  const [ticket, setTicket] = useState(String(b.quote?.ticket ?? 0));
  const [partner, setPartner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);

  const q =
    int(cost) > 0
      ? workOut(tripRules, {
          driverDayCost: int(cost),
          driverReturnPay: int(returnPay),
          days: Math.max(1, int(days)),
          returnDays: int(back),
          extraHours: int(extraHours),
          ticket: int(ticket),
          partnerPercent: partner ? PARTNER : 0,
          minProfitPercent: MIN_PROFIT,
        })
      : null;

  const agreed = q && {
    amount: q.total,
    dayRate: q.dayRate,
    days: Math.max(1, int(days)),
    returnDays: int(back),
    returnDay: q.returnDayRate,
    extraHours: int(extraHours),
    extraHourRate: q.extraHourRate,
    ticket: int(ticket),
  };

  async function save() {
    if (!q || !agreed) return;
    setBusy(true);
    setErr('');
    try {
      const note =
        `Price ${rupees(q.total)} (${quoteBreakdown(agreed)}). ` +
        `Driver ${rupees(int(cost))} a day` +
        (agreed.returnDays ? `, ${rupees(int(returnPay))} a return day` : '') +
        ` → driver gets ${rupees(q.driverPay)}` +
        (q.partnerPay ? `, partner ${rupees(q.partnerPay)}` : '') +
        `, profit ${rupees(q.profit)} (${q.profitPercent}%).`;
      await saveQuote(user, b.id, agreed, note);
      setSaved(true);
      setOpen(false);
    } catch {
      setErr('Could not save. Check your internet and try again.');
    } finally {
      setBusy(false);
    }
  }

  const num = (label: string, value: string, set: (v: string) => void, hint?: string) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={value}
        onChange={(e) => {
          set(e.target.value);
          setSaved(false);
        }}
      />
      {hint && <span className="text-fg-subtle text-xs">{hint}</span>}
    </label>
  );

  return (
    <div className="border-border mt-5 border-t pt-5">
      <SectionTitle>Price for the customer</SectionTitle>

      {b.trip && b.trip.estFrom > 0 && (
        <p className="text-fg-muted text-sm">
          Shown on the {b.source === 'app' ? 'app' : 'website'}:{' '}
          <strong className="tabular">{rupeeRange(b.trip.estFrom, b.trip.estTo)}</strong>
        </p>
      )}

      {b.quote && (
        <div className="bg-success-subtle mt-2 rounded-lg p-3 text-sm">
          <p>
            Agreed: <strong className="tabular text-base">{rupees(b.quote.amount)}</strong>
            {b.quote.at && <span className="text-fg-subtle"> · saved {formatDateTime(b.quote.at)}</span>}
          </p>
          <p className="text-fg-muted">{quoteBreakdown(b.quote)}</p>
          <p className="text-fg-subtle mt-1 text-xs">The customer sees this in My account and the app.</p>
        </div>
      )}

      {!open ? (
        <Button variant="outline" size="sm" className="mt-3" onClick={() => setOpen(true)}>
          {b.quote ? 'Change the price' : 'Work out the price'}
        </Button>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            {num('Driver’s cost a day', cost, setCost, 'What this driver asked for')}
            {num('Driving days', days, setDays)}
            {oneWay && num('Return days', back, setBack, `${priceText.outstationReturnDay} each to the customer`)}
            {oneWay && num('Driver’s pay a return day', returnPay, setReturnPay)}
            {num('Extra hours (whole trip)', extraHours, setExtraHours, `Beyond ${priceText.outstationHours} a day`)}
            {oneWay && num('Bus/train ticket', ticket, setTicket, 'Passed on at cost')}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={partner}
              onChange={(e) => {
                setPartner(e.target.checked);
                setSaved(false);
              }}
              className="size-4"
            />
            A partner sent this customer ({PARTNER}% commission)
          </label>

          {!q ? (
            <p className="text-fg-subtle text-sm">Type the driver’s cost a day to see the price.</p>
          ) : (
            <div className={cn('rounded-lg border p-3 text-sm', q.ok ? 'border-border bg-bg-subtle' : 'border-error-border bg-error-subtle')}>
              <p className="text-fg-subtle text-xs font-semibold tracking-wide uppercase">Tell the customer</p>
              <p className="tabular font-display text-2xl font-bold">{rupees(q.total)}</p>
              <p className="text-fg-muted">{agreed && quoteBreakdown(agreed)}</p>
              <dl className="border-border mt-2 grid grid-cols-3 gap-2 border-t pt-2">
                <div>
                  <dt className="text-fg-subtle text-xs">Driver gets</dt>
                  <dd className="tabular font-semibold">{rupees(q.driverPay)}</dd>
                </div>
                {q.partnerPay > 0 && (
                  <div>
                    <dt className="text-fg-subtle text-xs">Partner</dt>
                    <dd className="tabular font-semibold">{rupees(q.partnerPay)}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-fg-subtle text-xs">Your profit</dt>
                  <dd className={cn('tabular font-semibold', q.ok ? 'text-success' : 'text-error')}>
                    {rupees(q.profit)} · {q.profitPercent}%
                  </dd>
                </div>
              </dl>
              {!q.ok && (
                <p className="text-error mt-2">
                  Below the {MIN_PROFIT}% minimum. Check the driver’s return-day pay, or find another
                  driver.
                </p>
              )}
              {q.aboveShownRange && (
                <p className="text-fg-muted mt-2">
                  Above the range customers are shown ({priceText.outstation} a day,{' '}
                  {priceText.outstationReturnDay} a return day). Tell the customer why before you confirm.
                </p>
              )}
            </div>
          )}

          {err && <Alert tone="error">{err}</Alert>}
          <div className="flex gap-2">
            <Button size="sm" disabled={!q || saved} loading={busy} onClick={save}>
              Save this price
            </Button>
            {b.quote && (
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Back
              </Button>
            )}
          </div>
          <p className="text-fg-subtle text-xs">
            The customer sees only the price. The driver’s cost and your profit go in the history below, which
            only admins can see.
          </p>
        </div>
      )}
    </div>
  );
}
