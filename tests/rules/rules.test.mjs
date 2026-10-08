/**
 * firestore.rules, exercised against the real Firestore emulator.
 *
 *     cd tests/rules && npm install && npm test     (needs Java 11+)
 *
 * Each role — guest, logged-in customer, a different customer, admin — tries both
 * what it should be able to do and what it must not. A rules change that opens a
 * hole fails here before it can be deployed.
 */

import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  deleteDoc,
} from 'firebase/firestore';

let env;

const booking = (extra = {}) => ({
  name: 'Ramesh Sahu',
  phone: '9111473929',
  city: 'Raipur',
  package: '3-hours-600',
  pickup: 'Shankar Nagar, Raipur',
  preferredTime: '',
  notes: '',
  createdAt: serverTimestamp(),
  status: 'new',
  source: 'website',
  ...extra,
});

const driverApp = () => ({
  name: 'Suresh Verma',
  phone: '9893302783',
  city: 'Bhilai',
  experienceYears: 7,
  licence: 'lmv',
  about: '',
  createdAt: serverTimestamp(),
  status: 'new',
  source: 'website',
});

const guest = () => env.unauthenticatedContext().firestore();
const customer = (uid = 'cust1') => env.authenticatedContext(uid, { phone_number: '+919111473929' }).firestore();
const admin = () =>
  env.authenticatedContext('admin1', { email: 'owner@example.com', email_verified: true, admin: true }).firestore();
const notAdmin = () =>
  env.authenticatedContext('google1', { email: 'someone@example.com', email_verified: true }).firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-drivebuddy',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(() => env.cleanup());
beforeEach(() => env.clearFirestore());

/** Seed a booking with the rules switched off, as the Cloud Function would leave it. */
async function seedBooking(id, extra = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'bookings', id), {
      ...booking(),
      createdAt: new Date(),
      ref: 'DB-1001',
      ...extra,
    });
  });
}

describe('bookings — creating', () => {
  test('a guest can book', () => assertSucceeds(addDoc(collection(guest(), 'bookings'), booking())));

  test('a logged-in customer can book with their own uid', () =>
    assertSucceeds(addDoc(collection(customer(), 'bookings'), booking({ customerUid: 'cust1' }))));

  test("nobody can tag a booking with someone else's uid", async () => {
    await assertFails(addDoc(collection(customer(), 'bookings'), booking({ customerUid: 'cust2' })));
    await assertFails(addDoc(collection(guest(), 'bookings'), booking({ customerUid: 'cust1' })));
  });

  test('a booking cannot arrive already handled, numbered or with extra fields', async () => {
    await assertFails(addDoc(collection(guest(), 'bookings'), booking({ status: 'confirmed' })));
    await assertFails(addDoc(collection(guest(), 'bookings'), booking({ ref: 'DB-9999' })));
    await assertFails(addDoc(collection(guest(), 'bookings'), booking({ isAdmin: true })));
    await assertFails(addDoc(collection(guest(), 'bookings'), booking({ createdAt: new Date(2020, 0, 1) })));
  });

  test('bad phone, city or package is refused', async () => {
    await assertFails(addDoc(collection(guest(), 'bookings'), booking({ phone: '12345' })));
    await assertFails(addDoc(collection(guest(), 'bookings'), booking({ city: 'Mumbai' })));
    await assertFails(addDoc(collection(guest(), 'bookings'), booking({ package: 'free-ride' })));
  });
});

describe('bookings — reading', () => {
  test('guests and non-admin Google accounts cannot read any booking', async () => {
    await seedBooking('b1');
    await assertFails(getDoc(doc(guest(), 'bookings', 'b1')));
    await assertFails(getDoc(doc(notAdmin(), 'bookings', 'b1')));
    await assertFails(getDocs(collection(guest(), 'bookings')));
  });

  test('a customer reads only their own bookings', async () => {
    await seedBooking('mine', { customerUid: 'cust1' });
    await seedBooking('theirs', { customerUid: 'cust2' });
    await seedBooking('guest-made');
    const db = customer('cust1');
    await assertSucceeds(getDoc(doc(db, 'bookings', 'mine')));
    await assertFails(getDoc(doc(db, 'bookings', 'theirs')));
    await assertFails(getDoc(doc(db, 'bookings', 'guest-made')));
    await assertSucceeds(
      getDocs(query(collection(db, 'bookings'), where('customerUid', '==', 'cust1'), orderBy('createdAt', 'desc'))),
    );
    await assertFails(getDocs(collection(db, 'bookings')));
  });

  test('an admin reads everything', async () => {
    await seedBooking('b1');
    await assertSucceeds(getDocs(query(collection(admin(), 'bookings'), orderBy('createdAt', 'desc'))));
  });
});

