/**
 * Admin-panel writes. Every change to a booking is one atomic batch: the update
 * itself plus its timeline entry, so the history can never disagree with the
 * booking. firestore.rules checks the same shapes on the server.
 */

import type { User } from 'firebase/auth';

import type { BookingQuote, BookingStatus, DriverRef, DriverStatus } from './bookings';
import { getFirebaseApp } from './firebase';

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
