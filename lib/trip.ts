/**
 * The trip estimate as the booking form, the account page and /admin use it:
 * lib/outstation.ts (the maths) + the rates in site-settings.ts.
 */

import { TRIP_PACKAGES, type BookingQuote, type BookingTrip, type TripPackage } from './bookings';
import {
  DEFAULT_START_HOUR,
  destinations,
  estimate,
  findDestination,
  homeTravelHours,
  homeWay,
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
  /** One-way: hours after the driving days until the driver is home (any = a return day; past 24 = late hours). */
  returnHours: number;
  /** When the driver leaves: hour of the day, and the date if the customer picked one. */
  startHour: number;
  startDate?: { y: number; m: number; d: number };
  /** The customer picked a start time (otherwise DEFAULT_START_HOUR is assumed). */
  startKnown: boolean;
  /** How the driver gets home and the hours on board (timetables in lib/outstation.ts). */
  home?: { by: Destination['home']['by']; hours: number };
  plan?: TripPlan;
  est?: Estimate;
  /** The pickup city itself was chosen as the destination. */
  sameCity: boolean;
};

/**
 * "2026-10-20T09:30" (the form's date & time) or "09:30" (a time alone) → the
 * start hour of the day, and the date if there is one.
 */
export function parseStart(when: string): { startHour: number; startDate?: TripView['startDate'] } | null {
  const m = /^(?:(\d{4})-(\d{2})-(\d{2})T)?(\d{2}):(\d{2})/.exec(when.trim());
  if (!m) return null;
  const hour = Number(m[4]) + Number(m[5]) / 60;
  if (!(hour >= 0 && hour < 24)) return null;
  return {
    startHour: hour,
    ...(m[1] && { startDate: { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } }),
  };
}

/**
 * Works out the trip for the form. `bookedDays` is what the customer typed (0
 * or less = as few as the distance allows); `when` is when the driver leaves
 * (the form's date & time, or a time alone; empty = 7 AM).
 */
export function tripFor(pkg: TripPackage, city: string, destId: string, bookedDays: number, when = ''): TripView {
  const kind = TRIP_PACKAGES[pkg];
  const dest = destId && destId !== ELSEWHERE ? findDestination(destId) : undefined;
  const sameCity = Boolean(dest && dest.name === city);
  const start = parseStart(when);
  const startHour = start?.startHour ?? DEFAULT_START_HOUR;
  const when_ = { startHour, startKnown: Boolean(start), ...(start?.startDate && { startDate: start.startDate }) };
  if (!dest || !isPickupCity(city) || sameCity) {
    const days = Math.min(60, Math.max(1, Math.floor(bookedDays) || 1));
    return { kind, dest, km: 0, minDays: 1, days, returnHours: 0, sameCity, ...when_ };
  }
  const homeHours = homeTravelHours(dest, city) ?? 0;
  const plan = planTrip(tripRules, roadKm(city, dest), kind, bookedDays, homeWay(dest, city), startHour);
  return {
    kind,
    dest,
    km: plan.km,
    minDays: plan.minDays,
    days: plan.days,
    returnHours: plan.returnHours,
    home: { by: dest.home.by, hours: homeHours },
    plan,
    est: estimate(tripRules, plan),
    sameCity,
    ...when_,
  };
}

const TIME = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' });
const DATE = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * A moment `hours` after the start, rounded to 5 minutes: "Wed 22 Oct, 4:05 pm"
 * when the date is known, else "day 3, 4:05 pm".
 */
export function atText(view: Pick<TripView, 'startHour' | 'startDate'>, hours: number): string {
  const t = Math.round(((view.startHour + hours) * 60) / 5) * 5; // minutes after midnight of day 1
  const day = Math.floor(t / 1440);
  const time = TIME.format(new Date(Date.UTC(2000, 0, 1) + (t - day * 1440) * 60_000)).replace(/\s?(am|pm)$/i, ' $1');
  if (!view.startDate) return `day ${day + 1}, ${time}`;
  const { y, m, d } = view.startDate;
  return `${DATE.format(new Date(Date.UTC(y, m - 1, d + day)))}, ${time}`;
}

