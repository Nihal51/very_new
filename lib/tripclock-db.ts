/**
 * Firestore for the trip clock (lib/tripclock.ts): /admin makes the driver's
 * link and saves the final bill; the driver's page taps the steps.
 * firestore.rules (tripLinks, isBill, isClock) checks every write.
 */

import type { User } from 'firebase/auth';

import { toDate, type Booking, type BookingBill, type BookingClock } from './bookings';
import { getFirebaseApp, pingAlerts } from './firebase';
import type { Loc, TripLink, TripStep } from './tripclock';

async function fs() {
  const [app, mod] = await Promise.all([getFirebaseApp(), import('firebase/firestore')]);
  return { db: mod.getFirestore(app), ...mod };
}

const STEPS: TripStep[] = ['start', 'drop', 'home'];

function toLoc(v: unknown): Loc | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const { lat, lng, acc } = v as Record<string, unknown>;
  return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng, acc: typeof acc === 'number' ? acc : 0 } : undefined;
}

export function toTripLink(key: string, d: Record<string, unknown>): TripLink {
  const l: TripLink = {
    key,
    bookingId: String(d.bookingId ?? ''),
    ref: String(d.ref ?? ''),
    to: String(d.to ?? ''),
    kind: d.kind === 'round' ? 'round' : 'one-way',
    nonstop: d.nonstop === true,
    driverName: String(d.driverName ?? ''),
    closed: d.closed === true,
    createdAt: toDate(d.createdAt),
  };
  for (const s of STEPS) {
    const at = toDate(d[`${s}At`]);
    const phone = toDate(d[`${s}Phone`]);
    const loc = toLoc(d[`${s}Loc`]);
    if (at) l[`${s}At`] = at;
    if (phone) l[`${s}Phone`] = phone;
    if (loc) l[`${s}Loc`] = loc;
  }
  return l;
}

/** 28 random letters and digits: the link's key and the document id (about 166 bits). */
export function newTripKey(): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const out: string[] = [];
  while (out.length < 28) {
    const bytes = crypto.getRandomValues(new Uint8Array(40));
    for (const b of bytes) if (b < 248 && out.length < 28) out.push(abc[b % 62]!); // 248 = 4 × 62: no bias
  }
  return out.join('');
}

/* ------------------------------------------------------------------ admin */

/** Make the driver's link for this booking (closing an older one, e.g. for a driver who was changed). */
export async function createTripLink(user: User, b: Booking, nonstop: boolean, older: TripLink[]): Promise<string> {
  const { db, doc, writeBatch, serverTimestamp } = await fs();
  const key = newTripKey();
  const batch = writeBatch(db);
  batch.set(doc(db, 'tripLinks', key), {
    bookingId: b.id,
    ref: (b.ref ?? '').slice(0, 20),
    to: (b.trip?.to ?? '').slice(0, 60),
    kind: b.package === 'outstation' ? 'round' : 'one-way',
    nonstop,
    driverName: (b.assignedDriver?.name ?? '').slice(0, 60),
    closed: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    by: user.uid,
  });
  for (const l of older)
    if (!l.closed)
      batch.update(doc(db, 'tripLinks', l.key), {
        closed: true,
        updatedAt: serverTimestamp(),
        by: user.uid,
      });
  await batch.commit();
  return key;
}

/** Every link made for a booking, newest first (admins only can list them). */
export function watchTripLinks(bookingId: string, onLinks: (links: TripLink[]) => void, onError: () => void): () => void {
  let off: (() => void) | undefined;
  let alive = true;
  fs().then(({ db, collection, query, where, onSnapshot }) => {
    if (!alive) return;
    off = onSnapshot(
      query(collection(db, 'tripLinks'), where('bookingId', '==', bookingId)),
      (snap) =>
        onLinks(
          snap.docs
            .map((d) => toTripLink(d.id, d.data()))
            .sort((a, b) => (b.createdAt?.getTime() ?? Infinity) - (a.createdAt?.getTime() ?? Infinity)),
        ),
      onError,
    );
  }, onError);
  return () => {
    alive = false;
    off?.();
  };
}

