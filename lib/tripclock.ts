/**
 * The trip clock: the driver's link (/trip/?k=…) where he taps Start, Car
 * dropped and Home, and the final bill /admin works out from those times
 * (lib/outstation.ts finalBill).
 *
 * Pure: no Firebase and no @/ imports, so Node tests (scripts/tripclock.test.mjs)
 * run it as it is. The Firestore calls are in lib/tripclock-db.ts; the rules
 * that guard them in firestore.rules (tripLinks, isBill, isClock).
 */

import type { Booking, BookingBill, BookingClock } from './bookings.ts';
import {
  dayRateFor,
  finalBill,
  isLongOneWay,
  pricedByTime,
  pricedLong,
  returnCost,
  returnWords,
  type Bill,
  type TripKind,
  type TripRules,
} from './outstation.ts';

export type TripStep = 'start' | 'drop' | 'home';

export type Loc = { lat: number; lng: number; acc: number };

/** A tripLinks document (firestore.rules). Times are when they reached the server. */
export type TripLink = {
  key: string;
  bookingId: string;
  ref: string;
  /** Where the car goes. */
  to: string;
  kind: TripKind;
  /** Day and night: every 12 h of driving is a day (otherwise each 24 h is). */
  nonstop: boolean;
  driverName: string;
  /** Closed once the final bill is saved: no more taps. */
  closed: boolean;
  createdAt?: Date;
  startAt?: Date;
  dropAt?: Date;
  homeAt?: Date;
  /** The phone's own clock at the tap (it may have been offline). */
  startPhone?: Date;
  dropPhone?: Date;
  homePhone?: Date;
  startLoc?: Loc;
  dropLoc?: Loc;
  homeLoc?: Loc;
};

/** The steps of a trip, in order. A round trip has no drop: he comes back with the customer. */
export const stepsFor = (kind: TripKind): TripStep[] => (kind === 'one-way' ? ['start', 'drop', 'home'] : ['start', 'home']);

/** The step the driver taps next, or null when the trip is done. */
export function nextStep(l: Pick<TripLink, 'kind' | 'startAt' | 'dropAt' | 'homeAt'>): TripStep | null {
  return stepsFor(l.kind).find((s) => !l[`${s}At`]) ?? null;
}

export const STEP_TEXT: Record<TripStep, { en: string; hi: string }> = {
  start: { en: 'Trip started', hi: 'ट्रिप शुरू' },
  drop: { en: 'Car dropped', hi: 'गाड़ी छोड़ दी' },
  home: { en: 'Home', hi: 'घर पहुँच गए' },
};

/** The name of a step on a trip of this kind ("Back" ends a round trip). */
export function stepName(step: TripStep, kind: TripKind, lang: 'en' | 'hi' = 'en'): string {
  if (step === 'home' && kind === 'round') return lang === 'hi' ? 'ट्रिप पूरी, वापस आ गए' : 'Trip over, back home';
  return STEP_TEXT[step][lang];
}

/* --------------------------------------------------------------- times ---- */

const IST = 'Asia/Kolkata';
const whenFmt = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: IST,
});
const timeFmt = new Intl.DateTimeFormat('en-IN', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: IST,
});

/** "Thu, 29 Oct, 7:45 am" (India time). */
export const whenText = (d?: Date) => (d ? whenFmt.format(d) : '');
/** "7:45 am" (India time). */
export const timeText = (d?: Date) => (d ? timeFmt.format(d) : '');

/** 1735 → "28 h 55 m"; 120 → "2 h"; 45 → "45 m". */
export function durationText(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  const h = Math.floor(m / 60);
  const r = m - h * 60;
  return h && r ? `${h} h ${r} m` : h ? `${h} h` : `${r} m`;
}

/** A Date → "2026-10-30T12:40" in India time, for a datetime-local input. */
export function toLocalInput(d?: Date): string {
  if (!d) return '';
  const t = new Date(d.getTime() + 330 * 60_000);
  return t.toISOString().slice(0, 16);
}

/** "2026-10-30T12:40" (India time) → the instant; undefined if it is not a date and time. */
export function fromLocalInput(s: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec((s ?? '').trim());
  if (!m) return undefined;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const t = Date.UTC(y, mo - 1, d, h, mi) - 330 * 60_000;
  return Number.isFinite(t) ? new Date(t) : undefined;
}

/** The phone's clock differs from the server's by more than this: /admin offers the phone's time. */
export const PHONE_GAP_MINUTES = 10;

