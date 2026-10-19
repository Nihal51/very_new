/**
 * The trip estimate as the booking form, the account page and /admin use it:
 * lib/outstation.ts (the maths) + the rates in site-settings.ts.
 */

import { TRIP_PACKAGES, type BookingQuote, type BookingTrip, type TripPackage } from './bookings';
import {
  destinations,
  estimate,
  findDestination,
  pickupCities,
  planTrip,
  roadKm,
  type Destination,
  type Estimate,
  type PickupCity,
  type TripKind,
  type TripPlan,
} from './outstation';
import { rupeeRange, rupees, tripRules } from './settings';

/** The picker's value for a place that is not in the list. */
export const ELSEWHERE = 'other';

export const destinationGroups = [
  { label: 'Chhattisgarh', items: destinations.filter((d) => d.region === 'cg') },
  { label: 'Other states', items: destinations.filter((d) => d.region === 'india') },
] as const;

const isPickupCity = (city: string): city is PickupCity => (pickupCities as readonly string[]).includes(city);

export type TripView = {
  kind: TripKind;
  /** Undefined for a place not in the list. */
  dest?: Destination;
  /** 0 when unknown (a place not in the list, or no pickup city yet). */
  km: number;
  /** Fewest days for the distance (1 when the distance is unknown). */
  minDays: number;
  /** The days to charge. */
  days: number;
  /** One-way: hours the driver is still travelling home after the paid days. */
  returnHours: number;
  plan?: TripPlan;
  est?: Estimate;
  /** The pickup city itself was chosen as the destination. */
  sameCity: boolean;
};

/**
 * Works out the trip for the form. `bookedDays` is what the customer typed (0
 * or less = as few as the distance allows).
 */
export function tripFor(pkg: TripPackage, city: string, destId: string, bookedDays: number): TripView {
  const kind = TRIP_PACKAGES[pkg];
  const dest = destId && destId !== ELSEWHERE ? findDestination(destId) : undefined;
  const sameCity = Boolean(dest && dest.name === city);
  if (!dest || !isPickupCity(city) || sameCity) {
    const days = Math.min(60, Math.max(1, Math.floor(bookedDays) || 1));
    return { kind, dest, km: 0, minDays: 1, days, returnHours: 0, sameCity };
  }
  const plan = planTrip(tripRules, roadKm(city, dest), kind, bookedDays);
  return {
    kind,
    dest,
    km: plan.km,
    minDays: plan.minDays,
    days: plan.days,
    returnHours: plan.returnHours,
    plan,
    est: estimate(tripRules, plan),
    sameCity,
  };
}

/** The trip as saved on the booking (firestore.rules: isTrip). */
export function tripRecord(view: TripView, typedPlace: string): BookingTrip {
  return {
    to: view.dest ? view.dest.name : typedPlace.trim(),
    destId: view.dest?.id ?? '',
    kind: view.kind,
    km: view.km,
    days: view.days,
    returnHours: view.returnHours,
    estFrom: view.est?.from ?? 0,
    estTo: view.est?.to ?? 0,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** 1214 → "1,214 km" */
export const kmText = (km: number) => `${new Intl.NumberFormat('en-IN').format(km)} km`;

/** "2 days" / "3 days + 11 h for the driver to get home". */
export function tripDays(t: Pick<BookingTrip, 'kind' | 'days' | 'returnHours'>): string {
  const days = plural(t.days, 'day');
  return t.kind === 'one-way' && t.returnHours > 0 ? `${days} + ${t.returnHours} h for the driver to get home` : days;
}

/** One line for WhatsApp, the confirmation and the account page. */
export function tripSummary(t: BookingTrip, city: string): string {
  return [
    `${city} → ${t.to}`,
    t.kind === 'round' ? 'round trip' : 'one-way drop',
    t.km > 0 ? `about ${kmText(t.km)}` : null,
    tripDays(t),
    t.estFrom > 0 ? `estimate ${rupeeRange(t.estFrom, t.estTo)}` : 'price on the call',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The estimate's breakdown lines, for the estimate card. */
export function estimateLines(view: TripView): { label: string; amount: string }[] {
  if (!view.est) return [];
  const rate = rupeeRange(tripRules.dayRate.from, tripRules.dayRate.to);
  const lines = [
    {
      label: `${plural(view.days, 'day')} × ${rate}`,
      amount: rupeeRange(view.est.driving.from, view.est.driving.to),
    },
  ];
  if (view.kind === 'one-way')
    lines.push(
      view.returnHours > 0
        ? {
            label: `Driver still on his way home ${plural(view.returnHours, 'hour')} after the last day × ${rupees(tripRules.returnHour)} (max ${rupees(tripRules.returnMaxPerDay)} a day)`,
            amount: rupees(view.est.returnCharge),
          }
        : { label: 'Driver’s bus/train home: within the paid days', amount: 'No charge' },
    );
  return lines;
}

/** "₹1,550 × 3 days + ₹1,200 return (11 h) + ₹650 ticket" — the agreed price, itemised. */
export function quoteBreakdown(q: Omit<BookingQuote, 'at'>): string {
  return [
    `${rupees(q.dayRate)} × ${plural(q.days, 'day')}`,
    q.returnHours > 0 ? `${rupees(q.returnCharge)} return (${q.returnHours} h)` : null,
    q.extraHours > 0 ? `${rupees(q.extraHourRate)} × ${plural(q.extraHours, 'extra hour')}` : null,
    q.ticket > 0 ? `${rupees(q.ticket)} ticket` : null,
  ]
    .filter(Boolean)
    .join(' + ');
}
