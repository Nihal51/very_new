'use client';

import type { User } from 'firebase/auth';
import { useState } from 'react';

import { SectionTitle } from '@/components/admin/kit';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { saveQuote } from '@/lib/admin';
import { formatDateTime, isTripPackage, wantsNonstop, type Booking, type BookingQuote } from '@/lib/bookings';
import { cn } from '@/lib/cn';
import {
  dayRateFor,
  isLongOneWay,
  longQuote,
  nightsOf,
  pricedByTime,
  pricedV4,
  quote as roundQuote,
  timeQuote,
  v4Fields,
  waitHoursOfPlan,
} from '@/lib/outstation';
import { awayFromNotes, waitFromNotes } from '@/lib/rail';
import { priceText, rupeeRange, rupees, settings, tripRules } from '@/lib/settings';
import { planForBooking, quoteBreakdown } from '@/lib/trip';

const { targetProfitPercent: TARGET, minProfitPercent: MIN_PROFIT, maxProfitPercent: MAX_PROFIT } = settings.outstation;
const PARTNER = settings.partners.commissionPercent;
/** What a driver usually gets for an hour past the 24-hour blocks: the customer's hourly rate less the profit, to ₹10. */
const DEFAULT_HOUR_PAY = Math.round((tripRules.extraHour * (1 - TARGET / 100)) / 10) * 10;
/** Up to this far (one way) he is home the same day: the driver's cost is for the trip. */
const SAME_DAY_KM = tripRules.nearRates?.[0]?.upToKm ?? 0;