/** "7:00 am" — the start time alone. */
export const startText = (view: Pick<TripView, 'startHour'>) => atText({ startHour: view.startHour }, 0).replace(/^day 1, /, '');

/**
 * The one-way drop hour by hour, for the estimate card: when he leaves, drops
 * the car, catches his train or bus, is home — and when the driving days end.
 */
export function tripTimeline(view: TripView, city: string): { label: string; value: string }[] {
  const p = view.plan;
  if (!p || view.kind !== 'one-way' || p.dropAt === undefined || p.homeAt === undefined) return [];
  const at = (h: number) => atText(view, h);
  const rows = [
    { label: `Leaves ${city}`, value: at(0) },
    { label: `Drops the car in ${view.dest?.name ?? 'the city'}`, value: `about ${at(p.dropAt)}` },
    p.train
      ? { label: 'Train home (you book his ticket)', value: `${p.train.no} ${p.train.name}, ${at(p.leaveAt ?? p.dropAt)}` }
      : { label: `Way home (you book his ticket)`, value: view.home ? homeText(view.home) : 'bus or train' },
    { label: `Home in ${city}`, value: `about ${at(p.homeAt)}` },
    { label: `${plural(view.days, 'driving day')} end`, value: at(view.days * 24) },
  ];
  if (p.returnDay) rows.push({ label: 'Return day ends', value: at(view.days * 24 + 24) });
  return rows;
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

/** "train, about 23 h" — the driver's way home, rounded to the hour. */
export const homeText = (home: NonNullable<TripView['home']>) =>
  `${home.by}, about ${Math.max(1, Math.round(home.hours))} h`;

/** 1214 → "1,214 km" */
export const kmText = (km: number) => `${new Intl.NumberFormat('en-IN').format(km)} km`;

/** "2 days" / "2 days + a return day" / "2 days + a return day + 6 late hours". */
export function tripDays(t: Pick<BookingTrip, 'kind' | 'days' | 'returnHours'>): string {
  const days = plural(t.days, 'day');
  if (t.kind !== 'one-way' || t.returnHours <= 0) return days;
  const late = Math.max(0, t.returnHours - 24);
  return `${days} + a return day${late ? ` + ${plural(late, 'late hour')}` : ''}`;
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
  if (view.kind === 'one-way') {
    const late = view.plan?.lateHours ?? Math.max(0, view.returnHours - 24);
    if (view.returnHours > 0) {
      lines.push({
        label: `Return day: the driver is still on his way home when the driving days end`,
        amount: rupees(view.est.returnDayCharge),
      });
      if (late > 0)
        lines.push({
          label: `${plural(late, 'late hour')} after the return day × ${rupees(tripRules.returnHour)} (max ${rupees(tripRules.returnMaxPerDay)} a day)`,
          amount: rupees(view.est.lateCharge),
        });
    } else {
      lines.push({ label: 'Driver’s way home: he is home before the driving days end', amount: 'No charge' });
    }
  }
  return lines;
}

/** "₹1,550 × 2 days + ₹1,200 return day + ₹650 ticket" — the agreed price, itemised. */
export function quoteBreakdown(q: Omit<BookingQuote, 'at'>): string {
  const late = Math.max(0, q.returnHours - 24);
  return [
    `${rupees(q.dayRate)} × ${plural(q.days, 'day')}`,
    q.returnHours > 0 ? `${rupees(q.returnCharge)} return day${late ? ` + ${plural(late, 'late hour')}` : ''}` : null,
    q.extraHours > 0 ? `${rupees(q.extraHourRate)} × ${plural(q.extraHours, 'extra hour')}` : null,
    q.ticket > 0 ? `${rupees(q.ticket)} ticket` : null,
  ]
    .filter(Boolean)
    .join(' + ');
}
