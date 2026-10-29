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
  pickupStations,
  planTrip,
  returnWords,
  dayRateFor,
  roadKm,
  withReturn,
  type Destination,
  type Estimate,
  type PickupCity,
  type TripKind,
  type TripPlan,
} from './outstation';
import { returnParts, type ReturnOption } from './rail';
import { rupeeRange, rupees, settings, tripRules } from './settings';

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
  /** Fewest calendar days for the distance (1 when the distance is unknown). */
  minDays: number;
  /** Calendar days of the trip (more if the customer booked more). */
  days: number;
  /** One-way: hours from the drop until the driver is home, the waiting included. */
  returnHours: number;
  /** One-way: the customer wants it driven day and night, without the night's rest. */
  nonstop: boolean;
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
  /** One-way: the train home from the lookup that the plan and the estimate use (withTrain). */
  ret?: ReturnOption;
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
 * (the form's date & time, or a time alone; empty = 7 AM) — the date gives the
 * weekday, which some trains need; `nonstop`: drive day and night (one-way).
 */
export function tripFor(
  pkg: TripPackage,
  city: string,
  destId: string,
  bookedDays: number,
  when = '',
  nonstop = false,
): TripView {
  const kind = TRIP_PACKAGES[pkg];
  const dest = destId && destId !== ELSEWHERE ? findDestination(destId) : undefined;
  const sameCity = Boolean(dest && dest.name === city);
  const start = parseStart(when);
  const startHour = start?.startHour ?? DEFAULT_START_HOUR;
  const when_ = { startHour, startKnown: Boolean(start), ...(start?.startDate && { startDate: start.startDate }) };
  const straight = nonstop && kind === 'one-way';
  if (!dest || !isPickupCity(city) || sameCity) {
    const days = Math.min(60, Math.max(1, Math.floor(bookedDays) || 1));
    return { kind, dest, km: 0, minDays: 1, days, returnHours: 0, nonstop: straight, sameCity, ...when_ };
  }
  const homeHours = homeTravelHours(dest, city) ?? 0;
  const sd = start?.startDate;
  const weekday = sd ? new Date(Date.UTC(sd.y, sd.m - 1, sd.d)).getUTCDay() : undefined;
  const plan = planTrip(
    tripRules,
    roadKm(city, dest),
    kind,
    bookedDays,
    homeWay(dest, city),
    { hour: startHour, ...(weekday !== undefined && { weekday }) },
    straight,
  );
  return {
    kind,
    dest,
    km: plan.km,
    minDays: plan.minDays,
    days: plan.days,
    returnHours: plan.returnHours,
    nonstop: straight,
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

/** "about 22 h" — hours rounded, never 0. */
const aboutHours = (h: number) => `about ${Math.max(1, Math.round(h))} h`;

/* --------------------------------------------------- the train home ---- */

const IST_MS = 330 * 60_000;
const WHEN = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Kolkata',
});

/** An instant → "Fri, 31 Oct, 11:40 pm" (India time). */
export const whenText = (ms: number) => WHEN.format(new Date(ms)).replace(/\s?(am|pm)$/i, ' $1');

/** 95 → "1 h 35 m". */
export function hmText(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m - h * 60;
  return h && r ? `${h} h ${r} m` : h ? `${h} h` : `${r} m`;
}

/** When the driver leaves, as an instant — only when the customer picked a date. */
export function startInstant(view: Pick<TripView, 'startDate' | 'startHour'>): number | undefined {
  const sd = view.startDate;
  if (!sd) return undefined;
  return Date.UTC(sd.y, sd.m - 1, sd.d) + Math.round(view.startHour * 60) * 60_000 - IST_MS;
}

/**
 * What the train lookup needs for this trip: the destination's stations and
 * change stations, the pickup city's home station, and when he drops the car
 * and can board (drop + stationHours). Undefined when there is nothing to
 * look up: a round trip, a bus route, or no date picked yet.
 */
export function railInput(view: TripView, city: string) {
  const p = view.plan;
  const start = startInstant(view);
  if (view.kind !== 'one-way' || !view.dest?.rail || !p || p.dropAt === undefined || start === undefined) return undefined;
  if (!(pickupCities as readonly string[]).includes(city)) return undefined;
  const drop = start + Math.round(p.dropAt * 60) * 60_000;
  return {
    stations: [...view.dest.rail.stations],
    hubs: [...(view.dest.rail.hubs ?? [])],
    home: pickupStations[city as PickupCity] as string,
    drop,
    ready: drop + Math.round(tripRules.stationHours * 60) * 60_000,
  };
}

/** The trip with a train from the lookup in place of the allowance: the plan, the way home and the estimate. */
export function withTrain(view: TripView, option: ReturnOption | undefined): TripView {
  const start = startInstant(view);
  if (!option || !view.plan || view.plan.dropAt === undefined || start === undefined) return view;
  const h = (ms: number) => (ms - start) / 3_600_000;
  const plan = withReturn(view.plan, h(option.depart), h(option.arrive));
  if (plan === view.plan) return view;
  return { ...view, plan, returnHours: plan.returnHours, est: estimate(tripRules, plan), ret: option };
}

/** The way home split up: waiting (getting to the station included) and travelling, hours. */
export function wayHome(view: TripView): { wait: number; travel: number; total: number } | undefined {
  const p = view.plan;
  if (!p || p.dropAt === undefined || p.leaveAt === undefined || p.homeAt === undefined) return undefined;
  return { wait: p.leaveAt - p.dropAt, travel: p.homeAt - p.leaveAt, total: p.returnHours };
}

/**
 * The one-way drop hour by hour, for the estimate card: when he leaves, how
 * he drives, when he drops the car, then either the train from the lookup
 * (each train, the change and the wait, with real dates) or — when no train
 * is confirmed — the typical way home, labelled as such.
 */
export function tripTimeline(view: TripView, city: string): { label: string; value: string }[] {
  const p = view.plan;
  if (!p || view.kind !== 'one-way' || p.dropAt === undefined || p.homeAt === undefined) return [];
  const at = (h: number) => atText(view, h);
  const driving = p.nonstop
    ? `${aboutHours(p.driveHours)}, day and night`
    : p.minDays > 1
      ? `${aboutHours(p.driveHours)}: about ${tripRules.hoursPerDay} h a day, resting at night`
      : aboutHours(p.driveHours);
  const rows = [
    { label: `Leaves ${city}`, value: at(0) },
    { label: 'Driving', value: driving },
    { label: `Drops the car in ${view.dest?.name ?? 'the city'}`, value: `about ${at(p.dropAt)}` },
  ];
  const o = view.ret;
  if (o) {
    rows.push({ label: 'Waits for his train (getting to the station included)', value: hmText(o.waitMinutes) });
    o.legs.forEach((l, i) => {
      rows.push({
        label: `${o.legs.length > 1 ? `Train ${i + 1}` : 'Train home'}: ${l.train.number} ${l.train.name}`,
        value: `${l.from.name} ${whenText(l.depart)} → ${l.to.name} ${whenText(l.arrive)}`,
      });
      const next = o.legs[i + 1];
      if (next)
        rows.push({
          label: `Waits at ${l.to.name} for train ${i + 2} (counted)`,
          value: hmText((next.depart - l.arrive) / 60_000),
        });
    });
    rows.push({ label: `Home in ${city}`, value: `${o.scheduled ? 'about ' : ''}${whenText(o.expectedArrive)}` });
  } else {
    rows.push({
      label: 'Way home (typical time — no train confirmed)',
      value: view.home ? homeText(view.home) : 'bus or train',
    });
    rows.push({ label: `Home in ${city}`, value: `about ${at(p.homeAt)}` });
  }
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

/** "2 days" / "2 days + 23 h for the driver to get home". */
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
  const p = view.plan;
  if (!view.est || !p) return [];
  const day = dayRateFor(tripRules, p.km);
  const rate = rupeeRange(day.from, day.to);
  if (view.kind === 'round') {
    return [{ label: `${plural(p.fullDays, 'day')} × ${rate}`, amount: rupeeRange(view.est.driving.from, view.est.driving.to) }];
  }
  const lines: { label: string; amount: string }[] = [];
  if (p.fullDays > 0)
    lines.push({
      label: `${plural(p.fullDays, 'driving day')} (${tripRules.hoursPerDay} h each) × ${rate}`,
      amount: rupeeRange(p.fullDays * day.from, p.fullDays * day.to),
    });
  if (p.extraHours > 0)
    lines.push({
      label: `${plural(p.extraHours, 'driving hour')}${p.fullDays > 0 ? ' more' : ''} × ${rupees(tripRules.extraHour)}`,
      amount: rupees(view.est.extraCharge),
    });
  const w = wayHome(view);
  // A real train: the wait and the ride. No train confirmed: the typical time, said plainly — not a "wait".
  const split = !w
    ? ''
    : view.ret
      ? ` (${returnParts(view.ret).join(' + ')})`
      : ' (typical time, no train confirmed yet)';
  lines.push(
    p.returnHours > 0
      ? {
          label: `Driver’s way home: ${plural(p.returnHours, 'hour')} from the drop until he is home${split} = ${returnWords(p.returnHours, tripRules.returnHour, tripRules.returnMaxPerDay, tripRules.returnFullDayAfter, rupees)}`,
          amount: rupees(view.est.returnCharge),
        }
      : { label: 'Driver’s way home', amount: 'No charge' },
  );
  return lines;
}

/** What the estimate does NOT include, each on its own line: paid separately or given directly. */
export function notIncluded(view: TripView): string[] {
  return [
    ...(view.kind === 'one-way' ? ['His train or bus ticket home: you book and pay for it'] : []),
    `His meals: please give them, or ${rupees(settings.outstation.mealAllowance)} a day`,
    'Fuel, tolls and parking: you pay as you go',
    'A hotel, only if a stop for the night is planned with you on the call',
  ];
}

/** "₹1,550 × 2 days + ₹120 × 1 extra hour + ₹2,400 way home (35 h) + ₹650 ticket" — the agreed price, itemised. */
export function quoteBreakdown(q: Omit<BookingQuote, 'at'>): string {
  return [
    q.days > 0 ? `${rupees(q.dayRate)} × ${plural(q.days, 'day')}` : null,
    q.extraHours > 0 ? `${rupees(q.extraHourRate)} × ${plural(q.extraHours, 'extra hour')}` : null,
    q.returnHours > 0 ? `${rupees(q.returnCharge)} way home (${q.returnHours} h)` : null,
    q.ticket > 0 ? `${rupees(q.ticket)} ticket` : null,
  ]
    .filter(Boolean)
    .join(' + ');
}