const int = (v: string) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
/** Hours with a decimal ("10.7"): 0 when empty or odd. */
const hrs = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
/** A long one-way drop: what a driver usually gets for an hour past his 24-hour blocks — the customer's hour home less the profit, to ₹10. */
const DEFAULT_LONG_HOUR_PAY = Math.round(((tripRules.oneWay?.waitHour ?? 0) * (1 - TARGET / 100)) / 10) * 10;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The price for an outstation trip or one-way drop, worked out on the call
 * (decided with the owner on 8 Nov 2026): type what this driver costs, and it
 * adds the profit (targetProfitPercent, and a partner's commission if a
 * partner sent the customer), rounds, and shows what you keep — with a
 * warning outside the profit band (minProfitPercent … maxProfitPercent).
 *   One-way: the driver's time, from when he leaves until he is home, in
 *   24-hour blocks (up to 160 km one price for the trip); the hours past the
 *   blocks by the hour, never more than one more day (lib/outstation.ts
 *   timeQuote). The hours: the train in the booking's note, else the route's
 *   average (the estimate's plan).
 *   Round trips: the days, and driving beyond the day by the hour (quote).
 * Saving puts the customer's price on the booking; the driver's cost and the
 * profit go in the admin-only history.
 */
export function QuoteCalculator({ b, user }: { b: Booking; user: User }) {
  const oneWay = b.package === 'one-way-drop';
  const [open, setOpen] = useState(!b.quote);
  const [cost, setCost] = useState('');
  const [hourPay, setHourPay] = useState(String(DEFAULT_HOUR_PAY));

  // One-way: the hours of his time — the train in the booking's note, else the plan with the route's average
  // (a place from the map, without an id: planned from its km, the bus/train average home).
  const plan =
    oneWay && b.trip && isTripPackage(b.package)
      ? planForBooking(b.package, b.city, b.trip, b.preferredTime, wantsNonstop(b.notes))
      : undefined;
  const noteHours = awayFromNotes(b.notes);
  const planHours = plan?.homeAt !== undefined ? Math.ceil(plan.homeAt - 1e-9) : 0;
  const savedHours = b.quote && pricedByTime(b.quote) ? b.quote.days * 24 + b.quote.extraHours : 0;
  const hoursFrom = noteHours ? 'the train in the booking’s note' : planHours ? 'the route’s average wait and train' : '';
  const [hours, setHours] = useState(String(noteHours || planHours || savedHours || ''));
  const [km, setKm] = useState(String(b.quote?.km ?? b.trip?.km ?? ''));
  const [dayTyped, setDayTyped] = useState('');

  // A long one-way drop (24 Nov 2026, v4): the customer's nights on the road and his wait for the train (the note's
  // train, else the route's usual wait); for his pay, his hours on the road (start → drop) and of his way home.
  const planHome = plan?.homeAt !== undefined && plan.dropAt !== undefined ? plan.homeAt - plan.dropAt : 0;
  const noteHome = noteHours && plan?.dropAt !== undefined ? Math.max(0, noteHours - plan.dropAt) : 0;
  const noteWait = waitFromNotes(b.notes);
  const savedV4 = b.quote && pricedV4(b.quote) ? b.quote : undefined;
  const [roadH, setRoadH] = useState(plan?.dropAt ? String(Math.round(plan.dropAt * 10) / 10) : '');
  const [homeH, setHomeH] = useState(noteHome ? String(Math.round(noteHome * 10) / 10) : planHome ? String(Math.round(planHome * 10) / 10) : '');
  const [nights, setNights] = useState(String(savedV4?.nights ?? (plan ? nightsOf(plan) : 0)));
  const [waitH, setWaitH] = useState(
    noteWait !== undefined ? String(noteWait) : plan ? String(Math.round(waitHoursOfPlan(plan) * 10) / 10) : '',
  );
  const [longHourPay, setLongHourPay] = useState(String(DEFAULT_LONG_HOUR_PAY));

  // Round trips: the days and the driving hours beyond the day.
  const [days, setDays] = useState(String(b.quote?.days ?? b.trip?.days ?? 1));
  const [extraHours, setExtraHours] = useState(String(b.quote?.extraHours ?? 0));

  const [ticket, setTicket] = useState(String(b.quote?.ticket ?? 0));
  const [partner, setPartner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);

  const band = { targetProfitPercent: TARGET, minProfitPercent: MIN_PROFIT, maxProfitPercent: MAX_PROFIT };
  const partnerPercent = partner ? PARTNER : 0;
  const sameDay = int(km) > 0 && int(km) <= SAME_DAY_KM;

  const long = oneWay && isLongOneWay(tripRules, int(km));
  const lq =
    long && int(cost) > 0 && hrs(roadH) > 0
      ? longQuote(tripRules, {
          ...band,
          km: int(km),
          nights: Math.max(0, Math.round(Number(nights)) || 0),
          waitHours: hrs(waitH),
          roadHours: hrs(roadH),
          homeMinutes: Math.round(hrs(homeH) * 60),
          driverDayCost: int(cost),
          driverHourPay: int(longHourPay),
          ticket: int(ticket),
          partnerPercent,
        })
      : undefined;
  const tq =
    oneWay && !long && int(cost) > 0
      ? timeQuote(tripRules, {
          ...band,
          km: int(km),
          hours: int(hours),
          driverDayCost: int(cost),
          driverHourPay: int(hourPay),
          ...(int(dayTyped) > 0 && { dayRate: int(dayTyped) }),
          ticket: int(ticket),
          partnerPercent,
        })
      : undefined;
  const rq =
    !oneWay && int(cost) > 0
      ? roundQuote(tripRules, {
          ...band,
          driverDayCost: int(cost),
          days: int(days),
          extraHours: int(extraHours),
          ticket: 0,
          partnerPercent,
          ...(b.trip?.km ? { km: b.trip.km } : {}),
        })
      : undefined;

  // What the customer sees (firestore.rules isQuote). One-way: the 24-hour blocks at dayRate and the km — no
  // route hours and no way-home charge, so bills know it is priced by the driver's time (pricedByTime).
  const agreed: Omit<BookingQuote, 'at'> | undefined = lq
    ? {
        // A long one-way drop, v4: the drive (days 1 at dayRate), the nights, his wait for the train, the
        // round-off or the top-up to the minimum (adjust), and the km — no way-home charge (firestore.rules isV4Price).
        amount: lq.total,
        ...v4Fields(lq.long),
        returnHours: 0,
        returnHourRate: 0,
        returnCharge: 0,
        extraHours: 0,
        extraHourRate: 0,
        extraCharge: 0,
        ticket: int(ticket),
      }
    : tq
    ? {
        amount: tq.total,
        dayRate: tq.time.dayRate,
        days: tq.time.days,
        returnHours: 0,
        returnHourRate: 0,
        returnCharge: 0,
        extraHours: tq.time.extraHours,
        extraHourRate: tq.time.extraHourRate,
        extraCharge: tq.time.extraCharge,
        km: tq.time.km,
        ticket: int(ticket),
      }
    : rq
      ? {
          amount: rq.total,
          dayRate: rq.dayRate,
          days: rq.days,
          returnHours: 0,
          returnHourRate: 0,
          returnCharge: 0,
          extraHours: rq.extraHours,
          extraHourRate: rq.extraHourRate,
          extraCharge: rq.extraCharge,
          ticket: 0,
        }
      : undefined;
  const view = lq
    ? { total: lq.total, driverPay: lq.driverPay, partnerPay: lq.partnerPay, profit: lq.profit, profitPercent: lq.profitPercent, low: lq.low, high: lq.high }
    : tq
    ? { total: tq.total, driverPay: tq.driverPay, partnerPay: tq.partnerPay, profit: tq.profit, profitPercent: tq.profitPercent, low: tq.low, high: tq.high }
    : rq
      ? {
          total: rq.total,
          driverPay: rq.driverPay,
          partnerPay: rq.partnerPay,
          profit: rq.profit,
          profitPercent: rq.profitPercent,
          low: rq.profitPercent + 1e-9 < MIN_PROFIT,
          high: rq.profitPercent - 1e-9 > MAX_PROFIT,
        }
      : undefined;
  const ok = view ? !view.low && !view.high : false;

  // The driver's pay in words (admin-only).
  const longBlocks = lq ? Math.floor((Math.round(lq.awayHours * 60) + 1e-9) / 1440) : 0;
  const longLeft = lq ? Math.ceil((Math.round(lq.awayHours * 60) - longBlocks * 1440) / 60) : 0;
  const driverWords = lq
    ? `his whole time about ${Math.round(lq.awayHours)} h (start → home): ${longBlocks ? `${longBlocks} × 24 h × ${rupees(int(cost))}` : ''}${longBlocks && longLeft ? ' + ' : ''}${longLeft ? `${longLeft} h × ${rupees(int(longHourPay))} (at most a day)` : ''}${longBlocks ? '' : `, at least a day`} = ${rupees(lq.driverPay)}`
    : tq
    ? `${tq.time.days} × 24 h × ${rupees(int(cost))}${tq.time.extraHours > 0 ? ` + ${tq.time.extraHours} h × ${rupees(int(hourPay))}` : ''} = ${rupees(tq.driverPay)}`
    : rq
      ? `${plural(rq.days, 'day')} × ${rupees(int(cost))}${rq.extraHours > 0 ? ` + ${rq.extraHours} h of driving at a ${tripRules.hoursPerDay}th of his day` : ''} = ${rupees(rq.driverPay)}`
      : '';

  async function save() {
    if (!view || !agreed) return;
    setBusy(true);
    setErr('');
    try {
      const note =
        `Price ${rupees(view.total)} (${quoteBreakdown(agreed)}). ` +
        (lq ? `Wait for the train ${hrs(waitH)} h, ${plural(lq.long.nights, 'night')} on the road; on the road about ${hrs(roadH)} h, his way home ${hrs(homeH)} h. ` : '') +
        (tq ? `${int(hours)} h of his time (${hoursFrom || 'typed'}). ` : '') +
        `Driver ${driverWords}` +
        (view.partnerPay ? `, partner ${rupees(view.partnerPay)}` : '') +
        `, profit ${rupees(view.profit)} (${view.profitPercent}%).`;
      await saveQuote(user, b.id, agreed, note);
      setSaved(true);
      setOpen(false);
    } catch {
      setErr('Could not save. Check your internet and try again.');
    } finally {
      setBusy(false);
    }
  }

  const num = (label: string, value: string, set: (v: string) => void, hint?: string, placeholder?: string) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          set(e.target.value);
          setSaved(false);
        }}
      />
      {hint && <span className="text-fg-subtle text-xs">{hint}</span>}
    </label>
  );

  // The day price customers are shown for this distance.
  const shownDay = (({ from, to }) => rupeeRange(from, to))(dayRateFor(tripRules, int(km) || b.trip?.km));

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
            {num(
              oneWay ? (sameDay ? 'Driver’s cost for the trip' : 'Driver’s cost for each 24 h') : 'Driver’s cost a day',
              cost,
              setCost,
              oneWay
                ? sameDay
                  ? `Up to ${priceText.sameDayKm} he is home the same day: what this driver asked for the trip`
                  : long
                    ? 'What this driver asked for each 24 hours of his whole time (start → home)'
                    : 'What this driver asked for each 24 hours of his time (leaves → home)'
                : 'What this driver asked for',
            )}
            {long &&
              num(
                'Hours on the road',
                roadH,
                setRoadH,
                'Start → drop: driving, the breaks and any night’s rest (the estimate’s). For his pay only.',
              )}
            {long &&
              num(
                'Nights on the road',
                nights,
                setNights,
                `The customer pays ${priceText.oneWayNight} a night (the plan’s; 0 driven day and night)`,
              )}
            {long &&
              num(
                'Hours of his wait for the train',
                waitH,
                setWaitH,
                `Drop → he boards.${noteWait !== undefined ? ' From the train in the booking’s note.' : ' The route’s usual wait.'} Past ${priceText.oneWayWaitKm}: the first ${priceText.oneWayWaitFree} free, then ${priceText.oneWayWaitHour} an hour, at most ${priceText.oneWayWaitMax}. The final bill: drop → Boarded.`,
              )}
            {long &&
              num(
                'Hours of his way home',
                homeH,
                setHomeH,
                `Waiting for his train plus the ride — for his pay only.${noteHome ? ' From the train in the booking’s note.' : planHome ? ' The route’s average.' : ' Type it.'}`,
              )}
            {long &&
              num(
                'His pay an hour past the 24-h blocks',
                longHourPay,
                setLongHourPay,
                'His whole time: each 24 h his day, the hours left over this much (at most a day)',
              )}
            {oneWay && !long &&
              num(
                'Hours he is away',
                hours,
                setHours,
                `From when he leaves until he is home: the drive, the wait and the train.${hoursFrom ? ` From ${hoursFrom}.` : ' Type it.'} On the final bill the real times count.`,
              )}
            {oneWay &&
              !b.trip?.km &&
              num('Km, one way', km, setKm, 'A place not in the list: by road, from the pickup city — sets the day price')}
            {oneWay && !long &&
              num(
                'His pay an hour past the 24-h blocks',
                hourPay,
                setHourPay,
                `The customer pays ${priceText.outstationExtraHour} an hour past them, never more than one more day`,
              )}
            {oneWay && !long &&
              num(
                sameDay ? 'Customer price for the trip' : 'Customer price for each 24 h',
                dayTyped,
                setDayTyped,
                `Leave empty: the driver’s cost and ${TARGET}% profit, rounded. Shown for ${int(km) || b.trip?.km || '?'} km: ${shownDay}`,
                tq ? String(tq.time.dayRate) : undefined,
              )}
            {!oneWay && num('Days', days, setDays)}
            {!oneWay &&
              num(
                'Extra driving hours',
                extraHours,
                setExtraHours,
                `Beyond ${priceText.outstationHours} a day, ${priceText.outstationExtraHour} each; more than ${tripRules.extraFullDayAfter} = one more day`,
              )}
            {oneWay && num('Ticket, if we bought it', ticket, setTicket, 'Usually 0 — the customer books it. Passed on at cost')}
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

          {!view || !agreed ? (
            <p className="text-fg-subtle text-sm">
              {oneWay && int(cost) > 0 && !int(km)
                ? 'Type the km (one way) to price his time.'
                : 'Type the driver’s cost to see the price.'}
            </p>
          ) : (
            <div className={cn('rounded-lg border p-3 text-sm', ok ? 'border-border bg-bg-subtle' : 'border-error-border bg-error-subtle')}>
              <p className="text-fg-subtle text-xs font-semibold tracking-wide uppercase">Tell the customer</p>
              <p className="tabular font-display text-2xl font-bold">{rupees(view.total)}</p>
              <p className="text-fg-muted">{quoteBreakdown(agreed)}</p>
              {tq && tq.shown.price !== tq.time.price && (
                <p className="text-fg-muted mt-1">
                  The {b.source === 'app' ? 'app' : 'website'} price for {plural(tq.shown.hours, 'hour')} at {int(km)} km:{' '}
                  {rupees(tq.shown.price)}
                  {tq.time.price > tq.shown.price ? ' — tell the customer why it is more before you confirm.' : '.'}
                </p>
              )}
              <dl className="border-border mt-2 grid grid-cols-3 gap-2 border-t pt-2">
                <div>
                  <dt className="text-fg-subtle text-xs">Driver gets</dt>
                  <dd className="tabular font-semibold">{rupees(view.driverPay)}</dd>
                </div>
                {view.partnerPay > 0 && (
                  <div>
                    <dt className="text-fg-subtle text-xs">Partner</dt>
                    <dd className="tabular font-semibold">{rupees(view.partnerPay)}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-fg-subtle text-xs">Your profit</dt>
                  <dd className={cn('tabular font-semibold', ok ? 'text-success' : 'text-error')}>
                    {rupees(view.profit)} · {view.profitPercent}%
                  </dd>
                </div>
              </dl>
              <div className="border-border mt-2 border-t pt-2">
                <p className="text-fg-subtle text-xs font-semibold tracking-wide uppercase">The driver (only admins see this)</p>
                <p className="text-fg-muted">
                  {driverWords}. The customer also gives his meals (or {priceText.mealAllowance} a day)
                  {oneWay ? ' and books his ticket home' : ''}.
                </p>
              </div>
              {view.low && (
                <p className="text-error mt-2">
                  Below the {MIN_PROFIT}% minimum: this price leaves too little after the driver. Raise the price, or find
                  another driver.
                </p>
              )}
              {view.high && (
                <p className="text-error mt-2">
                  Above the {MAX_PROFIT}% maximum: too much for the customer for what the driver gets. Lower the price, or
                  pay the driver more.
                </p>
              )}
            </div>
          )}

          {err && <Alert tone="error">{err}</Alert>}
          <div className="flex gap-2">
            <Button size="sm" disabled={!view || !agreed || saved} loading={busy} onClick={save}>
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
