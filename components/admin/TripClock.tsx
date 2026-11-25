'use client';

import type { User } from 'firebase/auth';
import { useEffect, useState } from 'react';

import { SectionTitle } from '@/components/admin/kit';
import { WhatsappIcon } from '@/components/icons';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { formatDateTime, wantsNonstop, type Booking, type TripPackage } from '@/lib/bookings';
import { cn } from '@/lib/cn';
import { nightsOf, pricedByKm, pricedByTime, pricedV2Long, pricedV4, waitHoursOfPlan } from '@/lib/outstation';
import { rupeeRange, rupees, settings, tripRules } from '@/lib/settings';
import { asset } from '@/lib/site';
import { planForBooking } from '@/lib/trip';
import {
  billBreakdown,
  billLines,
  billMessage,
  billNow,
  billRates,
  bookingBill,
  daysText,
  driverMessage,
  driverPay,
  durationText,
  fromLocalInput,
  mapLink,
  nextStep,
  phoneGap,
  stepName,
  stepsFor,
  toLocalInput,
  timeText,
  type TripLink,
  type TripStep,
} from '@/lib/tripclock';
import { createTripLink, fixTripLink, saveFinalBill, watchTripLinks } from '@/lib/tripclock-db';

const GRACE = settings.outstation.graceMinutes;
const { targetProfitPercent: TARGET, minProfitPercent: MIN_PROFIT, maxProfitPercent: MAX_PROFIT } = settings.outstation;
/** Bills from before 8 Nov 2026: what a driver usually gets per hour home — the customer's rate less the minimum profit, to ₹10. */
const DEFAULT_RETURN_PAY = Math.floor((tripRules.returnHour * (1 - MIN_PROFIT / 100)) / 10) * 10;
/** By the driver's time: what he usually gets for an hour past the 24-hour blocks — the customer's hourly rate less the profit, to ₹10 (as the quote). */
const DEFAULT_HOUR_PAY = Math.round((tripRules.extraHour * (1 - TARGET / 100)) / 10) * 10;
/** A long one-way drop: what a driver usually gets for an hour past his 24-hour blocks — the customer's hour home less the profit, to ₹10. */
const DEFAULT_LONG_HOUR_PAY = Math.round(((tripRules.oneWay?.waitHour ?? 0) * (1 - TARGET / 100)) / 10) * 10;
/** Warn when driving or the way home took this many hours longer than the plan for the real start. */
const LATE_DRIVE_HOURS = 4;
const LATE_HOME_HOURS = 3;

const int = (v: string) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const wa = (phone: string, text: string) =>
  `https://wa.me/91${String(phone).replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(text)}`;
const linkUrl = (key: string) =>
  `${typeof window === 'undefined' ? '' : window.location.origin}${asset('/trip/')}?k=${key}`;

/**
 * The trip clock in a booking: the driver's link (sent on WhatsApp), the times
 * he taps, the bill so far while he is on the road, and — once he is home —
 * the final bill to check and save. Times can be corrected here.
 */
