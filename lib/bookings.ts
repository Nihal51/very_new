/**
 * The booking and driver data model, as the browser sees it. One place for the
 * names, statuses and shapes that the account page, the admin panel and the
 * forms share.
 *
 * firestore.rules enforces these; apps-script/Code.js mirrors PACKAGE_NAMES
 * for alerts. scripts/packages.test.mjs fails `npm test` if the three disagree.
 */

import type { PickupGeo } from './geo.ts';

/** Short names without prices — a booking from last month must not show this month's rate. */
export const PACKAGE_NAMES: Record<string, string> = {
  '1-hour-300': '1 hour',
  '3-hours-600': '3 hours',
  'local-full-day': 'Local full day (8 hrs)',
  'local-12-hours': '12 hours in the city',
  outstation: 'Outstation trip',
  'night-driver': 'Night driver (8 PM – 6 AM)',
  'medical-emergency': 'Hospital / emergency',
  'monthly-basic': 'Monthly driver – Basic',
  'monthly-premium': 'Monthly driver – Premium',
  'wedding-event': 'Wedding / event',
  'one-way-drop': 'One-way car drop',
};

export const packageName = (id: string) => PACKAGE_NAMES[id] ?? id;

/* ----------------------------------------------------------------- bookings */

export const BOOKING_STATUSES = ['new', 'confirmed', 'assigned', 'completed', 'cancelled'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_STATUS: Record<
  BookingStatus,
  { label: string; customerLabel: string; tone: 'accent' | 'neutral' | 'success' | 'outline' }
> = {
  new: { label: 'New', customerLabel: 'Received – we will call you', tone: 'accent' },
  confirmed: { label: 'Confirmed', customerLabel: 'Confirmed', tone: 'neutral' },
  assigned: { label: 'Driver assigned', customerLabel: 'Driver assigned', tone: 'neutral' },
  completed: { label: 'Completed', customerLabel: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', customerLabel: 'Cancelled', tone: 'outline' },
};

/**
 * A driver on a booking or an offer. Bookings name him by id and name; his
 * number is on older bookings only, until HIDE_DRIVER_PHONE (25 Nov 2026:
 * customers never get it — the office looks it up in drivers/{id}).
 */
export type DriverRef = { id: string; name: string; phone?: string };

/**
 * What the customer sees of the driver once DriveBuddy has confirmed him
 * (bookings/{id}.driverCard, the alerts robot's): no number, no address.
 */
export type DriverCard = {
  name: string;
  photoUrl: string | null;
  /** Average of his ratings, one decimal; null before the first. */
  rating: number | null;
  ratingCount: number;
  /** His completed bookings. */
  trips: number;
  experienceYears: number | null;
  /** An approved, checked driver. */
  verified: boolean;
  /** When DriveBuddy approved him. */
  since?: Date;
};

/** "Change driver": when the customer asked and why (bookings/{id}.driverChangeRequest; the robot clears it). */
export type DriverChangeRequest = { at?: Date; reason: string };

/** How many times a customer may change the driver of one booking (firestore.rules, the robot). */
export const DRIVER_CHANGES_MAX = 2;

/** Put first in the notes by the booking form and the app when the customer wants a drop driven day and night. */
export const NONSTOP_NOTE = 'Day and night driving (non-stop).';
export const wantsNonstop = (notes: string) => (notes ?? '').trim().startsWith(NONSTOP_NOTE);

/** Packages that carry a trip (lib/outstation.ts), and which kind each is. */
export const TRIP_PACKAGES = { outstation: 'round', 'one-way-drop': 'one-way' } as const;
export type TripPackage = keyof typeof TRIP_PACKAGES;
export const isTripPackage = (id: string): id is TripPackage => id in TRIP_PACKAGES;

/** The trip and the estimate the customer was shown (firestore.rules: isTrip). */
export type BookingTrip = {
  /** The destination's name, or what the customer typed. */
  to: string;
  /** lib/outstation.ts destination id; '' for a place not in the list. */
  destId: string;
  kind: 'one-way' | 'round';
  km: number;
  days: number;
  /** One-way: hours the driver is still travelling home after the paid days. */
  returnHours: number;
  estFrom: number;
  estTo: number;
};

/** The price agreed on the call (firestore.rules: isQuote). Customer-visible: no costs here. */
export type BookingQuote = {
  amount: number;
  dayRate: number;
  days: number;
  /** Return hours charged (after the paid days) and the rate; returnCharge has the daily maximum applied. */
  returnHours: number;
  returnHourRate: number;
  returnCharge: number;
  extraHours: number;
  extraHourRate: number;
  /** The extra hours' charge (quotes from 29 Oct 2026): a drive shorter than a day at the short-drive price. Missing: extraHours × extraHourRate. */
  extraCharge?: number;
  /**
   * A route price (quotes from 1 Nov to 7 Nov 2026): the hours away it was
   * planned for and the km. Then days = 1 at dayRate = the route price, and
   * nothing else is charged but the ticket.
   */
  awayHours?: number;
  /**
   * The one-way km. Without awayHours (quotes from 8 Nov 2026,
   * lib/outstation.ts pricedByTime): priced by the driver's time — days =
   * the 24-hour blocks at dayRate, extraHours past them at extraHourRate, no
   * way-home charge.
   */
  km?: number;
  /**
   * A long one-way drop priced by the km (quotes from 24 Nov 2026, v3,
   * lib/outstation.ts pricedByKm): the price a km — then days = 1 at dayRate
   * = km × kmRate, his way home in returnHours / returnCharge, `minimum` the
   * least the drop costs and `adjust` the round-off or the top-up to it.
   */
  kmRate?: number;
  minimum?: number;
  adjust?: number;
  /**
   * A long one-way drop, v4 (quotes from 24 Nov 2026, lib/outstation.ts
   * pricedV4 — nightRate says so): days = 1 at dayRate = the drive, nights ×
   * nightRate, his wait for the train (waitHours charged × waitHourRate =
   * waitCharge), `minimum` and `adjust` as above; no way-home charge.
   */
  nights?: number;
  nightRate?: number;
  waitHours?: number;
  waitHourRate?: number;
  waitCharge?: number;
  ticket: number;
  at?: Date;
};

/** The real times of the trip, from the driver's trip link (firestore.rules: isClock; lib/tripclock.ts). */
export type BookingClock = { startAt?: Date; dropAt?: Date; boardAt?: Date; homeAt?: Date };

/** One train home the robot found at the drop (bookings/{id}.returnCheck, robot-only; apps-script/Code.js returnCheckFor_). */
export type ReturnCheckOption = {
  train: string;
  name: string;
  /** The station he boards at (code). */
  from: string;
  dep?: Date;
  arr?: Date;
  /** One change of train, if the route has one. */
  change: { station: string; train: string; dep?: Date } | null;
  /** Minutes from the drop to the departure; the wait charge and the whole price (before his ticket) with this train. */
  waitMin: number;
  waitCharge: number;
  price: number;
};

/**
 * The robot's train check at the drop (24 Nov 2026): when it looked, the drop
 * time, up to 3 trains home; `bus`: none leaves within 12 hours (take a bus);
 * `failed`: the lookup could not run (the team calls).
 */
export type BookingReturnCheck = { at?: Date; dropAt?: Date; options: ReturnCheckOption[]; bus: boolean; failed: boolean };

/** The train the customer booked for him ("I booked this train"), or the office set (bookings/{id}.returnChoice). */
export type BookingReturnChoice = { train: string; dep?: Date; at?: Date };

/** The final price with the chosen train (bookings/{id}.returnPrice, robot-only). */
export type BookingReturnPrice = { price: number; waitCharge: number; train: string; at?: Date };

/** The final bill from the real times (firestore.rules: isBill). Customer-visible: no costs here. */
export type BookingBill = {
  amount: number;
  dayRate: number;
  days: number;
  extraHours: number;
  extraHourRate: number;
  /** extraHours × extraHourRate, at most one day. */
  extraCharge: number;
  returnHours: number;
  returnHourRate: number;
  /** The way home with the daily maximum applied. */
  returnCharge: number;
  /** A route price (bills from 1 Nov to 7 Nov 2026): the planned hours away and the km; days = 1 at the price, extraHours = hours late. */
  awayHours?: number;
  /** The one-way km; without awayHours (from 8 Nov 2026): priced by the driver's time (24-hour blocks, the hours past them). */
  km?: number;
  /** A long one-way drop by the km (from 24 Nov 2026, v3): the price a km, the minimum and the round-off / top-up (as on the quote). */
  kmRate?: number;
  minimum?: number;
  adjust?: number;
  /** v4 (from 24 Nov 2026): the nights, his wait for the train, the stops the customer asked for (as on the quote, plus stops). */
  nights?: number;
  nightRate?: number;
  waitHours?: number;
  waitHourRate?: number;
  waitCharge?: number;
  stopsHours?: number;
  stopsHourRate?: number;
  stopsCharge?: number;
  ticket: number;
  /** Driven day and night (every 12 h a day). */
  nonstop: boolean;
  at?: Date;
};

/** The trip estimate the customer accepted in the app (firestore.rules: isAcceptedPrice); the robot then confirms it. */
export type BookingAcceptedPrice = { amount: number; at?: Date };

/**
 * A local job's bill, worked out by the alerts robot from the Driver app's
 * taps (Arrived → Job done): the price the job was offered to the driver
 * at, plus each hour over the package.
 * Customer-visible: no costs here.
 */
export type BookingLocalBill = {
  amount: number;
  baseHours: number;
  usedHours: number;
  extraHours: number;
  extraHourRate: number;
  at?: Date;
};

/** How a job was paid: a UPI link to DriveBuddy's UPI ID, cash to the driver, or a Razorpay link. */
export type PaymentMethod = 'upi' | 'cash' | 'razorpay';

/**
 * A completed job's payment, written by the alerts robot: pending with a link
 * (a UPI link to DriveBuddy's own UPI ID, or Razorpay's once its keys are
 * set), then paid — online, or confirmed by the driver ("Paid by UPI" /
 * "Paid in cash", by: 'driver').
 */
export type BookingPayment = {
  status: 'pending' | 'paid';
  amount: number;
  /** '' when there is none, or it is not a link we trust. */
  url: string;
  linkId: string;
  method?: PaymentMethod;
  /** 'driver': the driver confirmed it in the Driver app. */
  by?: 'driver';
  at?: Date;
  paidAt?: Date;
};

/**
 * The Driver app's taps on a job (tripTaps/{bookingId}, firestore.rules):
 * his times, then paidBy / paidAt — "Paid by UPI" / "Paid in cash". No
 * amount: the driver is never shown the customer's price.
 */
export type TripTaps = {
  driverPhone: string;
  leftAt?: Date;
  arrivedAt?: Date;
  doneAt?: Date;
  homeAt?: Date;
  paidBy?: 'upi' | 'cash';
  paidAt?: Date;
};

/**
 * The office has confirmed the booking's driver — only then does he see the
 * customer's name, number and address (firestore.rules). by: 'telegram'
 * (Confirmed ✓ after the call), 'admin' (Confirm driver ✓ in /admin),
 * 'office' (the office assigned him itself), 'auto' (the robot, with
 * CONFIRM_BY_CALL off). It is about driverId only: once the job has another
 * driver it no longer counts.
 */
export type DriverConfirmedBy = 'telegram' | 'admin' | 'office' | 'auto';
export type DriverConfirmed = { at?: Date; by: DriverConfirmedBy | string; driverId: string };

/** The customer's rating of the driver (ratings/{bookingId}). */
export type Rating = { stars: number; comment: string; driverId: string; customerUid: string; at?: Date };

/** A booking document as stored. Fields after `source` are written by the server or an admin. */
export type Booking = {
  id: string;
  name: string;
  phone: string;
  city: string;
  package: string;
  pickup: string;
  /** The exact pickup spot, if the customer pinned it (lib/geo.ts). */
  pickupGeo?: PickupGeo | null;
  preferredTime: string;
  notes: string;
  status: BookingStatus;
  source: string;
  createdAt?: Date;
  customerUid?: string;
  trip?: BookingTrip;
  quote?: BookingQuote | null;
  clock?: BookingClock | null;
  bill?: BookingBill | null;
  returnCheck?: BookingReturnCheck | null;
  returnChoice?: BookingReturnChoice | null;
  returnPrice?: BookingReturnPrice | null;
  acceptedPrice?: BookingAcceptedPrice | null;
  localBill?: BookingLocalBill | null;
  payment?: BookingPayment | null;
  driverConfirmed?: DriverConfirmed | null;
  /** The confirmed driver as the customer sees him (robot-only). */
  driverCard?: DriverCard | null;
  driverChangeRequest?: DriverChangeRequest | null;
  /** Drivers the customer changed so far, and who they were (robot-only). */
  driverChanges?: number;
  changedDrivers?: string[];
  ref?: string;
  number?: number;
  isReturning?: boolean;
  assignedDriver?: DriverRef | null;
  cancelReason?: string;
  updatedAt?: Date;
  updatedBy?: string;
  alerts?: { telegram?: string; email?: string };
};

/* ------------------------------------------------------------------ drivers */

export const DRIVER_STATUSES = ['new', 'verified', 'active', 'inactive', 'rejected'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const DRIVER_STATUS: Record<DriverStatus, { label: string; tone: 'accent' | 'neutral' | 'success' | 'outline' }> = {
  new: { label: 'Applied', tone: 'accent' },
  verified: { label: 'Verified', tone: 'neutral' },
  active: { label: 'Active', tone: 'success' },
  inactive: { label: 'Inactive', tone: 'outline' },
  rejected: { label: 'Rejected', tone: 'outline' },
};

export type Driver = {
  id: string;
  name: string;
  phone: string;
  city: string;
  experienceYears: number;
  licence: string;
  about: string;
  status: DriverStatus;
  createdAt?: Date;
  adminNote?: string;
  /** His UPI ID, set by himself in the Driver app (Earnings). */
  upi?: string;
  /** Kept by the alerts robot: the customers' average stars (1 decimal) and how many rated him. */
  ratingAvg?: number;
  ratingCount?: number;
  /** Kept by the alerts robot: jobs he took and gave back ("Can't make it"). */
  strikes?: number;
  /** Kept by the alerts robot: whether his phone took the last job alert (25 Nov 2026). */
  lastAlert?: AlertResult | null;
};

export type Customer = {
  id: string;
  phone: string;
  name: string;
  city: string;
  bookingsCount: number;
  firstBookingAt?: Date;
  lastBookingAt?: Date;
  lastBookingRef?: string;
  lastPackage?: string;
};

/**
 * Bookings the alerts robot confirms by itself (apps-script/Code.js
 * instantConfirmable — the same rule, without its INSTANT_BOOKINGS switch):
 * a logged-in customer's 1 hour / 3 hours, or a trip price the customer
 * accepted. Never a hospital / emergency booking.
 */
export function isInstantBooking(b: Pick<Booking, 'package' | 'customerUid' | 'acceptedPrice'>): boolean {
  if (b.package === 'medical-emergency') return false;
  if (b.acceptedPrice && b.acceptedPrice.amount > 0) return true;
  return Boolean(b.customerUid) && (b.package === '1-hour-300' || b.package === '3-hours-600' || b.package === 'local-12-hours');
}

/* --------------------------------------------------------------- formatting */

/** "9111473929" → "+91 91114 73929" */
export function prettyPhone(p: string): string {
  const d = String(p ?? '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : p;
}

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
});

export const formatDateTime = (d?: Date) => (d ? dateFmt.format(d) : '');

/** The form's "2026-10-08T15:30" (customer's own clock, India) → "Thu, 8 Oct, 3:30 pm". */
export function formatPreferred(raw: string): string {
  const s = (raw ?? '').trim();
  if (!s) return 'As soon as possible';
  const t = tripInstant(s);
  return t ? dateFmt.format(t) : s;
}

/** The customer's preferred time as a real instant (digits are India time), or undefined for "as soon as possible". */
export function tripInstant(raw: string): Date | undefined {
  const m = (raw ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - 330 * 60 * 1000);
}

/* ------------------------------------------------------------- date filters */

export const DATE_RANGES = [
  { id: 'any', label: 'Any date' },
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'month', label: 'This month' },
] as const;
export type DateRange = (typeof DATE_RANGES)[number]['id'];

/** Midnight in India, `daysAgo` days back. */
export function istMidnight(now: number, daysAgo = 0): number {
  const day = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  return Date.parse(`${day}T00:00:00+05:30`) - daysAgo * 86_400_000;
}

export function inDateRange(d: Date | undefined, range: DateRange, now: number): boolean {
  if (range === 'any') return true;
  if (!d) return false;
  const t = d.getTime();
  const today = istMidnight(now);
  switch (range) {
    case 'today':
      return t >= today;
    case 'yesterday':
      return t >= today - 86_400_000 && t < today;
    case '7d':
      return t >= istMidnight(now, 6);
    case '30d':
      return t >= istMidnight(now, 29);
    case 'month': {
      const ym = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
      return t >= Date.parse(`${ym}-01T00:00:00+05:30`);
    }
  }
}

export function timeAgo(d?: Date, now = Date.now()): string {
  if (!d) return '';
  const s = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const days = Math.round(h / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Firestore Timestamp | Date | undefined → Date | undefined, without importing the SDK here. */
export function toDate(v: unknown): Date | undefined {
  if (!v) return undefined;
  if (v instanceof Date) return v;
  if (typeof v === 'object' && v && 'toDate' in v && typeof (v as { toDate: unknown }).toDate === 'function')
    return (v as { toDate: () => Date }).toDate();
  return undefined;
}

/** A stored clock (Timestamps) → Dates; null when there is none. */
export function toClock(v: unknown): BookingClock | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  const out: BookingClock = {};
  for (const k of ['startAt', 'dropAt', 'boardAt', 'homeAt'] as const) {
    const d = toDate(c[k]);
    if (d) out[k] = d;
  }
  return out.startAt ? out : null;
}

/** A stored final bill → typed, with its date; null when there is none or it is not whole. */
export function toBill(v: unknown): BookingBill | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as Record<string, unknown>;
  const n = (k: string) => (typeof b[k] === 'number' && Number.isFinite(b[k]) ? (b[k] as number) : NaN);
  const keys = ['amount', 'dayRate', 'days', 'extraHours', 'extraHourRate', 'extraCharge', 'returnHours', 'returnHourRate', 'returnCharge', 'ticket'] as const;
  if (keys.some((k) => Number.isNaN(n(k)))) return null;
  return {
    ...(Object.fromEntries(keys.map((k) => [k, n(k)])) as Record<(typeof keys)[number], number>),
    // A route price (bills from 1 Nov 2026): the planned hours away and the km; the km alone: the driver's time.
    ...(n('awayHours') > 0 && { awayHours: n('awayHours') }),
    ...(n('km') > 0 && { km: n('km') }),
    // By the km (from 24 Nov 2026, v3): its price a km, the minimum and the round-off or top-up.
    ...(n('kmRate') > 0 && { kmRate: n('kmRate'), minimum: Number.isNaN(n('minimum')) ? 0 : n('minimum'), adjust: Number.isNaN(n('adjust')) ? 0 : n('adjust') }),
    // v4 (from 24 Nov 2026): the nights, his wait, the stops, the minimum and the round-off.
    ...(!Number.isNaN(n('nightRate')) &&
      Object.fromEntries(
        (['nights', 'nightRate', 'waitHours', 'waitHourRate', 'waitCharge', 'stopsHours', 'stopsHourRate', 'stopsCharge', 'minimum', 'adjust'] as const).map((k) => [
          k,
          Number.isNaN(n(k)) ? 0 : n(k),
        ]),
      )),
    nonstop: b.nonstop === true,
    at: toDate(b.at),
  };
}

/** A stored train check (returnCheck) → typed; null when there is none or it is not whole. */
export function toReturnCheck(v: unknown): BookingReturnCheck | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  const options = (Array.isArray(c.options) ? c.options : []).flatMap((o): ReturnCheckOption[] => {
    if (!o || typeof o !== 'object') return [];
    const r = o as Record<string, unknown>;
    if (!str(r.train)) return [];
    const ch = r.change && typeof r.change === 'object' ? (r.change as Record<string, unknown>) : null;
    return [
      {
        train: str(r.train),
        name: str(r.name),
        from: str(r.from),
        dep: toDate(r.dep),
        arr: toDate(r.arr),
        change: ch ? { station: str(ch.station), train: str(ch.train), dep: toDate(ch.dep) } : null,
        waitMin: num(r.waitMin),
        waitCharge: num(r.waitCharge),
        price: num(r.price),
      },
    ];
  });
  return { at: toDate(c.at), dropAt: toDate(c.dropAt), options, bus: c.bus === true, failed: c.failed === true };
}

