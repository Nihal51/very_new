/**
 * The booking and driver data model, as the browser sees it. One place for the
 * names, statuses and shapes that the account page, the admin panel and the
 * forms share.
 *
 * firestore.rules enforces these; apps-script/Code.js mirrors PACKAGE_NAMES
 * for alerts. scripts/packages.test.mjs fails `npm test` if the three disagree.
 */

/** Short names without prices — a booking from last month must not show this month's rate. */
export const PACKAGE_NAMES: Record<string, string> = {
  '1-hour-300': '1 hour',
  '3-hours-600': '3 hours',
  'local-full-day': 'Local full day (8 hrs)',
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

/** A booking document as stored. Fields after `source` are written by the server or an admin. */
export type Booking = {
  id: string;
  name: string;
  phone: string;
  city: string;
  package: string;
  pickup: string;
  preferredTime: string;
  notes: string;
  status: BookingStatus;
  source: string;
  createdAt?: Date;
  customerUid?: string;
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

/** The DB-number, or why there isn't one: the robot numbers new bookings within a minute; older ones never got one. */
export function refLabel(b: Pick<Booking, 'ref' | 'createdAt'>, now = Date.now()): string {
  if (b.ref) return b.ref;
  return b.createdAt && now - b.createdAt.getTime() < 15 * 60_000 ? 'Numbering…' : '—';
}