/** Correct the times (null removes one) or the day-and-night switch. */
export async function fixTripLink(
  user: User,
  key: string,
  change: {
    times?: Partial<Record<TripStep, Date | null>>;
    nonstop?: boolean;
    closed?: boolean;
  },
) {
  const { db, doc, updateDoc, serverTimestamp, deleteField, Timestamp } = await fs();
  const data: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
    by: user.uid,
  };
  for (const [step, at] of Object.entries(change.times ?? {})) data[`${step}At`] = at ? Timestamp.fromDate(at) : deleteField();
  if (change.nonstop !== undefined) data.nonstop = change.nonstop;
  if (change.closed !== undefined) data.closed = change.closed;
  await updateDoc(doc(db, 'tripLinks', key), data);
}

/**
 * Save the final bill on the booking with the times it came from (the
 * customer sees both), close the link so no more taps change it, and put the
 * driver's pay and the profit (`privateNote`) in the admin-only timeline —
 * one batch.
 */
export async function saveFinalBill(
  user: User,
  bookingId: string,
  linkKey: string,
  bill: Omit<BookingBill, 'at'>,
  clock: Required<Pick<BookingClock, 'startAt' | 'homeAt'>> & Pick<BookingClock, 'dropAt'>,
  privateNote: string,
) {
  const { db, doc, collection, writeBatch, serverTimestamp, Timestamp } = await fs();
  const ref = doc(db, 'bookings', bookingId);
  const batch = writeBatch(db);
  batch.update(ref, {
    bill: { ...bill, at: serverTimestamp() },
    clock: {
      startAt: Timestamp.fromDate(clock.startAt),
      ...(clock.dropAt && { dropAt: Timestamp.fromDate(clock.dropAt) }),
      homeAt: Timestamp.fromDate(clock.homeAt),
    },
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
  batch.set(doc(collection(ref, 'events')), {
    type: 'bill',
    from: null,
    to: null,
    note: privateNote.slice(0, 500),
    by: user.email ?? '',
    at: serverTimestamp(),
  });
  batch.update(doc(db, 'tripLinks', linkKey), {
    closed: true,
    updatedAt: serverTimestamp(),
    by: user.uid,
  });
  await batch.commit();
}

/* ----------------------------------------------------------------- driver */

export type LinkState = { kind: 'ok'; link: TripLink } | { kind: 'missing' } | { kind: 'error' };

/** The driver's page: the link, live (its taps show at once, an admin's fix too). */
export function watchTripLink(key: string, onState: (s: LinkState) => void): () => void {
  let off: (() => void) | undefined;
  let alive = true;
  fs().then(
    ({ db, doc, onSnapshot }) => {
      if (!alive) return;
      off = onSnapshot(
        doc(db, 'tripLinks', key),
        (snap) => onState(snap.exists() ? { kind: 'ok', link: toTripLink(snap.id, snap.data()) } : { kind: 'missing' }),
        () => onState({ kind: 'error' }),
      );
    },
    () => onState({ kind: 'error' }),
  );
  return () => {
    alive = false;
    off?.();
  };
}

/**
 * One tap: the server's time (firestore.rules insists), the phone's own clock
 * in case it was offline, and where he is if he allowed it. Resolves once the
 * server has it — which waits for the network if there is none.
 */
export async function tapStep(key: string, step: TripStep, loc?: Loc | null) {
  const { db, doc, updateDoc, serverTimestamp } = await fs();
  await updateDoc(doc(db, 'tripLinks', key), {
    [`${step}At`]: serverTimestamp(),
    [`${step}Phone`]: new Date(),
    ...(loc && { [`${step}Loc`]: loc }),
    updatedAt: serverTimestamp(),
  });
  pingAlerts();
}

/** Where the phone is, if the driver allows it — never waits more than a few seconds, never fails. */
export function currentLoc(timeoutMs = 6000): Promise<Loc | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    const timer = setTimeout(() => resolve(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timer);
        resolve({
          lat: Math.round(p.coords.latitude * 1e5) / 1e5,
          lng: Math.round(p.coords.longitude * 1e5) / 1e5,
          acc: Math.min(100000, Math.round(p.coords.accuracy || 0)),
        });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 120000 },
    );
  });
}