/** A stored choice of train (returnChoice) → typed; null when there is none. */
export function toReturnChoice(v: unknown): BookingReturnChoice | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  return typeof c.train === 'string' && c.train ? { train: c.train, dep: toDate(c.dep), at: toDate(c.at) } : null;
}

/** The stored final price with the chosen train (returnPrice) → typed; null when there is none. */
export function toReturnPrice(v: unknown): BookingReturnPrice | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  return typeof c.price === 'number' && typeof c.train === 'string'
    ? { price: c.price, waitCharge: typeof c.waitCharge === 'number' ? c.waitCharge : 0, train: c.train, at: toDate(c.at) }
    : null;
}

/** The DB-number, or why there isn't one: the robot numbers new bookings within a minute; older ones never got one. */
export function refLabel(b: Pick<Booking, 'ref' | 'createdAt'>, now = Date.now()): string {
  if (b.ref) return b.ref;
  return b.createdAt && now - b.createdAt.getTime() < 15 * 60_000 ? 'Numbering…' : '—';
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

/** A stored accepted price → typed; null when there is none. */
export function toAcceptedPrice(v: unknown): BookingAcceptedPrice | null {
  if (!v || typeof v !== 'object') return null;
  const a = v as Record<string, unknown>;
  return num(a.amount) > 0 ? { amount: num(a.amount), at: toDate(a.at) } : null;
}

/** A stored local bill → typed; null when there is none or it is not whole. */
export function toLocalBill(v: unknown): BookingLocalBill | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as Record<string, unknown>;
  const keys = ['amount', 'baseHours', 'usedHours', 'extraHours', 'extraHourRate'] as const;
  if (keys.some((k) => Number.isNaN(num(b[k])))) return null;
  return { ...(Object.fromEntries(keys.map((k) => [k, num(b[k])])) as Record<(typeof keys)[number], number>), at: toDate(b.at) };
}