export function TripClock({ b, user, driverPhone = '' }: { b: Booking; user: User; driverPhone?: string }) {
  const [links, setLinks] = useState<TripLink[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => watchTripLinks(b.id, setLinks, () => setLoadErr(true)), [b.id]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const link = links?.[0];
  const driver = b.assignedDriver;
  const driverChanged = Boolean(link && driver && !link.closed && link.driverName !== driver.name);

  async function make() {
    setBusy(true);
    setErr('');
    try {
      await createTripLink(user, b, link ? link.nonstop : wantsNonstop(b.notes), links ?? []);
    } catch {
      setErr('Could not make the link. Check your internet — and that the new firestore.rules are published.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-border mt-5 border-t pt-5">
      <SectionTitle>Trip clock &amp; final bill</SectionTitle>

      {loadErr && <Alert tone="error">Could not load the trip clock. Are the new firestore.rules published?</Alert>}
      {!loadErr && links === null && <p className="text-fg-subtle text-sm">Loading…</p>}

      {links !== null && !link && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-fg-muted">
            The driver taps <strong>Start</strong>
            {b.package === 'one-way-drop' ? (
              <>
                , <strong>Car dropped</strong> and <strong>Home</strong>
              </>
            ) : (
              <>
                {' '}
                and <strong>Back</strong>
              </>
            )}{' '}
            on a link — no app, no login. The final bill comes from those times.
          </p>
          {driver ? (
            <Button size="sm" className="self-start" loading={busy} onClick={make}>
              Make {driver.name.split(' ')[0]}’s trip link
            </Button>
          ) : (
            <p className="text-fg-subtle">Assign a driver first.</p>
          )}
        </div>
      )}

      {link && (
        <div className="flex flex-col gap-4">
          {driverChanged && driver && (
            <Alert tone="info">
              This link is for {link.driverName}. The driver is now {driver.name}.{' '}
              <Button size="sm" variant="outline" className="mt-2" loading={busy} onClick={make}>
                Make a link for {driver.name.split(' ')[0]}
              </Button>
            </Alert>
          )}
          <LinkActions b={b} link={link} phone={driverPhone} />
          <Steps b={b} link={link} user={user} />
          <BillPanel b={b} link={link} user={user} now={now} />
        </div>
      )}

      {err && (
        <Alert tone="error" className="mt-3">
          {err}
        </Alert>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ link */

function LinkActions({ b, link, phone: known }: { b: Booking; link: TripLink; phone: string }) {
  const [copied, setCopied] = useState(false);
  const url = linkUrl(link.key);
  // His number from his record (bookings lose it once HIDE_DRIVER_PHONE is on).
  const phone = b.assignedDriver?.phone || known;
  if (link.closed)
    return <p className="text-fg-subtle text-xs">The link is closed (the bill is saved): the driver can no longer tap.</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {phone && (
          <a
            href={wa(phone, driverMessage(link, b.city, url))}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-accent text-ink hover:bg-accent-hover inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold"
          >
            <WhatsappIcon className="size-4" /> Send to {link.driverName.split(' ')[0]}
          </a>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              window.prompt('Copy the link', url);
            }
          }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </Button>
      </div>
      <p className="text-fg-subtle text-xs">
        Only for this trip. Whoever has the link can tap, so send it to the driver only. Practice page:{' '}
        <a href={`${asset('/trip/')}?k=demo`} target="_blank" rel="noopener noreferrer" className="underline">
          /trip/?k=demo
        </a>
      </p>
    </div>
  );
}

/* ----------------------------------------------------------------- steps */

function Steps({ b, link, user }: { b: Booking; link: TripLink; user: User }) {
  const [editing, setEditing] = useState<TripStep | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const steps = stepsFor(link.kind);
  const lastSet = [...steps].reverse().find((s) => link[`${s}At`]);

  async function fix(change: Parameters<typeof fixTripLink>[2]) {
    setBusy(true);
    setErr('');
    try {
      await fixTripLink(user, link.key, change);
      setEditing(null);
    } catch {
      setErr('Could not save. The times must be in order (start before drop before home).');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <ul className="divide-border border-border divide-y rounded-lg border">
        {steps.map((s) => {
          const at = link[`${s}At`];
          const loc = link[`${s}Loc`];
          const late = phoneGap(link, s);
          return (
            <li key={s} className="flex flex-col gap-1 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{stepName(s, link.kind)}</span>
                <span className={cn('tabular', at ? 'text-fg' : 'text-fg-subtle')}>{at ? formatDateTime(at) : 'not yet'}</span>
              </div>
              {late && (
                <p className="text-fg-muted text-xs">
                  His phone said {timeText(late)} — it reached us late (no network?).{' '}
                  <button
                    type="button"
                    className="text-accent-text font-semibold"
                    disabled={busy}
                    onClick={() => fix({ times: { [s]: late } })}
                  >
                    Use {timeText(late)}
                  </button>
                </p>
              )}
              <div className="flex flex-wrap gap-3 text-xs">
                {loc && (
                  <a href={mapLink(loc)} target="_blank" rel="noopener noreferrer" className="text-accent-text font-semibold">
                    Where he tapped
                  </a>
                )}
                {editing !== s && (
                  <button
                    type="button"
                    className="text-accent-text font-semibold"
                    onClick={() => {
                      setEditing(s);
                      setValue(toLocalInput(at ?? new Date()));
                    }}
                  >
                    {at ? 'Change' : 'Set the time'}
                  </button>
                )}
                {at && s === lastSet && editing !== s && (
                  <button
                    type="button"
                    className="text-fg-muted font-semibold"
                    disabled={busy}
                    onClick={() => fix({ times: { [s]: null } })}
                  >
                    Undo (pressed by mistake)
                  </button>
                )}
              </div>
              {editing === s && (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="datetime-local"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    className="h-9 max-w-56"
                    aria-label={`${stepName(s, link.kind)} time (India)`}
                  />
                  <Button
                    size="sm"
                    loading={busy}
                    disabled={!fromLocalInput(value)}
                    onClick={() => fix({ times: { [s]: fromLocalInput(value) ?? null } })}
                  >
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="size-4"
          checked={link.nonstop}
          disabled={busy}
          onChange={(e) => fix({ nonstop: e.target.checked })}
        />
        Driven day and night (every {tripRules.hoursPerDay} h is a day; otherwise each 24 h is)
      </label>
      {!nextStep(link) && b.status !== 'completed' && (
        <p className="text-fg-subtle text-xs">
          All times are in. Check the bill below, save it, then mark the booking completed.
        </p>
      )}
      {err && <Alert tone="error">{err}</Alert>}
    </div>
  );
}

/* ------------------------------------------------------------------ bill */

function BillPanel({ b, link, user, now }: { b: Booking; link: TripLink; user: User; now: number }) {
  // The plan for the real start time: to spot a time that looks wrong.
  // One of ours by its id; a place from the map by its km.
  const plan =
    b.trip && link.startAt
      ? planForBooking(b.package as TripPackage, b.city, b.trip, toLocalInput(link.startAt), link.nonstop)
      : undefined;
  // v4: the plan for the real start (nights, road time, the usual wait) and the train chosen at the drop (returnChoice).
  const oneWay = link.kind === 'one-way';
  const chosenDepartAt = b.returnChoice?.dep?.getTime();
  // No train soon at the drop (returnCheck.bus) and none chosen: he went by bus — no wait charge without a Boarded tap.
  const byBus = !!b.returnCheck?.bus && !b.returnChoice;
  const timing = {
    nights: plan ? nightsOf(plan) : 0,
    ...(plan?.dropAt !== undefined && { plannedRoadHours: plan.dropAt, waitHours: byBus ? 0 : waitHoursOfPlan(plan) }),
    ...(chosenDepartAt !== undefined && { chosenDepartAt }),
  };
  // A saved bill keeps its rates; otherwise the agreed price's (or the estimate's: the driver's time at the day price for the distance).
  const saved = b.bill;
  const rates = saved
    ? {
        dayRate: saved.dayRate,
        extraHourRate: saved.extraHourRate,
        returnHourRate: saved.returnHourRate,
        ticket: saved.ticket,
        ...(saved.awayHours && {
          route: { price: saved.dayRate, awayHours: saved.awayHours, km: saved.km ?? b.trip?.km ?? 0 },
        }),
        // v4 (24 Nov 2026): the drive, the nights and the rates as saved, the stops as saved (the office may have set them).
        ...(oneWay &&
          pricedV4(saved) &&
          tripRules.oneWay && {
            v4: {
              km: saved.km ?? 0,
              drive: saved.dayRate,
              nightRate: saved.nightRate ?? 0,
              waitHourRate: saved.waitHourRate ?? 0,
              minimum: saved.minimum ?? 0,
              rates: tripRules.oneWay,
              ...timing,
              nights: saved.nights ?? 0,
              stopsHours: saved.stopsHours ?? 0,
            },
          }),
        // By the km (24 Nov 2026, v3): the km, the price a km and the minimum.
        ...(oneWay && pricedByKm(saved) && { v3: { km: saved.km ?? 0, kmRate: saved.kmRate ?? 0, minimum: saved.minimum ?? 0 } }),
        // Priced by the driver's time (from 8 Nov 2026): the km with no route hours.
        ...(pricedByTime(saved) && { time: { km: saved.km ?? 0 } }),
        // Agreed under v2 (24 Nov 2026): driving days and his way home.
        ...(oneWay && pricedV2Long(tripRules, saved) && { v2Long: { km: saved.km ?? 0 } }),
      }
    : billRates(b.quote, tripRules, b.trip?.km, oneWay, timing);
  // v3: the price to change is the price a km; otherwise the day (or route) price — v4: the drive's.
  const [dayRate, setDayRate] = useState(String(rates.v3 ? rates.v3.kmRate : rates.dayRate));
  const [cost, setCost] = useState('');
  const [returnPay, setReturnPay] = useState(
    String(rates.time ? DEFAULT_HOUR_PAY : rates.v3 || rates.v4 ? DEFAULT_LONG_HOUR_PAY : DEFAULT_RETURN_PAY),
  );
  // v4: the stops the customer asked for, in hours — empty: from the times (start → drop past the plan).
  const [stops, setStops] = useState(saved && rates.v4 ? String(rates.v4.stopsHours ?? 0) : '');
  const [editing, setEditing] = useState(!b.bill);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const price = int(dayRate) || (rates.v3 ? rates.v3.kmRate : rates.dayRate);
  const stopsTyped = stops.trim() === '' ? undefined : Math.max(0, Math.round(Number(stops)) || 0);
  const res = billNow(
    { ...link, ...(b.clock?.boardAt && !link.boardAt && { boardAt: b.clock.boardAt }) },
    rates.v3
      ? { ...rates, v3: { ...rates.v3, kmRate: price } }
      : rates.v4
        ? { ...rates, dayRate: price, v4: { ...rates.v4, drive: price, stopsHours: stopsTyped } }
        : { ...rates, dayRate: price, ...(rates.route && { route: { ...rates.route, price } }) },
    tripRules,
    GRACE,
    now,
  );
  if (!res) return <p className="text-fg-subtle text-sm">Waiting for the driver to tap Start.</p>;
  const { bill, final } = res;

  if (!final) {
    const home = link.kind === 'one-way' && link.dropAt;
    return (
      <div className="bg-bg-subtle rounded-lg p-3 text-sm">
        <p className="text-fg-subtle text-xs font-semibold tracking-wide uppercase">So far</p>
        <p className="tabular font-display text-xl font-bold">{rupees(bill.amount)}</p>
        <p className="text-fg-muted">
          {home
            ? `Dropped after ${durationText(bill.driveMinutes)} (${daysText(bill)}); on his way home for ${durationText(bill.returnMinutes)}`
            : `On the road for ${durationText(bill.driveMinutes)}: ${daysText(bill)}`}
        </p>
      </div>
    );
  }

  const warnings: string[] = [];
  if (plan?.dropAt !== undefined && link.kind === 'one-way' && bill.driveMinutes / 60 > plan.dropAt + LATE_DRIVE_HOURS)
    warnings.push(
      `The drive took ${durationText(bill.driveMinutes)}; the plan was about ${Math.round(plan.dropAt)} h. Ask why before you send the bill.`,
    );
  // The way home the customer was quoted (the train looked up for their date, or the typical time).
  const planned = b.quote?.returnHours || b.trip?.returnHours || 0;
  if (link.kind === 'one-way' && planned > 0 && bill.returnMinutes / 60 > planned + LATE_HOME_HOURS)
    warnings.push(
      `His way home took ${durationText(bill.returnMinutes)}; the estimate allowed about ${planned} h. Ask which train he took.`,
    );

  const pay = int(cost) ? driverPay(bill, int(cost), int(returnPay), tripRules) : 0;
  const profit = bill.amount - bill.ticket - pay;
  const profitPct = bill.amount - bill.ticket > 0 ? Math.round((profit / (bill.amount - bill.ticket)) * 1000) / 10 : 0;
  const agreed = b.quote?.amount;

  async function save() {
    if (!link.startAt || !link.homeAt) return;
    setBusy(true);
    setErr('');
    try {
      const note =
        `Final bill ${rupees(bill.amount)} (${billBreakdown(bill)}). ` +
        `Driving ${durationText(bill.driveMinutes)}${link.kind === 'one-way' ? `, way home ${durationText(bill.returnMinutes)}` : ''}${link.nonstop ? ', day and night' : ''}.` +
        (pay
          ? rates.time || rates.v3 || rates.v4
            ? ` Driver ${rupees(int(cost))} for each 24 h, ${rupees(int(returnPay))} an hour past them → driver gets ${rupees(pay)}, profit ${rupees(profit)} (${profitPct}%).`
            : ` Driver ${rupees(int(cost))} a day, ${rupees(int(returnPay))} an hour home → driver gets ${rupees(pay)}, profit ${rupees(profit)} (${profitPct}%).`
          : '');
      await saveFinalBill(
        user,
        b.id,
        link.key,
        bookingBill(bill, link.nonstop),
        {
          startAt: link.startAt,
          homeAt: link.homeAt,
          ...(link.kind === 'one-way' && link.dropAt && { dropAt: link.dropAt }),
          // His Boarded tap (the trip page, or the Driver app's copied into the clock).
          ...(link.kind === 'one-way' && (link.boardAt ?? b.clock?.boardAt) && { boardAt: link.boardAt ?? b.clock?.boardAt }),
        },
        note,
      );
      setEditing(false);
    } catch {
      setErr('Could not save. Check your internet and try again.');
    } finally {
      setBusy(false);
    }
  }

  // The bill as saved, from the times now (a time changed since? then it no longer matches).
  const savedNow = saved && billNow(link, rates, tripRules, GRACE, now);
  const stale = Boolean(saved && savedNow && savedNow.bill.amount !== saved.amount);
  return (
    <div className="flex flex-col gap-3 text-sm">
      {saved && (
        <div className="bg-success-subtle rounded-lg p-3">
          <p>
            Final bill saved: <strong className="tabular text-base">{rupees(saved.amount)}</strong>
            {saved.at && <span className="text-fg-subtle"> · {formatDateTime(saved.at)}</span>}
          </p>
          <p className="text-fg-muted">{billBreakdown(saved)}</p>
          <p className="text-fg-subtle mt-1 text-xs">The customer sees it in My account and the app.</p>
          {stale && (
            <p className="text-error mt-1 text-xs">A time changed after you saved: save the new bill before you send it.</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {savedNow && !stale && (
              <a
                href={wa(b.phone, billMessage(b, link, savedNow.bill, tripRules))}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-accent text-ink hover:bg-accent-hover inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold"
              >
                <WhatsappIcon className="size-4" /> Send the bill to {b.name.split(' ')[0]}
              </a>
            )}
            {!editing && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Change the bill
              </Button>
            )}
          </div>
        </div>
      )}

      {editing && (
        <div className={cn('rounded-lg border p-3', 'border-border bg-bg-subtle')}>
          <p className="text-fg-subtle text-xs font-semibold tracking-wide uppercase">Final bill from the real times</p>
          <p className="tabular font-display text-2xl font-bold">{rupees(bill.amount)}</p>
          <p className="text-fg-muted">
            Driving {durationText(bill.driveMinutes)} → {daysText(bill)}
            {link.kind === 'one-way' && <> · way home {durationText(bill.returnMinutes)}</>}
          </p>
          <dl className="border-border mt-2 flex flex-col gap-1 border-t pt-2">
            {billLines(bill, tripRules).map((l) => (
              <div key={l.label} className="flex justify-between gap-3">
                <dt className="text-fg-muted">{l.label}</dt>
                <dd className="tabular font-semibold">{l.amount}</dd>
              </div>
            ))}
          </dl>
          <p className="text-fg-muted mt-2">
            {agreed ? (
              <>
                Agreed on the call: <span className="tabular">{rupees(agreed)}</span> · difference{' '}
                <strong className="tabular">
                  {bill.amount >= agreed ? '+' : '−'}
                  {rupees(Math.abs(bill.amount - agreed))}
                </strong>
              </>
            ) : b.trip && b.trip.estFrom > 0 ? (
              <>
                Estimate shown: <span className="tabular">{rupeeRange(b.trip.estFrom, b.trip.estTo)}</span>
              </>
            ) : null}
          </p>
          <p className="text-fg-subtle mt-1 text-xs">
            The first {GRACE} minutes of an hour are free. Rates from{' '}
            {b.quote
              ? 'the agreed price'
              : rates.time || rates.v3 || rates.v4
                ? 'the price customers are shown for the distance'
                : 'the lowest shown'}
            .
          </p>

          {warnings.map((w) => (
            <Alert key={w} tone="error" className="mt-2">
              {w}
            </Alert>
          ))}

          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-medium">
                {rates.route
                  ? 'Route price'
                  : rates.v3
                    ? 'Price a km'
                    : rates.v4
                      ? `Drive (${rates.v4.km} km)`
                      : rates.time
                        ? 'Price for each 24 h'
                        : 'Day rate'}
              </span>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                step={rates.v3 || rates.v4 ? 1 : 50}
                value={dayRate}
                onChange={(e) => setDayRate(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium">{rates.time || rates.v3 || rates.v4 ? 'Driver’s cost for each 24 h' : 'Driver’s cost a day'}</span>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                step={50}
                value={cost}
                placeholder="optional"
                onChange={(e) => setCost(e.target.value)}
              />
            </label>
            {link.kind === 'one-way' && (
              <label className="flex flex-col gap-1">
                <span className="font-medium">
                  {rates.time || rates.v3 || rates.v4 ? 'His pay an hour past the 24-h blocks' : 'Driver’s pay an hour home'}
                </span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={10}
                  value={returnPay}
                  onChange={(e) => setReturnPay(e.target.value)}
                />
              </label>
            )}
            {bill.v4 && (
              <label className="flex flex-col gap-1">
                <span className="font-medium">Stops the customer asked for, hours</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={stops}
                  placeholder={String(bill.v4.stopsHours)}
                  onChange={(e) => setStops(e.target.value)}
                />
                <span className="text-fg-subtle text-xs">
                  From the times: start → drop past the plan and {tripRules.oneWay?.stopsFreeHours ?? 0} h. Set 0 if the
                  delay was not the customer’s.
                </span>
              </label>
            )}
          </div>
          {pay > 0 && (
            <dl className="border-border mt-2 grid grid-cols-2 gap-2 border-t pt-2">
              <div>
                <dt className="text-fg-subtle text-xs">Driver gets</dt>
                <dd className="tabular font-semibold">{rupees(pay)}</dd>
              </div>
              <div>
                <dt className="text-fg-subtle text-xs">Your profit</dt>
                <dd
                  className={cn(
                    'tabular font-semibold',
                    profitPct + 1e-9 >= MIN_PROFIT && profitPct - 1e-9 <= MAX_PROFIT ? 'text-success' : 'text-error',
                  )}
                >
                  {rupees(profit)} · {profitPct}%
                </dd>
              </div>
            </dl>
          )}

          {err && (
            <Alert tone="error" className="mt-2">
              {err}
            </Alert>
          )}
          <div className="mt-3 flex gap-2">
            <Button size="sm" loading={busy} onClick={save}>
              {saved ? 'Save the new bill' : 'Save final bill'}
            </Button>
            {saved && (
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Back
              </Button>
            )}
          </div>
          <p className="text-fg-subtle mt-2 text-xs">
            The customer sees the bill and the times. The driver’s pay and your profit go only in the history below.
          </p>
        </div>
      )}
    </div>
  );
}
