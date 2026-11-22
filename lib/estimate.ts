/**
 * A booking's price estimate from the site's own pricing: the price a job
 * goes to drivers at by itself (the alerts robot, apps-script/Code.js
 * estimateOf — the same rules; scripts/automation.test.mjs checks both give
 * the same answer), and what the admin panel suggests when nobody has
 * quoted yet. Pure, so it is tested without Firebase.
 */

import type { BookingAcceptedPrice, BookingQuote, BookingTrip } from './bookings.ts';

/** Where the estimate comes from; '' = no estimate (the office prices it on the call). */
export type EstimateBasis = 'quote' | 'accepted' | 'fixed' | 'fullDay' | 'night' | 'trip' | '';

export type Estimate = { amount: number; basis: EstimateBasis };

/** The site's prices the estimate reads (site-settings.ts prices). */
export type EstimatePrices = {
  oneHour?: number;
  threeHours?: number;
  fullDay?: { from?: number; to?: number };
  nightFrom?: number;
};

export type EstimateBooking = {
  package: string;
  quote?: Pick<BookingQuote, 'amount'> | null;
  acceptedPrice?: Pick<BookingAcceptedPrice, 'amount'> | null;
  trip?: Pick<BookingTrip, 'estTo'> | null;
};

/**
 * Where an estimate comes from, in words for the admin panel ("full day (top
 * of the ₹1,000–1,200 range)"). The range formatter is passed in
 * (lib/settings.ts rupeeRange), so no figure is typed here.
 */
export function estimateBasisText(
  e: Estimate,
  prices: EstimatePrices,
  range: (from: number, to: number) => string,
): string {
  switch (e.basis) {
    case 'quote':
      return 'the price agreed on the call';
    case 'accepted':
      return 'the trip price the customer accepted in the app';
    case 'fixed':
      return 'fixed package price';
    case 'fullDay': {
      const { from = e.amount, to = e.amount } = prices.fullDay ?? {};
      return `full day (top of the ${range(from, to)} range)`;
    }
    case 'night':
      return 'night driver from-price';
    case 'trip':
      return 'the trip estimate the customer saw';
    default:
      return '';
  }
}

/** Whole rupees from 100 to 500000, else 0 (passed over). */
function whole(v: unknown): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 100 && n <= 500000 ? n : 0;
}

/**
 * In this order: the price agreed on the call (quote) → the trip price the
 * customer accepted in the app (accepted) → 1 hour / 3 hours: the fixed price
 * (fixed) → local full day: the top of its range (fullDay) → night driver:
 * its from-price (night) → outstation / one-way drop: the trip estimate the
 * customer saw (trip). Anything else — hospital / emergency, monthly,
 * wedding / event, a trip without an estimate — has none.
 */
export function estimateOf(b: EstimateBooking, prices: EstimatePrices): Estimate {
  const steps: [EstimateBasis, unknown][] = [
    ['quote', b.quote?.amount],
    ['accepted', b.acceptedPrice?.amount],
  ];
  if (b.package === '1-hour-300') steps.push(['fixed', prices.oneHour]);
  if (b.package === '3-hours-600') steps.push(['fixed', prices.threeHours]);
  if (b.package === 'local-full-day') steps.push(['fullDay', prices.fullDay?.to]);
  if (b.package === 'night-driver') steps.push(['night', prices.nightFrom]);
  if (b.package === 'outstation' || b.package === 'one-way-drop') steps.push(['trip', b.trip?.estTo]);
  for (const [basis, value] of steps) {
    const amount = whole(value);
    if (amount) return { amount, basis };
  }
  return { amount: 0, basis: '' };
}
