/**
 * Admin-panel writes. Every change to a booking is one atomic batch: the update
 * itself plus its timeline entry, so the history can never disagree with the
 * booking. firestore.rules checks the same shapes on the server.
 */

import type { User } from 'firebase/auth';

import type { BookingStatus, DriverRef, DriverStatus } from './bookings';
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

export async function changeDriverStatus(user: User, driverId: string, status: DriverStatus, adminNote?: string) {
  const { db, doc, updateDoc, serverTimestamp } = await fs();
  await updateDoc(doc(db, 'drivers', driverId), {
    status,
    ...(adminNote !== undefined && { adminNote: adminNote.slice(0, 1000) }),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
}