/** A UPI ID: the same shape as firestore.rules (drivers' upi) and the robot (UPI_ID). */
export const UPI_ID = /^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z]{2,32}$/;

/**
 * A UPI pay link the robot makes ("upi://pay?pa=…&pn=…&am=…"): its pa= is a
 * UPI ID (encoded, so "%40" for "@"), at most 500 characters, no spaces.
 */
export function isUpiPayUrl(url: string): boolean {
  if (!url.startsWith('upi://pay?') || url.length > 500 || /\s/.test(url)) return false;
  const pa = /[?&]pa=([^&]*)/.exec(url)?.[1] ?? '';
  try {
    return UPI_ID.test(decodeURIComponent(pa));
  } catch {
    return false;
  }
}

const PAYMENT_METHODS: readonly PaymentMethod[] = ['upi', 'cash', 'razorpay'];

/** A stored payment → typed; null when there is none or it is odd. */
export function toPayment(v: unknown): BookingPayment | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  if ((p.status !== 'pending' && p.status !== 'paid') || !(num(p.amount) > 0)) return null;
  // A payment the driver confirmed has no link at all.
  const raw = typeof p.url === 'string' ? p.url : '';
  // Only Razorpay's own links and UPI pay links are shown as links.
  const url = /^https:\/\/(rzp\.io|[a-z0-9-]+\.razorpay\.com)\//.test(raw) || isUpiPayUrl(raw) ? raw : '';
  const method = PAYMENT_METHODS.find((m) => m === p.method);
  return {
    status: p.status,
    amount: num(p.amount),
    url,
    linkId: String(p.linkId ?? ''),
    ...(method ? { method } : {}),
    ...(p.by === 'driver' ? { by: 'driver' as const } : {}),
    at: toDate(p.at),
    paidAt: toDate(p.paidAt),
  };
}

