/**
 * Admin-panel writes. Every change to a booking is one atomic batch: the update
 * itself plus its timeline entry, so the history can never disagree with the
 * booking. firestore.rules checks the same shapes on the server.
 */

import type { User } from 'firebase/auth';

import type { BookingQuote, BookingStatus, DriverRef, DriverStatus } from './bookings';
import { getFirebaseApp } from './firebase';
import { type Offer, clampCut, driverPayFor } from './offers';

async function fs() {
  const [app, mod] = await Promise.all([getFirebaseApp(), import('firebase/firestore')]);
  return { db: mod.getFirestore(app), ...mod };
}

/**
 * Is this Google account an admin? Firestore answers: the account can read
 * admins/{its email} only if that entry exists (firestore.rules). The entry is
 * created by the alerts robot from its ADMIN_EMAILS property.
 */
export async function ensureAdmin(user: User): Promise<boolean> {
  if (!user.email || !user.emailVerified) return false;
  const { db, doc, getDoc } = await fs();
  try {
    return (await getDoc(doc(db, 'admins', user.email.toLowerCase()))).exists();
  } catch (err) {
    const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
    if (code.includes('permission-denied')) return false;
    throw err;
  }
}

export async function changeBookingStatus(
  user: User,
  bookingId: string,
  from: BookingStatus,
  to: BookingStatus,
  { driver, cancelReason, note = '' }: { driver?: DriverRef | null; cancelReason?: string; note?: string } = {},
) {
  const { db, doc, collection, writeBatch, serverTimestamp } = await fs();
  const ref = doc(db, 'bookings', bookingId);
  const batch = writeBatch(db);
  batch.update(ref, {
    status: to,
    ...(driver !== undefined && { assignedDriver: driver }),
    ...(cancelReason !== undefined && { cancelReason }),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
  batch.set(doc(collection(ref, 'events')), {
    type: driver ? 'driver' : 'status',
    from,
    to,
    note: (driver ? `Driver: ${driver.name}${note ? ` – ${note}` : ''}` : cancelReason || note).slice(0, 500),
    by: user.email ?? '',
    at: serverTimestamp(),
  });
  await batch.commit();
}

export async function addBookingNote(user: User, bookingId: string, note: string) {
  const { db, doc, collection, addDoc, serverTimestamp } = await fs();
  await addDoc(collection(doc(db, 'bookings', bookingId), 'events'), {
    type: 'note',
    from: null,
    to: null,
    note: note.trim().slice(0, 500),
    by: user.email ?? '',
    at: serverTimestamp(),
  });
}

/**
 * Save the price agreed on the call. The booking gets only what the customer
 * pays (they can read it — My account, the app); `privateNote` — the driver's
 * cost and the profit — goes in the admin-only timeline in the same batch.
 */
export async function saveQuote(user: User, bookingId: string, quote: Omit<BookingQuote, 'at'>, privateNote: string) {
  const { db, doc, collection, writeBatch, serverTimestamp } = await fs();
  const ref = doc(db, 'bookings', bookingId);
  const batch = writeBatch(db);
  batch.update(ref, {
    quote: { ...quote, at: serverTimestamp() },
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
  batch.set(doc(collection(ref, 'events')), {
    type: 'quote',
    from: null,
    to: null,
    note: privateNote.slice(0, 500),
    by: user.email ?? '',
    at: serverTimestamp(),
  });
  await batch.commit();
}

export async function changeDriverStatus(user: User, driverId: string, status: DriverStatus, adminNote?: string) {
  const { db, doc, updateDoc, serverTimestamp } = await fs();
  await updateDoc(doc(db, 'drivers', driverId), {
    status,
    ...(adminNote !== undefined && { adminNote: adminNote.slice(0, 1000) }),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
}

export type NewDriver = {
  name: string;
  phone: string;
  city: string;
  experienceYears: number;
  licence: 'commercial' | 'lmv' | 'both';
  about: string;
  adminNote: string;
  status: 'active' | 'verified';
};

/**
 * A driver the office adds itself (one already met and checked), straight in as
 * Active or Verified — no application form. He can log in to the Driver app with
 * this number at once. firestore.rules: drivers, "an admin adding a driver".
 */
export async function addDriver(user: User, d: NewDriver): Promise<string> {
  const { db, collection, addDoc, serverTimestamp } = await fs();
  const ref = await addDoc(collection(db, 'drivers'), {
    name: d.name.trim().replace(/\s+/g, ' ').slice(0, 60),
    phone: d.phone,
    city: d.city,
    experienceYears: d.experienceYears,
    licence: d.licence,
    about: d.about.trim().slice(0, 500),
    adminNote: d.adminNote.trim().slice(0, 1000),
    status: d.status,
    source: 'admin',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
  return ref.id;
}

/* ------------------------------------------------------------- job offers */

/** Live offer for one booking (null = none yet). */
export async function watchOffer(bookingId: string, onChange: (o: Offer | null) => void): Promise<() => void> {
  const { db, doc, onSnapshot } = await fs();
  return onSnapshot(
    doc(db, 'offers', bookingId),
    (snap) => {
      if (!snap.exists()) return onChange(null);
      const d = snap.data();
      onChange({
        ...(d as Offer),
        takenAt: d.takenAt?.toDate?.(),
        paidAt: d.paidAt?.toDate?.(),
        createdAt: d.createdAt?.toDate?.(),
      });
    },
    () => onChange(null),
  );
}

export type OfferInput = {
  bookingId: string;
  ref: string;
  city: string;
  package: string;
  when: string;
  area: string;
  to: string;
  price: number;
  cutPercent: number;
};

/** Offer a booking to the drivers of its city (again, if it was withdrawn). */
export async function postOffer(user: User, o: OfferInput, existing: Offer | null) {
  const { db, doc, setDoc, updateDoc, serverTimestamp } = await fs();
  const cutPercent = clampCut(o.cutPercent);
  const price = Math.round(o.price);
  const fields = {
    bookingId: o.bookingId,
    ref: o.ref.slice(0, 20),
    city: o.city,
    package: o.package,
    when: o.when.slice(0, 40),
    area: o.area.trim().slice(0, 120),
    to: o.to.slice(0, 60),
    price,
    cutPercent,
    driverPay: driverPayFor(price, cutPercent),
    status: 'open',
    takenBy: null,
    takenAt: null,
    done: false,
    paid: false,
    paidAt: null,
    updatedAt: serverTimestamp(),
    by: user.uid,
  };
  const ref = doc(db, 'offers', o.bookingId);
  // Offering again keeps the first post time (the rules check it does not change).
  if (existing) await updateDoc(ref, fields);
  else await setDoc(ref, { ...fields, createdAt: serverTimestamp() });
}

async function patchOffer(user: User, bookingId: string, fields: Record<string, unknown>) {
  const { db, doc, updateDoc, serverTimestamp } = await fs();
  await updateDoc(doc(db, 'offers', bookingId), { ...fields, updatedAt: serverTimestamp(), by: user.uid });
}

export const withdrawOffer = (user: User, bookingId: string) => patchOffer(user, bookingId, { status: 'withdrawn' });

export const markOfferDone = (user: User, bookingId: string, done = true) => patchOffer(user, bookingId, { done });

export async function markOfferPaid(user: User, bookingId: string, paid = true) {
  const { serverTimestamp } = await fs();
  await patchOffer(user, bookingId, { paid, paidAt: paid ? serverTimestamp() : null });
}

/* ------------------------------------------------------------- blocked list */

/** Whether this number is blocked from booking and applying (admins only can read the list). */
export async function isPhoneBlocked(phone: string): Promise<boolean> {
  const { db, doc, getDoc } = await fs();
  return (await getDoc(doc(db, 'blocked', phone))).exists();
}

/**
 * Stop a number from booking or applying again — for spam or abuse. Bookings it
 * already made stay as they are (cancel them as usual). firestore.rules refuses
 * new ones from both the website and the app.
 */
export async function blockPhone(user: User, phone: string, reason: string) {
  const { db, doc, setDoc, serverTimestamp } = await fs();
  await setDoc(doc(db, 'blocked', phone), { reason: reason.trim().slice(0, 200), by: user.uid, at: serverTimestamp() });
}

export async function unblockPhone(phone: string) {
  const { db, doc, deleteDoc } = await fs();
  await deleteDoc(doc(db, 'blocked', phone));
}