describe('bookings — admin workflow', () => {
  const stamp = (extra) => ({ ...extra, updatedAt: serverTimestamp(), updatedBy: 'admin1' });

  test('an admin confirms, assigns a driver and completes, with a timeline entry each time', async () => {
    await seedBooking('b1');
    const db = admin();
    const batch = writeBatch(db);
    batch.update(doc(db, 'bookings', 'b1'), stamp({ status: 'confirmed' }));
    batch.set(doc(collection(db, 'bookings', 'b1', 'events')), {
      type: 'status',
      from: 'new',
      to: 'confirmed',
      note: '',
      by: 'owner@example.com',
      at: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());

    await assertSucceeds(
      updateDoc(
        doc(db, 'bookings', 'b1'),
        stamp({ status: 'assigned', assignedDriver: { id: 'd1', name: 'Suresh Verma', phone: '9893302783' } }),
      ),
    );
    await assertSucceeds(updateDoc(doc(db, 'bookings', 'b1'), stamp({ status: 'completed' })));
  });

  test('even an admin cannot rewrite the customer, the reference or an unknown status', async () => {
    await seedBooking('b1');
    const db = admin();
    await assertFails(updateDoc(doc(db, 'bookings', 'b1'), stamp({ phone: '9000000000' })));
    await assertFails(updateDoc(doc(db, 'bookings', 'b1'), stamp({ ref: 'DB-1' })));
    await assertFails(updateDoc(doc(db, 'bookings', 'b1'), stamp({ status: 'paid' })));
    await assertFails(updateDoc(doc(db, 'bookings', 'b1'), { status: 'confirmed', updatedAt: serverTimestamp(), updatedBy: 'someone-else' }));
    // Internal notes go to the admin-only timeline, never onto the booking the customer can read.
    await assertFails(updateDoc(doc(db, 'bookings', 'b1'), stamp({ adminNote: 'difficult customer' })));
    await assertFails(deleteDoc(doc(db, 'bookings', 'b1')));
  });

  test('customers and guests cannot change a booking', async () => {
    await seedBooking('b1', { customerUid: 'cust1' });
    await assertFails(updateDoc(doc(customer('cust1'), 'bookings', 'b1'), { status: 'cancelled' }));
    await assertFails(updateDoc(doc(guest(), 'bookings', 'b1'), { status: 'cancelled' }));
  });

  test('the timeline is append-only and admin-only', async () => {
    await seedBooking('b1');
    const event = { type: 'note', from: null, to: null, note: 'Called, no answer', by: 'owner@example.com', at: serverTimestamp() };
    await assertSucceeds(setDoc(doc(admin(), 'bookings', 'b1', 'events', 'e1'), event));
    await assertFails(updateDoc(doc(admin(), 'bookings', 'b1', 'events', 'e1'), { note: 'edited' }));
    await assertFails(setDoc(doc(customer(), 'bookings', 'b1', 'events', 'e2'), { ...event, by: 'x' }));
  });
});

describe('drivers', () => {
  test('anyone can apply; only an admin can read or change status', async () => {
    const ref = await assertSucceeds(addDoc(collection(guest(), 'drivers'), driverApp()));
    await assertFails(getDoc(doc(guest(), 'drivers', ref.id)));
    await assertFails(getDoc(doc(customer(), 'drivers', ref.id)));
    await assertSucceeds(getDoc(doc(admin(), 'drivers', ref.id)));
    await assertSucceeds(
      updateDoc(doc(admin(), 'drivers', ref.id), {
        status: 'active',
        updatedAt: serverTimestamp(),
        updatedBy: 'admin1',
      }),
    );
    await assertFails(
      updateDoc(doc(admin(), 'drivers', ref.id), { phone: '9000000000', updatedAt: serverTimestamp(), updatedBy: 'admin1' }),
    );
  });
});

describe('users and customers', () => {
  const profile = (extra = {}) => ({
    name: 'Ramesh Sahu',
    phone: '9111473929',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...extra,
  });

  test('a customer creates and edits only their own profile', async () => {
    await assertSucceeds(setDoc(doc(customer('cust1'), 'users', 'cust1'), profile()));
    await assertSucceeds(updateDoc(doc(customer('cust1'), 'users', 'cust1'), { name: 'Ramesh K Sahu', updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(customer('cust1'), 'users', 'cust2'), profile()));
    await assertFails(getDoc(doc(customer('cust2'), 'users', 'cust1')));
    await assertFails(setDoc(doc(customer('cust3'), 'users', 'cust3'), profile({ role: 'admin' })));
  });

  test('customer records are admin-read-only', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'customers', '9111473929'), { bookingsCount: 1 }));
    await assertSucceeds(getDoc(doc(admin(), 'customers', '9111473929')));
    await assertFails(getDoc(doc(customer(), 'customers', '9111473929')));
    await assertFails(setDoc(doc(admin(), 'customers', '9111473929'), { bookingsCount: 99 }));
  });

  test('counters and unknown collections are closed to everyone', async () => {
    await assertFails(getDoc(doc(admin(), 'meta', 'counters')));
    await assertFails(setDoc(doc(admin(), 'anything', 'x'), { a: 1 }));
  });
});
