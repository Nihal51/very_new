'use client';

import type { User } from 'firebase/auth';
import { useState } from 'react';

import { SectionTitle } from '@/components/admin/kit';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { markOfferPaid, postOffer, withdrawOffer } from '@/lib/admin';
import { pingAlerts } from '@/lib/firebase';
import { type Booking, formatDateTime, prettyPhone } from '@/lib/bookings';
import { estimateBasisText, estimateOf } from '@/lib/estimate';
import { CUT, RATE_RAISE, type Offer, citiesText, driverPayFor, offerArea, offerCitiesFor, offerSettlement } from '@/lib/offers';
import { rupeeRange, rupees, settings } from '@/lib/settings';

const CUTS = Array.from({ length: CUT.max - CUT.min + 1 }, (_, i) => CUT.min + i);

/**
 * "Offer to drivers": the booking goes to the DriveBuddy Driver app of every
 * Active driver in its city, with what he earns (the price minus DriveBuddy's
 * cut). The first to tap Accept gets it — the booking is assigned to him at
 * once and the customer hears about it as usual. Drivers see only the area,
 * never the customer's name, number or address, until they have accepted.
 */
export function OfferPanel({ b, offer, user }: { b: Booking; offer: Offer | null | undefined; user: User }) {
  // Nothing quoted or offered yet: the estimate from the site's prices (the same the robot offers at).
  const est = estimateOf(b, settings.prices);
  const fromEstimate = b.quote?.amount == null && offer?.price == null && est.amount > 0;
  const [price, setPrice] = useState(String(b.quote?.amount ?? offer?.price ?? (est.amount || '')));
  const [cut, setCut] = useState(offer?.cutPercent ?? CUT.default);
  const [area, setArea] = useState(offer?.area ?? offerArea(b.pickup));
  const [busy, setBusy] = useState<'post' | 'withdraw' | 'paid' | null>(null);
  const [err, setErr] = useState('');

  if (offer === undefined) return null; // still loading
  const canOffer = b.status === 'new' || b.status === 'confirmed';
  if (!offer && !canOffer) return null;

  const settle = offer ? offerSettlement(offer) : null;
  // The robot pays this one from the private rate card (not a % cut).
  const byRates = offer?.payBy === 'rates' && offer.by === 'robot';
  const firstName = offer?.takenBy?.name.split(' ')[0] ?? 'the driver';
  const priceNum = Math.round(Number(price));
  const priceOk = Number.isFinite(priceNum) && priceNum >= 100 && priceNum <= 500000;
  const pay = priceOk ? driverPayFor(priceNum, cut) : 0;

  async function act(kind: 'post' | 'withdraw' | 'paid', fn: () => Promise<void>) {
    setBusy(kind);
    setErr('');
    try {
      await fn();
    } catch {
      setErr('Could not save. Check your internet and try again.');
    } finally {
      setBusy(null);
    }
  }

  const post = () =>
    act('post', () =>
      postOffer(
        user,
        {
          bookingId: b.id,
          ref: b.ref ?? '',
          city: b.city,
          package: b.package,
          when: b.preferredTime,
          area,
          to: b.trip?.to ?? '',
          price: priceNum,
          cutPercent: cut,
        },
        offer,
      ).then(() => pingAlerts()),
    );

  return (
    <div className="border-border mt-5 border-t pt-5">
      <SectionTitle>Offer to drivers</SectionTitle>

      {offer?.status === 'released' && (
        <p className="text-sm">
          {offer.takenBy?.name ?? 'The driver'} gave this job back (can&apos;t make it). The robot offers it to drivers again from
          the start within a minute — without him.
        </p>
      )}

      {offer?.status === 'open' && (
        <div className="flex flex-col gap-2">
          {byRates ? (
            <p>
              Offered to {citiesText(offer.cities?.length ? offer.cities : [b.city])} drivers at <strong>{rupees(offer.price)}</strong> ·
              Driver gets <strong>{rupees(offer.driverPay)}</strong> (his rate) · DriveBuddy keeps{' '}
              <strong>{rupees(offer.price - offer.driverPay)}</strong> ({offer.cutPercent}%). The nearest online drivers got an
              alert, the rest a minute later. Waiting for one to accept…
            </p>
          ) : (
            <p>
              Offered to {citiesText(offer.cities?.length ? offer.cities : [b.city])} drivers at <strong>{rupees(offer.price)}</strong> · driver earns{' '}
              <strong>{rupees(offer.driverPay)}</strong> · DriveBuddy keeps {offer.cutPercent}%. The nearest online drivers got an
              alert, the rest a minute later. Waiting for one to accept…
            </p>
          )}
          {byRates && (
            <p className="text-fg-muted text-sm">
              Paid from the rate card: if nobody takes it the robot raises his pay by {rupees(RATE_RAISE.step)} a step, up to{' '}
              {rupees(RATE_RAISE.max)} (never up to the price), and tells every online driver of the zone again.
            </p>
          )}
          {offer.by === 'robot' && !byRates && (
            <p className="text-fg-muted text-sm">
              Automatic offer: if nobody takes it, the robot lowers DriveBuddy&apos;s cut every 2 minutes (30% → 25% → 20%),
              so the driver earns more, and tells every online driver of the zone again, nearest first.
            </p>
          )}
          <div>
            <Button variant="ghost" loading={busy === 'withdraw'} onClick={() => act('withdraw', () => withdrawOffer(user, b.id))}>
              Withdraw offer
            </Button>
          </div>
        </div>
      )}

      {offer?.status === 'taken' && offer.takenBy && (
        <div className="flex flex-col gap-2">
          <p>
            Taken by <strong>{offer.takenBy.name}</strong> ({prettyPhone(offer.takenBy.phone)})
            {offer.takenAt ? ` · ${formatDateTime(offer.takenAt)}` : ''}.
          </p>
          <p className="text-fg-muted text-sm">
            {byRates
              ? `Price ${rupees(offer.price)} · Driver gets ${rupees(offer.driverPay)} (his rate) · DriveBuddy keeps ${rupees(offer.price - offer.driverPay)} (${offer.cutPercent}%).`
              : `Price ${rupees(offer.price)} · driver earns ${rupees(offer.driverPay)} · DriveBuddy keeps ${offer.cutPercent}% (${rupees(offer.price - offer.driverPay)}).`}
          </p>
          {settle && settle.cash > 0 && (
            <p className="text-sm">
              Cash kept by driver <strong>{rupees(settle.cash)}</strong> (he tapped &quot;Paid in cash&quot;) ·{' '}
              {settle.net > 0
                ? `DriveBuddy pays him ${rupees(settle.net)} for this job`
                : settle.net < 0
                  ? `he owes DriveBuddy ${rupees(-settle.net)} for this job`
                  : 'nothing to pay either way for this job'}
              . The Monday payout on Telegram adds up all his jobs the same way.
            </p>
          )}
          {offer.paid ? (
            <p className="text-sm">
              ✓ {settle && settle.net <= 0 ? 'Settled with the driver' : 'Paid to the driver'}
              {offer.paidAt ? ` on ${formatDateTime(offer.paidAt)}` : ''}.{' '}
              <button type="button" className="underline" onClick={() => act('paid', () => markOfferPaid(user, b.id, false))}>
                Undo
              </button>
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={offer.done ? 'primary' : 'outline'}
                loading={busy === 'paid'}
                onClick={() => act('paid', () => markOfferPaid(user, b.id))}
              >
                {!settle || settle.net > 0
                  ? `Mark ${rupees(settle?.net ?? offer.driverPay)} paid to ${firstName}`
                  : settle.net < 0
                    ? `Mark settled: ${firstName} paid DriveBuddy ${rupees(-settle.net)}`
                    : 'Mark settled (nothing to pay)'}
              </Button>
              {!offer.done && <span className="text-fg-subtle text-sm">The job is not marked completed yet.</span>}
            </div>
          )}
        </div>
      )}

      {canOffer && (!offer || offer.status === 'withdrawn') && (
        <div className="flex flex-col gap-3">
          {!offer && est.amount > 0 && (
            <p className="text-fg-muted text-sm">
              {b.status === 'new'
                ? 'This one goes to drivers by itself when you confirm it, at the estimate below (DriveBuddy’s cut starts at 30%). Or offer it now:'
                : 'Going to drivers by itself in a moment, at the estimate below…'}
            </p>
          )}
          {offer?.status === 'withdrawn' && <p className="text-fg-muted text-sm">The last offer was withdrawn. Offer it again:</p>}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Price to the customer (₹)
              <Input type="number" inputMode="numeric" min={100} value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              DriveBuddy&apos;s cut
              <Select value={String(cut)} onChange={(e) => setCut(Number(e.target.value))}>
                {CUTS.map((c) => (
                  <option key={c} value={c}>
                    {c}%{c === CUT.default ? ' (usual)' : ''}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          {fromEstimate && (
            <p className="text-fg-muted -mt-1 text-sm">
              Estimate: {rupees(est.amount)} · {estimateBasisText(est, settings.prices, rupeeRange)}
            </p>
          )}
          <label className="flex flex-col gap-1 text-sm">
            Area drivers see (not the full address)
            <Input value={area} maxLength={120} onChange={(e) => setArea(e.target.value)} />
          </label>
          <p className="text-sm">
            {priceOk ? (
              <>
                Driver earns <strong>{rupees(pay)}</strong> · DriveBuddy keeps <strong>{rupees(priceNum - pay)}</strong>
              </>
            ) : (
              'Enter the price the customer pays.'
            )}
          </p>
          <div>
            <Button loading={busy === 'post'} disabled={!priceOk || area.trim().length < 2} onClick={post}>
              Offer to {citiesText(offerCitiesFor(b.city))} drivers
            </Button>
          </div>
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
