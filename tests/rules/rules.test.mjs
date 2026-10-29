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
  env.authenticatedContext('admin1', { email: 'owner@example.com', email_verified: true }).firestore();
const notAdmin = () =>
  env.authenticatedContext('google1', { email: 'someone@example.com', email_verified: true }).firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-drivebuddy',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  // The robot's setup() writes this; rules look it up for every admin action.
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'admins', 'owner@example.com'), { email: 'owner@example.com' }));
});

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

  test('the mobile app books with source "app"; any other source is refused', async () => {
    await assertSucceeds(addDoc(collection(guest(), 'bookings'), booking({ source: 'app' })));
    await assertSucceeds(addDoc(collection(customer(), 'bookings'), booking({ source: 'app', customerUid: 'cust1' })));
    await assertFails(addDoc(collection(guest(), 'bookings'), booking({ source: 'admin' })));
  });

  test('a number blocked by an admin can no longer book or apply', async () => {
    await assertSucceeds(
      setDoc(doc(admin(), 'blocked', '9111473929'), { reason: 'spam', by: 'admin1', at: serverTimestamp() }),
    );
    await assertFails(addDoc(collection(guest(), 'bookings'), booking()));
    await assertFails(addDoc(collection(guest(), 'bookings'), booking({ source: 'app' })));
    await assertFails(addDoc(collection(guest(), 'drivers'), { ...driverApp(), phone: '9111473929' }));
    await assertSucceeds(addDoc(collection(guest(), 'bookings'), booking({ phone: '9876543210' })));
    await assertSucceeds(deleteDoc(doc(admin(), 'blocked', '9111473929')));
    await assertSucceeds(addDoc(collection(guest(), 'bookings'), booking()));
  });

  test('only an admin can see or change the blocked list', async () => {
    const entry = { reason: 'spam', by: 'google1', at: serverTimestamp() };
    await assertFails(setDoc(doc(notAdmin(), 'blocked', '9111473929'), entry));
    await assertFails(setDoc(doc(guest(), 'blocked', '9111473929'), entry));
    await assertFails(setDoc(doc(admin(), 'blocked', 'not-a-number'), { ...entry, by: 'admin1' }));
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'blocked', '9111473929'), { reason: 'x' }));
    await assertFails(getDoc(doc(customer(), 'blocked', '9111473929')));
    await assertSucceeds(getDoc(doc(admin(), 'blocked', '9111473929')));
  });

  test('bad phone, city or package is refused', async () => {
    await assertFails(addDoc(collection(guest(), 'bookings'), booking({ phone: '12345' })));
    await assertFails(addDoc(collection(guest(), 'bookings'), booking({ city: 'Mumbai' })));
    await assertFails(addDoc(collection(guest(), 'bookings'), booking({ package: 'free-ride' })));
  });

  const trip = (extra = {}) => ({
    to: 'Delhi', destId: 'delhi', kind: 'one-way', km: 1214, days: 3, returnHours: 11, estFrom: 5550, estTo: 6150, ...extra,
  });

  test('an outstation trip or one-way drop can carry its trip and estimate', async () => {
    const db = guest();
    await assertSucceeds(addDoc(collection(db, 'bookings'), booking({ package: 'one-way-drop', trip: trip() })));
    await assertSucceeds(
      addDoc(collection(db, 'bookings'), booking({ package: 'outstation', trip: trip({ kind: 'round', days: 6, returnHours: 0 }) })),
    );
    // A place not in the list: no km, no estimate.
    await assertSucceeds(
      addDoc(collection(db, 'bookings'), booking({ package: 'one-way-drop', trip: trip({ to: 'Jaipur', destId: '', km: 0, returnHours: 0, estFrom: 0, estTo: 0 }) })),
    );
    // Optional: older app versions send no trip.
    await assertSucceeds(addDoc(collection(db, 'bookings'), booking({ package: 'one-way-drop' })));
  });

  test('a trip must match its package and stay in shape', async () => {
    const db = guest();
    const bad = (pkg, t) => assertFails(addDoc(collection(db, 'bookings'), booking({ package: pkg, trip: t })));
    await bad('3-hours-600', trip()); // only trip packages
    await bad('outstation', trip()); // outstation is a round trip
    await bad('one-way-drop', trip({ kind: 'round', returnHours: 0 }));
    await bad('outstation', trip({ kind: 'round', returnHours: 3 })); // the driver comes back with the customer
    await bad('one-way-drop', trip({ returnHours: 2.5 }));
    await bad('one-way-drop', trip({ days: 0 }));
    await bad('one-way-drop', trip({ days: 1.5 }));
    await bad('one-way-drop', trip({ estFrom: 3000, estTo: 2000 }));
    await bad('one-way-drop', trip({ destId: 'Nagpur!' }));
    await bad('one-way-drop', trip({ driverCost: 1000 }));
    const { km: _km, ...noKm } = trip();
    await bad('one-way-drop', noKm);
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

  const agreed = (extra = {}) => ({
    amount: 3 * 1550 + 1200 + 650, dayRate: 1550, days: 3, returnHours: 11, returnHourRate: 120, returnCharge: 1200, extraHours: 0, extraHourRate: 120, ticket: 650,
    at: serverTimestamp(), ...extra,
  });

  test('an admin saves the agreed price; the cost and profit go only in the timeline', async () => {
    await seedBooking('b1', { package: 'one-way-drop', customerUid: 'cust1' });
    const db = admin();
    const batch = writeBatch(db);
    batch.update(doc(db, 'bookings', 'b1'), stamp({ quote: agreed() }));
    batch.set(doc(collection(db, 'bookings', 'b1', 'events')), {
      type: 'quote', from: null, to: null, note: 'Driver cost and profit here', by: 'owner@example.com', at: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
    // A later status change leaves the quote alone.
    await assertSucceeds(updateDoc(doc(db, 'bookings', 'b1'), stamp({ status: 'confirmed' })));
    // The customer sees the price.
    const seen = await getDoc(doc(customer('cust1'), 'bookings', 'b1'));
    if (seen.data().quote.amount !== 6500) throw new Error('customer should see the agreed amount');
  });

  test('a quote cannot hide a cost, add up wrong or be backdated', async () => {
    await seedBooking('b1', { package: 'one-way-drop' });
    const db = admin();
    await assertFails(updateDoc(doc(db, 'bookings', 'b1'), stamp({ quote: agreed({ driverCost: 1300 }) })));
    await assertFails(updateDoc(doc(db, 'bookings', 'b1'), stamp({ quote: agreed({ amount: 9999 }) })));
    // The daily maximum can lower the return charge, never raise it above hours × rate.
    await assertFails(updateDoc(doc(db, 'bookings', 'b1'), stamp({ quote: agreed({ returnCharge: 2000, amount: 3 * 1550 + 2000 + 650 }) })));
    await assertFails(updateDoc(doc(db, 'bookings', 'b1'), stamp({ quote: agreed({ at: new Date(2020, 0, 1) }) })));
    await assertFails(updateDoc(doc(customer('cust1'), 'bookings', 'b1'), { quote: agreed() }));
  });

  test('the way home: more than 6 h left over is a full day — allowed; more than a day per 24 h is not', async () => {
    await seedBooking('b1', { package: 'one-way-drop' });
    const db = admin();
    // 8 h home = a full day, ₹1,200 (more than 8 × ₹120).
    await assertSucceeds(updateDoc(doc(db, 'bookings', 'b1'), stamp({ quote: agreed({ returnHours: 8, returnCharge: 1200, amount: 3 * 1550 + 1200 + 650 }) })));
    // 8 h can never cost two days.
    await assertFails(updateDoc(doc(db, 'bookings', 'b1'), stamp({ quote: agreed({ returnHours: 8, returnCharge: 2400, amount: 3 * 1550 + 2400 + 650 }) })));
  });

  test('a drive shorter than a day: 0 full days, the driving hours priced by the hour', async () => {
    await seedBooking('b1', { package: 'one-way-drop' });
    const db = admin();
    // Raipur → Nagpur: 6 driving hours + 6 hours home, ₹120 each.
    const short = agreed({ days: 0, extraHours: 6, returnHours: 6, returnCharge: 720, ticket: 0, amount: 6 * 120 + 720 });
    await assertSucceeds(updateDoc(doc(db, 'bookings', 'b1'), stamp({ quote: short })));
    // But not nothing at all.
    await assertFails(updateDoc(doc(db, 'bookings', 'b1'), stamp({ quote: { ...short, extraHours: 0, amount: 720 } })));
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

describe('trip links and the final bill', () => {
  const KEY = 'Ab3dEf6hJk9mNp2qRs5tUv8wXy';
  const stamp = (extra) => ({ ...extra, updatedAt: serverTimestamp(), updatedBy: 'admin1' });
  const link = (extra = {}) => ({
    bookingId: 'b1', ref: 'DB-1001', to: 'Bengaluru', kind: 'one-way', nonstop: true, driverName: 'Suresh Verma',
    closed: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), by: 'admin1', ...extra,
  });
  const tap = (step, extra = {}) => ({
    [`${step}At`]: serverTimestamp(), [`${step}Phone`]: new Date(), updatedAt: serverTimestamp(), ...extra,
  });
  async function seedLink(extra = {}) {
    await seedBooking('b1', { package: 'one-way-drop', customerUid: 'cust1', status: 'assigned' });
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'tripLinks', KEY), { ...link(), createdAt: new Date(), updatedAt: new Date(), ...extra }),
    );
  }

  test('only an admin makes a link, for a real booking, with a long random key', async () => {
    await seedBooking('b1', { package: 'one-way-drop' });
    await assertFails(setDoc(doc(guest(), 'tripLinks', KEY), link({ by: 'x' })));
    await assertFails(setDoc(doc(notAdmin(), 'tripLinks', KEY), link({ by: 'google1' })));
    await assertFails(setDoc(doc(admin(), 'tripLinks', 'short1'), link()));
    await assertFails(setDoc(doc(admin(), 'tripLinks', KEY), link({ bookingId: 'nope' })));
    await assertFails(setDoc(doc(admin(), 'tripLinks', KEY), link({ startAt: serverTimestamp() })));
    await assertSucceeds(setDoc(doc(admin(), 'tripLinks', KEY), link()));
  });

  test('anyone with the key can open it; nobody but an admin can list them', async () => {
    await seedLink();
    await assertSucceeds(getDoc(doc(guest(), 'tripLinks', KEY)));
    await assertFails(getDocs(collection(guest(), 'tripLinks')));
    await assertFails(getDocs(query(collection(customer('cust1'), 'tripLinks'), where('bookingId', '==', 'b1'))));
    await assertSucceeds(getDocs(query(collection(admin(), 'tripLinks'), where('bookingId', '==', 'b1'))));
  });

  test('the driver taps start → drop → home, each once, in order, at the server time', async () => {
    await seedLink();
    const ref = doc(guest(), 'tripLinks', KEY);
    await assertFails(updateDoc(ref, tap('drop')));
    await assertFails(updateDoc(ref, tap('home')));
    await assertSucceeds(updateDoc(ref, tap('start', { startLoc: { lat: 21.25, lng: 81.63, acc: 20 } })));
    await assertFails(updateDoc(ref, tap('start')));
    await assertFails(updateDoc(ref, tap('home')));
    await assertSucceeds(updateDoc(ref, tap('drop')));
    await assertSucceeds(updateDoc(ref, tap('home')));
    await assertFails(updateDoc(ref, tap('home')));
  });

  test('a round trip has no drop: start → home', async () => {
    await seedLink({ kind: 'round' });
    const ref = doc(guest(), 'tripLinks', KEY);
    await assertSucceeds(updateDoc(ref, tap('start')));
    await assertFails(updateDoc(ref, tap('drop')));
    await assertSucceeds(updateDoc(ref, tap('home')));
  });

  test('a tap cannot pick its own time, change the trip or carry anything else', async () => {
    await seedLink();
    const ref = doc(guest(), 'tripLinks', KEY);
    await assertFails(updateDoc(ref, { ...tap('start'), startAt: new Date(Date.now() - 3600_000) }));
    await assertFails(updateDoc(ref, { ...tap('start'), startPhone: new Date(Date.now() + 3600_000) }));
    await assertFails(updateDoc(ref, { ...tap('start'), startPhone: new Date(Date.now() - 2 * 86_400_000) }));
    await assertFails(updateDoc(ref, { startAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, tap('start', { nonstop: false })));
    await assertFails(updateDoc(ref, tap('start', { closed: true })));
    await assertFails(updateDoc(ref, tap('start', { startLoc: { lat: 500, lng: 81, acc: 1 } })));
    await assertFails(updateDoc(ref, tap('start', { note: 'hi' })));
    await assertFails(deleteDoc(ref));
  });

  test('a closed link takes no more taps', async () => {
    await seedLink({ closed: true });
    await assertFails(updateDoc(doc(guest(), 'tripLinks', KEY), tap('start')));
  });

  test('an admin corrects a time, switches day and night and closes the link — in order, never null', async () => {
    await seedLink();
    const ref = doc(admin(), 'tripLinks', KEY);
    const at = (h) => new Date(Date.UTC(2026, 9, 29, 2) + h * 3600_000);
    const fix = (extra) => ({ ...extra, updatedAt: serverTimestamp(), by: 'admin1' });
    await assertSucceeds(updateDoc(ref, fix({ startAt: at(0), dropAt: at(29), homeAt: at(67), nonstop: false })));
    await assertFails(updateDoc(ref, fix({ dropAt: at(70) })));
    await assertFails(updateDoc(ref, fix({ homeAt: null })));
    await assertFails(updateDoc(ref, fix({ bookingId: 'b2' })));
    await assertFails(updateDoc(ref, { startAt: at(1), updatedAt: serverTimestamp(), by: 'someone-else' }));
    await assertFails(updateDoc(doc(notAdmin(), 'tripLinks', KEY), fix({ startAt: at(1), by: 'google1' })));
    await assertSucceeds(updateDoc(ref, fix({ closed: true })));
  });

  const finalBill = (extra = {}) => ({
    amount: 2 * 1600 + 600 + 2400, dayRate: 1600, days: 2, extraHours: 5, extraHourRate: 120, extraCharge: 600,
    returnHours: 38, returnHourRate: 120, returnCharge: 2400, ticket: 0, nonstop: true, at: serverTimestamp(), ...extra,
  });
  const clock = () => ({ startAt: new Date(Date.UTC(2026, 9, 29, 2, 15)), dropAt: new Date(Date.UTC(2026, 9, 30, 7, 10)), homeAt: new Date(Date.UTC(2026, 9, 31, 20, 50)) });

  test('an admin saves the final bill and the times; the customer sees them', async () => {
    await seedLink();
    const db = admin();
    const batch = writeBatch(db);
    batch.update(doc(db, 'bookings', 'b1'), stamp({ bill: finalBill(), clock: clock() }));
    batch.set(doc(collection(db, 'bookings', 'b1', 'events')), {
      type: 'bill', from: null, to: null, note: 'Driver pay and profit here', by: 'owner@example.com', at: serverTimestamp(),
    });
    batch.update(doc(db, 'tripLinks', KEY), { closed: true, updatedAt: serverTimestamp(), by: 'admin1' });
    await assertSucceeds(batch.commit());
    const seen = await getDoc(doc(customer('cust1'), 'bookings', 'b1'));
    if (seen.data().bill.amount !== 6200) throw new Error('customer should see the final bill');
  });

  test('a bill cannot add up wrong, overcharge extra hours, hide a cost or be backdated', async () => {
    await seedLink();
    const db = admin();
    const save = (b) => updateDoc(doc(db, 'bookings', 'b1'), stamp({ bill: b }));
    await assertFails(save(finalBill({ amount: 9999 })));
    await assertFails(save(finalBill({ extraCharge: 700, amount: 3200 + 700 + 2400 })));
    await assertFails(save(finalBill({ extraHours: 20, extraCharge: 2400, amount: 3200 + 2400 + 2400 })));
    await assertFails(save(finalBill({ returnCharge: 5000, amount: 3200 + 600 + 5000 })));
    await assertFails(save(finalBill({ driverPay: 4000 })));
    await assertFails(save(finalBill({ at: new Date(2020, 0, 1) })));
    await assertFails(updateDoc(doc(db, 'bookings', 'b1'), stamp({ clock: { startAt: new Date(2026, 9, 30), homeAt: new Date(2026, 9, 29) } })));
    await assertFails(updateDoc(doc(customer('cust1'), 'bookings', 'b1'), { bill: finalBill() }));
    await assertFails(updateDoc(doc(guest(), 'bookings', 'b1'), { clock: clock() }));
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

  test('a customer can delete their own account profile, and only their own', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'users', 'cust1'), { name: 'Ramesh' }));
    await assertFails(deleteDoc(doc(customer('cust2'), 'users', 'cust1')));
    await assertFails(deleteDoc(doc(guest(), 'users', 'cust1')));
    await assertSucceeds(deleteDoc(doc(customer('cust1'), 'users', 'cust1')));
  });

  test('a customer registers only their own phones for notifications, in a fixed shape', async () => {
    const device = (extra = {}) => ({
      token: 'ExponentPushToken[abcdEFGH1234_-]',
      platform: 'android',
      language: 'hi',
      updatedAt: serverTimestamp(),
      ...extra,
    });
    const mine = doc(customer('cust1'), 'users', 'cust1', 'devices', 'ExponentPushToken_abcdEFGH1234_-_');
    await assertSucceeds(setDoc(mine, device()));
    await assertSucceeds(setDoc(mine, device({ language: 'en' }))); // language change on the same phone
    await assertSucceeds(getDoc(mine));
    await assertSucceeds(deleteDoc(mine)); // logout
    await assertFails(setDoc(doc(customer('cust2'), 'users', 'cust1', 'devices', 'x'), device()));
    await assertFails(setDoc(doc(guest(), 'users', 'cust1', 'devices', 'x'), device()));
    await assertFails(setDoc(doc(customer('cust1'), 'users', 'cust1', 'devices', 'x'), device({ token: 'not-a-token' })));
    await assertFails(setDoc(doc(customer('cust1'), 'users', 'cust1', 'devices', 'x'), device({ platform: 'web' })));
    await assertFails(setDoc(doc(customer('cust1'), 'users', 'cust1', 'devices', 'x'), device({ extra: true })));
    await assertFails(getDoc(doc(customer('cust2'), 'users', 'cust1', 'devices', 'ExponentPushToken_abcdEFGH1234_-_')));
  });

  test('customer records are admin-read-only', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'customers', '9111473929'), { bookingsCount: 1 }));
    await assertSucceeds(getDoc(doc(admin(), 'customers', '9111473929')));
    await assertFails(getDoc(doc(customer(), 'customers', '9111473929')));
    await assertFails(setDoc(doc(admin(), 'customers', '9111473929'), { bookingsCount: 99 }));
  });

  test('only you can see your own admin entry, and nobody can make themselves admin', async () => {
    await assertSucceeds(getDoc(doc(admin(), 'admins', 'owner@example.com')));
    await assertFails(getDoc(doc(notAdmin(), 'admins', 'owner@example.com')));
    await assertFails(setDoc(doc(notAdmin(), 'admins', 'someone@example.com'), { email: 'someone@example.com' }));
    const unverified = env.authenticatedContext('x', { email: 'owner@example.com', email_verified: false }).firestore();
    await assertFails(getDocs(collection(unverified, 'bookings')));
  });

  test('counters and unknown collections are closed to everyone', async () => {
    await assertFails(getDoc(doc(admin(), 'meta', 'counters')));
    await assertFails(setDoc(doc(admin(), 'anything', 'x'), { a: 1 }));
  });
});