/** A stored driver confirmation → typed; null when there is none. */
export function toDriverConfirmed(v: unknown): DriverConfirmed | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  if (typeof c.driverId !== 'string' || !c.driverId) return null;
  return { at: toDate(c.at), by: String(c.by ?? ''), driverId: c.driverId };
}

/** Is the booking's current driver the one the office confirmed by call? */
export const isDriverConfirmed = (b: Pick<Booking, 'assignedDriver' | 'driverConfirmed'>) =>
  Boolean(b.assignedDriver && b.driverConfirmed && b.driverConfirmed.driverId === b.assignedDriver.id);

/** A stored driver card → typed; null when there is none. */
export function toDriverCard(v: unknown): DriverCard | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  if (typeof c.name !== 'string' || !c.name) return null;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const photo = typeof c.photoUrl === 'string' && /^https:\/\/\S+$/.test(c.photoUrl) ? c.photoUrl : null;
  return {
    name: c.name,
    photoUrl: photo,
    rating: n(c.rating),
    ratingCount: n(c.ratingCount) ?? 0,
    trips: n(c.trips) ?? 0,
    experienceYears: n(c.experienceYears),
    verified: c.verified === true,
    since: toDate(c.since),
  };
}

/** A stored change-driver request → typed; null when there is none. */
export function toDriverChangeRequest(v: unknown): DriverChangeRequest | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  return { at: toDate(r.at), reason: typeof r.reason === 'string' ? r.reason : '' };
}

