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
  returnCost,
  returnWords,
  shortDriveWords,
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
};

/** The rates for the bill: the agreed price's, or the lowest rates customers were shown for the distance (`km`, one way). */
export function billRates(quote: Booking['quote'], rules: TripRules, km?: number): BillRates {
  return {
    dayRate: quote?.dayRate ?? dayRateFor(rules, km).from,
    extraHourRate: quote?.extraHourRate ?? rules.extraHour,
    returnHourRate: quote?.returnHourRate ?? rules.returnHour,
    ticket: quote?.ticket ?? 0,
  };
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
  >,
  rules: Pick<TripRules, 'returnHour' | 'returnMaxPerDay' | 'returnFullDayAfter'> & Partial<Pick<TripRules, 'shortDrive'>>,
): { label: string; amount: string }[] {
  const lines: { label: string; amount: string }[] = [];
  if (b.days > 0)
    lines.push({
      label: `${plural(b.days, 'day')} × ${rupees(b.dayRate)}`,
      amount: rupees(b.days * b.dayRate),
    });
  if (b.extraHours > 0 && b.days === 0 && rules.shortDrive)
    // A one-way drive shorter than a day: ₹600 for 3 h, then by the hour, then a local day.
    lines.push({
      label: shortDriveWords({ extraHour: b.extraHourRate, shortDrive: rules.shortDrive }, b.extraHours, rupees),
      amount: rupees(b.extraCharge),
    });
  else if (b.extraHours > 0)
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

/** "₹1,600 × 2 days + ₹600 for 5 extra hours + ₹2,400 way home (38 h)" — for the customer's booking. */
export function billBreakdown(
  b: Pick<Bill, 'days' | 'dayRate' | 'extraHours' | 'extraCharge' | 'returnHours' | 'returnCharge' | 'ticket'>,
): string {
  return [
    b.days > 0 ? `${rupees(b.dayRate)} × ${plural(b.days, 'day')}` : null,
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

/** "2 days + 5 h" — the driving as charged. */
export const daysText = (b: Pick<Bill, 'days' | 'extraHours'>) =>
  [b.days > 0 ? plural(b.days, 'day') : null, b.extraHours > 0 || b.days === 0 ? `${b.extraHours} h` : null]
    .filter(Boolean)
    .join(' + ');

/**
 * What the driver is paid for the trip, from his day cost and his hourly pay
 * home — the same way as the quote (lib/outstation.ts quote): his extra hours
 * at a twelfth of his day, at most one more day; his way home with the same
 * daily maximum in hours as the customer's. Admin-only: never saved on the booking.
 */
export function driverPay(
  b: Pick<Bill, 'days' | 'extraHours' | 'returnHours'>,
  dayCost: number,
  returnHourPay: number,
  rules: Pick<TripRules, 'hoursPerDay' | 'returnHour' | 'returnMaxPerDay' | 'returnFullDayAfter'>,
): number {
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