/** The phone time of a tap when it is far from the server's (he tapped offline), else undefined. */
export function phoneGap(l: TripLink, step: TripStep): Date | undefined {
  const at = l[`${step}At`];
  const phone = l[`${step}Phone`];
  if (!at || !phone) return undefined;
  return Math.abs(at.getTime() - phone.getTime()) > PHONE_GAP_MINUTES * 60_000 ? phone : undefined;
}

/** "Driver left Thu, 29 Oct, 7:45 am · car dropped Fri, 30 Oct, 12:40 pm · driver home Sun, 1 Nov, 2:20 am" — for the customer. */
export function clockText(c: BookingClock, kind: TripKind): string {
  return [
    c.startAt ? `Driver left ${whenText(c.startAt)}` : null,
    kind === 'one-way' && c.dropAt ? `car dropped ${whenText(c.dropAt)}` : null,
    c.homeAt ? `${kind === 'one-way' ? 'driver home' : 'back'} ${whenText(c.homeAt)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Google Maps link for where he tapped. */
export const mapLink = (l: Loc) => `https://www.google.com/maps?q=${l.lat.toFixed(5)},${l.lng.toFixed(5)}`;

/* ---------------------------------------------------------------- bill ---- */

export type BillRates = {
  dayRate: number;
  extraHourRate: number;
  returnHourRate: number;
  ticket: number;
  /** One-way priced by the driver's time (finalBill): the km. */
  time?: { km: number };
  /** A route price (quotes from before 8 Nov 2026) and the hours away it was planned for (finalBill). */
  route?: { price: number; awayHours: number; km: number };
  /** A long one-way drop (24 Nov 2026): the km (finalBill: driving days, then his way home). */
  long?: { km: number };
};

/**
 * The rates for the bill: the agreed price's, or — no quote — the estimate's.
 * One-way to a known place (`km`, one way) without a quote, or with a quote
 * from 8 Nov 2026: the driver's time at the day price (the agreed one, or the
 * estimate's for the distance) and extraHour. Quotes from before then keep
 * their own way: a route price (awayHours), or by the hours. `oneWay`: false
 * for a round trip (the days at the day price).
 */
export function billRates(quote: Booking['quote'], rules: TripRules, km?: number, oneWay = true): BillRates {
  const base = {
    extraHourRate: quote?.extraHourRate ?? rules.extraHour,
    returnHourRate: quote?.returnHourRate ?? rules.returnHour,
    ticket: quote?.ticket ?? 0,
  };
  if (quote?.awayHours)
    return { ...base, dayRate: quote.dayRate, route: { price: quote.dayRate, awayHours: quote.awayHours, km: quote.km ?? km ?? 0 } };
  // A long one-way drop (24 Nov 2026): the agreed driving day and way-home hour.
  if (quote && oneWay && pricedLong(rules, quote)) return { ...base, dayRate: quote.dayRate, long: { km: quote.km ?? 0 } };
  if (quote && pricedByTime(quote)) return { ...base, dayRate: quote.dayRate, time: { km: quote.km ?? 0 } };
  if (quote) return { ...base, dayRate: quote.dayRate };
  // No quote: the estimate's rates — a long one-way drop at the settings' driving day and hour.
  if (oneWay && rules.oneWay && isLongOneWay(rules, km))
    return { ...base, dayRate: rules.oneWay.driveDay, returnHourRate: rules.oneWay.returnHour, long: { km: km ?? 0 } };
  const dayRate = dayRateFor(rules, km).from;
  return oneWay && km ? { ...base, dayRate, time: { km } } : { ...base, dayRate };
}

export type BillNow = {
  bill: Bill;
  /** He is home (or back): this is the final bill, not the bill so far. */
  final: boolean;
};

/**
 * The bill from the times so far: while he drives, driving until `now`; after
 * the drop, the way home until `now`; once he is home, the final bill.
 * Undefined before he starts.
 */
export function billNow(
  l: Pick<TripLink, 'kind' | 'nonstop' | 'startAt' | 'dropAt' | 'homeAt'>,
  rates: BillRates,
  rules: TripRules,
  graceMinutes: number,
  now: number,
): BillNow | undefined {
  if (!l.startAt) return undefined;
  const startAt = l.startAt.getTime();
  const dropAt = l.kind === 'one-way' ? l.dropAt?.getTime() : undefined;
  const homeAt = l.homeAt?.getTime() ?? Math.max(now, dropAt ?? startAt);
  const bill = finalBill(rules, {
    kind: l.kind,
    nonstop: l.nonstop,
    startAt,
    dropAt,
    homeAt,
    ...rates,
    graceMinutes,
  });
  return { bill, final: Boolean(l.homeAt) };
}

/** The bill as saved on the booking (firestore.rules isBill) — what the customer pays, nothing else. */
export function bookingBill(b: Bill, nonstop: boolean): Omit<BookingBill, 'at'> {
  return {
    amount: b.amount,
    dayRate: b.dayRate,
    days: b.days,
    extraHours: b.extraHours,
    extraHourRate: b.extraHourRate,
    extraCharge: b.extraCharge,
    returnHours: b.returnHours,
    returnHourRate: b.returnHourRate,
    returnCharge: b.returnCharge,
    ...(b.route && { awayHours: b.route.awayHours, km: b.route.km }),
    // Priced by the driver's time: the km (with no route hours) says so; a long one-way drop: its km.
    ...(b.time && { km: b.time.km }),
    ...(b.long && { km: b.long.km }),
    ticket: b.ticket,
    nonstop,
  };
}

const inr = new Intl.NumberFormat('en-IN');
const rupees = (n: number) => `₹${inr.format(Math.round(n))}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The bill line by line: [what, amount]. */
export function billLines(
  b: Pick<
    Bill,
    | 'days'
    | 'dayRate'
    | 'extraHours'
    | 'extraHourRate'
    | 'extraCharge'
    | 'returnHours'
    | 'returnHourRate'
    | 'returnCharge'
    | 'ticket'
  > &
    Partial<Pick<Bill, 'route' | 'time' | 'long'>>,
  rules: Pick<TripRules, 'returnHour' | 'returnMaxPerDay' | 'returnFullDayAfter'>,
): { label: string; amount: string }[] {
  const lines: { label: string; amount: string }[] = [];
  // A long one-way drop (24 Nov 2026): the driving days, then his way home.
  if (b.long) {
    lines.push({
      label: `Driving (start → drop, ${inr.format(b.long.km)} km): ${plural(b.days, 'driving day')} × ${rupees(b.dayRate)}`,
      amount: rupees(b.days * b.dayRate),
    });
    const parts = [
      b.long.returnFullDays ? `${plural(b.long.returnFullDays, 'day')} × ${rupees(b.long.returnDay)}` : null,
      b.long.returnLeftoverHours ? `${b.long.returnLeftoverHours} h × ${rupees(b.returnHourRate)}` : null,
    ].filter(Boolean);
    lines.push({
      label: `His way home (drop → home), ${b.returnHours} h: ${parts.join(' + ') || 'nothing'} (never more than ${rupees(b.long.returnDay)} a day)`,
      amount: rupees(b.returnCharge),
    });
    if (b.ticket > 0) lines.push({ label: 'Ticket home (we bought it)', amount: rupees(b.ticket) });
    return lines;
  }
  // The driver's time (8 Nov 2026): leaves → home in 24-hour blocks, the hours past them by the hour.
  if (b.time) {
    const km = b.time.km ? `${inr.format(b.time.km)} km, ` : '';
    lines.push({
      label:
        b.time.short && b.days === 1 && b.extraHours === 0
          ? `Driver’s time: ${b.time.hours} h, leaves → home (${km}home the same day) — one price`
          : `Driver’s time: ${b.time.hours} h, leaves → home (${km}his wait and train home included) = ${b.days} × 24 h × ${rupees(b.dayRate)}`,
      amount: rupees(b.days * b.dayRate),
    });
    if (b.extraHours > 0)
      lines.push({
        label: `${plural(b.extraHours, 'hour')} past the ${b.days * 24} h × ${rupees(b.extraHourRate)} (never more than one more day)`,
        amount: rupees(b.extraCharge),
      });
    if (b.ticket > 0) lines.push({ label: 'Ticket home (we bought it)', amount: rupees(b.ticket) });
    return lines;
  }
  // A route price: the price, then any hours he was home later than planned.
  if (b.route) {
    lines.push({
      label: `Route price (${b.route.km ? `${inr.format(b.route.km)} km, ` : ''}planned about ${b.route.awayHours} h away, his way home included)`,
      amount: rupees(b.dayRate),
    });
    if (b.extraHours > 0) {
      const paid = b.route.paidDays ?? Math.max(1, Math.ceil(b.route.awayHours / 24));
      lines.push({
        label: `Away ${b.route.realAwayHours} h — past the ${plural(paid, 'day')} paid (${paid * 24} h): ${plural(b.extraHours, 'hour')} × ${rupees(b.extraHourRate)}, at most ${rupees(Math.round(b.extraHourRate * (rules.returnMaxPerDay / rules.returnHour)))} for each 24 h`,
        amount: rupees(b.extraCharge),
      });
    }
    if (b.ticket > 0) lines.push({ label: 'Ticket home (we bought it)', amount: rupees(b.ticket) });
    return lines;
  }
  if (b.days > 0)
    lines.push({
      label: `${plural(b.days, 'day')} × ${rupees(b.dayRate)}`,
      amount: rupees(b.days * b.dayRate),
    });
  if (b.extraHours > 0)
    lines.push({
      label:
        `${plural(b.extraHours, 'driving hour')} more × ${rupees(b.extraHourRate)}` +
        (b.extraCharge < b.extraHours * b.extraHourRate ? ` (at most one day)` : ''),
      amount: rupees(b.extraCharge),
    });
  if (b.returnHours > 0) {
    const max = Math.round((b.returnHourRate * rules.returnMaxPerDay) / rules.returnHour);
    lines.push({
      label: `Driver’s way home: ${b.returnHours} h = ${returnWords(b.returnHours, b.returnHourRate, max, rules.returnFullDayAfter, rupees)}`,
      amount: rupees(b.returnCharge),
    });
  }
  if (b.ticket > 0)
    lines.push({
      label: 'Ticket home (we bought it)',
      amount: rupees(b.ticket),
    });
  return lines;
}

/** "₹1,750 × 2 × 24 h of the driver’s time + ₹390 for 3 h past them + ₹650 ticket" — for the customer's booking. */
export function billBreakdown(
  b: Pick<Bill, 'days' | 'dayRate' | 'extraHours' | 'extraCharge' | 'returnHours' | 'returnCharge' | 'ticket'> &
    Partial<Pick<Bill, 'route' | 'time' | 'long'>> & { awayHours?: number; km?: number },
): string {
  // The driver's time (a bill from finalBill, or one saved on a booking from 8 Nov 2026).
  if (b.time || pricedByTime(b)) {
    const hours = b.time ? ` (${b.time.hours} h, leaves → home)` : '';
    return [
      b.days === 1 && b.extraHours === 0
        ? `${rupees(b.dayRate)} for the driver’s time${hours || ' (up to 24 h, his way home included)'}`
        : `${rupees(b.dayRate)} × ${b.days} × 24 h of the driver’s time${hours}`,
      b.extraHours > 0 ? `${rupees(b.extraCharge)} for ${plural(b.extraHours, 'hour')} past them` : null,
      b.ticket > 0 ? `${rupees(b.ticket)} ticket` : null,
    ]
      .filter(Boolean)
      .join(' + ');
  }
  // A route price (a bill from finalBill, or one saved on a booking).
  const away = b.route?.awayHours ?? b.awayHours;
  if (away)
    return [
      `${rupees(b.dayRate)} route price (about ${away} h away, way home included)`,
      b.extraHours > 0 ? `${rupees(b.extraCharge)} for ${plural(b.extraHours, 'hour')} past the days paid` : null,
      b.ticket > 0 ? `${rupees(b.ticket)} ticket` : null,
    ]
      .filter(Boolean)
      .join(' + ');
  return [
    b.days > 0 ? `${rupees(b.dayRate)} × ${plural(b.days, b.long ? 'driving day' : 'day')}` : null,
    b.extraHours > 0
      ? b.days === 0
        ? `${rupees(b.extraCharge)} for ${b.extraHours} h of driving`
        : `${rupees(b.extraCharge)} for ${plural(b.extraHours, 'extra hour')}`
      : null,
    b.returnHours > 0 ? `${rupees(b.returnCharge)} way home (${b.returnHours} h)` : null,
    b.ticket > 0 ? `${rupees(b.ticket)} ticket` : null,
  ]
    .filter(Boolean)
    .join(' + ');
}

/** "2 days + 5 h" — the driving as charged; the driver's time: "56 h away: 2 × 24 h + 8 h"; a route price: "route price, 62 h away". */
export const daysText = (b: Pick<Bill, 'days' | 'extraHours'> & Partial<Pick<Bill, 'route' | 'time'>>) =>
  b.time
    ? `${b.time.hours} h away: ${b.days} × 24 h${b.extraHours > 0 ? ` + ${b.extraHours} h` : ''}`
    : b.route
    ? `route price, ${b.route.realAwayHours} h away`
    : [b.days > 0 ? plural(b.days, 'day') : null, b.extraHours > 0 || b.days === 0 ? `${b.extraHours} h` : null]
        .filter(Boolean)
        .join(' + ');

/**
 * What the driver is paid for the trip, from his day cost and his hourly pay
 * — the same way as the quote. The driver's time (8 Nov 2026): his cost for
 * each 24-hour block and `hourPay` for each hour past them (at most his day
 * cost). Round trips and older bills: his extra hours at a twelfth of his day,
 * at most one more day; his way home (`hourPay` an hour) with the same daily
 * maximum in hours as the customer's. Admin-only: never saved on the booking.
 */
export function driverPay(
  b: Pick<Bill, 'days' | 'extraHours' | 'returnHours'> & Partial<Pick<Bill, 'route' | 'time' | 'long'>>,
  dayCost: number,
  hourPay: number,
  rules: Pick<TripRules, 'hoursPerDay' | 'returnHour' | 'returnMaxPerDay' | 'returnFullDayAfter'>,
): number {
  const returnHourPay = hourPay;
  // A long one-way drop: his day for each driving day and each full 24 h home, his hourly pay for the rest (at most a day).
  if (b.long) return (b.days + b.long.returnFullDays) * dayCost + Math.min(dayCost, b.long.returnLeftoverHours * hourPay);
  if (b.time) return b.days * dayCost + Math.min(b.extraHours * hourPay, dayCost);
  // A route price: his day cost for each day paid, and his hourly pay for the hours past them (at most a day for each 24 h).
  if (b.route) {
    const paid = b.route.paidDays ?? Math.max(1, Math.ceil(b.route.awayHours / 24));
    const max = Math.min(dayCost, returnHourPay * (rules.returnMaxPerDay / rules.returnHour));
    return paid * dayCost + (b.extraHours > 0 ? returnCost(b.extraHours, returnHourPay, max, 24) : 0);
  }
  const capHours = rules.returnMaxPerDay / rules.returnHour;
  return Math.round(
    b.days * dayCost +
      Math.min((b.extraHours * dayCost) / rules.hoursPerDay, dayCost) +
      returnCost(b.returnHours, returnHourPay, returnHourPay * capHours, rules.returnFullDayAfter),
  );
}

/* ------------------------------------------------------------ messages ---- */

const firstName = (name: string) => (name ?? '').trim().split(/\s+/)[0] || '';

/** WhatsApp to the driver with his link, Hindi first. */
export function driverMessage(l: Pick<TripLink, 'ref' | 'to' | 'kind' | 'driverName'>, city: string, url: string): string {
  const name = firstName(l.driverName);
  const trip = `${l.ref ? `${l.ref}: ` : ''}${city} → ${l.to}`;
  const hi =
    l.kind === 'one-way'
      ? 'गाड़ी लेकर निकलते ही "ट्रिप शुरू", गाड़ी सौंपते ही "गाड़ी छोड़ दी" और घर पहुँचते ही "घर पहुँच गए" दबाइए।'
      : 'गाड़ी लेकर निकलते ही "ट्रिप शुरू" और ट्रिप पूरी होकर वापस आते ही "वापस आ गए" दबाइए।';
  const en =
    l.kind === 'one-way'
      ? 'Tap Start when you leave with the car, Car dropped when you hand it over, and Home when you reach home.'
      : 'Tap Start when you leave with the car, and Back when the trip is over.';
  return `नमस्ते ${name} जी, DriveBuddy ट्रिप ${trip}\n${hi}\n\n${url}\n\nHi ${name}, ${en} The bill is made from these times, so please tap on time.`;
}

/** WhatsApp to the customer with the final bill. */
export function billMessage(
  b: Pick<Booking, 'name' | 'ref' | 'city'>,
  l: Pick<TripLink, 'to' | 'kind' | 'startAt' | 'dropAt' | 'homeAt'>,
  bill: Bill,
  rules: Pick<TripRules, 'returnHour' | 'returnMaxPerDay' | 'returnFullDayAfter'>,
): string {
  const rows = [
    `Hi ${firstName(b.name)}, thank you for travelling with DriveBuddy.`,
    `Your final bill${b.ref ? ` for ${b.ref}` : ''} (${b.city} → ${l.to}):`,
    '',
    `Driver left: ${whenText(l.startAt)}`,
  ];
  if (l.kind === 'one-way') {
    rows.push(`Car dropped: ${whenText(l.dropAt)} (${durationText(bill.driveMinutes)} on the road)`);
    rows.push(`Driver home: ${whenText(l.homeAt)} (${durationText(bill.returnMinutes)} after the drop)`);
  } else {
    rows.push(`Back: ${whenText(l.homeAt)} (${durationText(bill.driveMinutes)})`);
  }
  rows.push('');
  for (const line of billLines(bill, rules)) rows.push(`• ${line.label} = ${line.amount}`);
  rows.push(`Total: ${rupees(bill.amount)}`);
  return rows.join('\n');
}