/** The customer sees the driver only once DriveBuddy has confirmed him and the robot has made his card. */
export const showsDriver = (b: Pick<Booking, 'assignedDriver' | 'driverConfirmed' | 'driverCard'>) => isDriverConfirmed(b) && Boolean(b.driverCard);

/** Changes of driver the customer has left on this booking (0–2). */
export const driverChangesLeft = (b: Pick<Booking, 'driverChanges'>) =>
  Math.max(0, DRIVER_CHANGES_MAX - Math.max(0, Math.round(Number(b.driverChanges) || 0)));

/**
 * May the customer ask for another driver now? A driver is on it and shown,
 * none asked for yet, changes left, and he has not started (the clock; the
 * rules also check his Start tap, which the customer cannot see).
 */
export const canChangeDriver = (b: Pick<Booking, 'status' | 'assignedDriver' | 'driverConfirmed' | 'driverCard' | 'driverChanges' | 'driverChangeRequest' | 'clock'>) =>
  b.status === 'assigned' && showsDriver(b) && !b.driverChangeRequest && driverChangesLeft(b) > 0 && !b.clock?.startAt;

/** "Rating 4.7 (12)", "New driver"; "12 trips"; "7 years' experience"; "With DriveBuddy since Mar 2026". */
export function driverCardLines(c: DriverCard): string[] {
  const month = c.since ? new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(c.since) : '';
  return [
    c.rating !== null && c.ratingCount > 0 ? `★ ${c.rating.toFixed(1)} (${c.ratingCount} rating${c.ratingCount === 1 ? '' : 's'})` : 'New on DriveBuddy — no ratings yet',
    `${c.trips} trip${c.trips === 1 ? '' : 's'} with DriveBuddy`,
    c.experienceYears !== null ? `${c.experienceYears} years' driving experience` : '',
    month ? `With DriveBuddy since ${month}` : '',
  ].filter(Boolean);
}

