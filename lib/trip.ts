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
  returnDays: number;
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
    return { kind, dest, km: 0, minDays: 1, days, returnDays: 0, sameCity };
  }
  const plan = planTrip(tripRules, roadKm(city, dest), kind, bookedDays);
  return {
    kind,
    dest,
    km: plan.km,
    minDays: plan.minDays,
    days: plan.days,
    returnDays: plan.returnDays,
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
    returnDays: view.returnDays,
    estFrom: view.est?.from ?? 0,
    estTo: view.est?.to ?? 0,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** 1214 → "1,214 km" */
export const kmText = (km: number) => `${new Intl.NumberFormat('en-IN').format(km)} km`;

/** "1 driving day + 1 return day" / "2 days". */
export function tripDays(t: Pick<BookingTrip, 'kind' | 'days' | 'returnDays'>): string {
  if (t.kind === 'round') return plural(t.days, 'day');
  return plural(t.days, 'driving day') + (t.returnDays > 0 ? ` + ${plural(t.returnDays, 'return day')}` : '');
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
      label: `${plural(view.days, view.kind === 'round' ? 'day' : 'driving day')} × ${rate}`,
      amount: rupeeRange(view.est.driving.from, view.est.driving.to),
    },
  ];
  if (view.returnDays > 0)
    lines.push({
      label: `${plural(view.returnDays, 'day')} for the driver to get home × ${rupeeRange(tripRules.returnDay.from, tripRules.returnDay.to)}`,
      amount: rupeeRange(view.est.returnCharge.from, view.est.returnCharge.to),
    });
  return lines;
}

/** "₹1,550 × 2 days + ₹1,000 × 1 return day + ₹650 ticket" — the agreed price, itemised. */
export function quoteBreakdown(q: Omit<BookingQuote, 'at'>): string {
  return [
    `${rupees(q.dayRate)} × ${plural(q.days, 'day')}`,
    q.returnDays > 0 ? `${rupees(q.returnDay)} × ${plural(q.returnDays, 'return day')}` : null,
    q.extraHours > 0 ? `${rupees(q.extraHourRate)} × ${plural(q.extraHours, 'extra hour')}` : null,
    q.ticket > 0 ? `${rupees(q.ticket)} ticket` : null,
  ]
    .filter(Boolean)
    .join(' + ');
}
