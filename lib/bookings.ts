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

export type DriverRef = { id: string; name: string; phone: string };

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
  ticket: number;
  at?: Date;
};

/** The real times of the trip, from the driver's trip link (firestore.rules: isClock; lib/tripclock.ts). */
export type BookingClock = { startAt?: Date; dropAt?: Date; homeAt?: Date };

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
  acceptedPrice?: BookingAcceptedPrice | null;
  localBill?: BookingLocalBill | null;
  payment?: BookingPayment | null;
  driverConfirmed?: DriverConfirmed | null;
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
  for (const k of ['startAt', 'dropAt', 'homeAt'] as const) {
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
    nonstop: b.nonstop === true,
    at: toDate(b.at),
  };
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