/** Whether a driver's phone took an alert: drivers/{id}.lastAlert, alertTests/{id}.result (the robot's). */
export type AlertResult = { at?: Date; ok: boolean; error: string | null };
export type AlertTest = { at?: Date; result: AlertResult | null };

export function toAlertResult(v: unknown): AlertResult | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  return typeof r.ok === 'boolean' ? { at: toDate(r.at), ok: r.ok, error: typeof r.error === 'string' ? r.error : null } : null;
}

export function toAlertTest(v: unknown): AlertTest | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as Record<string, unknown>;
  return { at: toDate(t.at), result: toAlertResult(t.result) };
}

/** An alert's result in words for the office (the same words as the robot's ALERT_RESULT_TEXT and Telegram). */
export function alertResultText(r: AlertResult): string {
  if (r.ok) return 'Reached his phone ✓';
  switch (r.error) {
    case 'NoToken':
      return 'He has not signed up for alerts on his phone: he must open the Driver app and allow notifications.';
    case 'DeviceNotRegistered':
      return 'His phone no longer takes alerts (the app was removed or logged out): he must open the Driver app.';
    case 'InvalidCredentials':
      return "Not delivered: the Android notification key is missing in Expo (expo.dev → drivebuddy-driver → Credentials → Android → FCM V1 service account key).";
    case 'MismatchSenderId':
      return 'Not delivered: the notification key in Expo belongs to another Firebase project.';
    case 'MessageRateExceeded':
      return 'Not delivered: too many alerts to his phone at once.';
    case 'NoReceipt':
      return 'Expo did not say whether it arrived — try again.';
    default:
      return `Not delivered (${r.error ?? 'unknown error'}).`;
  }
}

/** "RS" for Raju Sahu: the card without a photo. */
export const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';

/** A stored taps document → typed; null when there is none. */
export function toTripTaps(v: unknown): TripTaps | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as Record<string, unknown>;
  return {
    driverPhone: String(t.driverPhone ?? ''),
    leftAt: toDate(t.leftAt),
    arrivedAt: toDate(t.arrivedAt),
    doneAt: toDate(t.doneAt),
    homeAt: toDate(t.homeAt),
    ...(t.paidBy === 'upi' || t.paidBy === 'cash' ? { paidBy: t.paidBy } : {}),
    paidAt: toDate(t.paidAt),
  };
}
