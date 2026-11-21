/**
 * firestore.rules, exercised against the real Firestore emulator.
 *
 *     cd tests/rules && npm install && npm test     (needs Java 11+)
 *
 * Each role — guest, logged-in customer, a different customer, admin — tries both
 * what it should be able to do and what it must not. A rules change that opens a
 * hole fails here before it can be deployed.
 */

import assert from 'node:assert/strict';
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
  runTransaction,
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

  test('the exact pickup spot is optional, and must be a real place in India', async () => {
    const add = (extra) => addDoc(collection(guest(), 'bookings'), booking(extra));
    await assertSucceeds(add({ pickupGeo: { lat: 21.251384, lng: 81.629641, acc: 15 } }));
    // A pin placed by hand has no accuracy.
    await assertSucceeds(add({ pickupGeo: { lat: 21.25, lng: 81.63 } }));
    // London.
    await assertFails(add({ pickupGeo: { lat: 51.5, lng: -0.12 } }));
    await assertFails(add({ pickupGeo: { lat: '21.25', lng: 81.63 } }));
    await assertFails(add({ pickupGeo: { lat: 21.25 } }));
    await assertFails(add({ pickupGeo: { lat: 21.25, lng: 81.63, acc: -1 } }));
    await assertFails(add({ pickupGeo: { lat: 21.25, lng: 81.63, name: 'home' } }));
    await assertFails(add({ pickupGeo: 'Shankar Nagar' }));
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

  test('a drive shorter than a day at the short-drive price: ₹600 for 3 h, then ₹120 an hour (29 Oct 2026)', async () => {
    await seedBooking('b1', { package: 'one-way-drop' });
    const db = admin();
    const save = (q) => updateDoc(doc(db, 'bookings', 'b1'), stamp({ quote: q }));
    // Raipur → Nagpur: 6 h of driving = ₹600 + 3 × ₹120 = ₹960, plus 6 h home (₹720).
    const short = agreed({ days: 0, extraHours: 6, extraCharge: 960, returnHours: 6, returnCharge: 720, ticket: 0, amount: 960 + 720 });
    await assertSucceeds(save(short));
    // The amount must use that charge, not hours × rate…
    await assertFails(save({ ...short, amount: 6 * 120 + 720 }));
    // …never more than a day…
    await assertFails(save({ ...short, extraCharge: 1600, amount: 1600 + 720 }));
    // …and with full days, the extra hours stay hours × rate.
    await assertFails(save(agreed({ extraHours: 2, extraCharge: 600, amount: 3 * 1550 + 1200 + 600 + 650 })));
  });

  test('a route price: one day at the price, his way home included (1 Nov 2026)', async () => {
    await seedBooking('b1', { package: 'one-way-drop' });
    const db = admin();
    const save = (q) => updateDoc(doc(db, 'bookings', 'b1'), stamp({ quote: q }));
    // Raipur → Delhi: ₹5,800 for 1,214 km, about 60 h away; the ticket on top.
    const route = agreed({
      days: 1, dayRate: 5800, returnHours: 0, returnCharge: 0, extraHours: 0, awayHours: 60, km: 1214,
      ticket: 0, amount: 5800,
    });
    await assertSucceeds(save(route));
    await assertSucceeds(save({ ...route, ticket: 1200, amount: 5800 + 1200 }));
    // Nothing else may be charged on top, and it must add up.
    await assertFails(save({ ...route, returnHours: 24, returnCharge: 1200, amount: 7000 }));
    await assertFails(save({ ...route, days: 3, amount: 3 * 5800 }));
    await assertFails(save({ ...route, extraHours: 2, amount: 5800 + 240 }));
    await assertFails(save({ ...route, amount: 6000 }));
    await assertFails(save({ ...route, awayHours: 0 }));
    await assertFails(save({ ...route, km: -5 }));
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
    // A one-way drive shorter than a day is priced in steps: 3 h = ₹600 (more than 3 × ₹120).
    await assertSucceeds(save(finalBill({ days: 0, dayRate: 1300, extraHours: 3, extraCharge: 600, returnHours: 3, returnCharge: 360, amount: 600 + 360 })));
    await assertFails(save(finalBill({ days: 0, dayRate: 1300, extraHours: 3, extraCharge: 1400, returnHours: 3, returnCharge: 360, amount: 1400 + 360 })));
    await assertFails(save(finalBill({ extraHours: 20, extraCharge: 2400, amount: 3200 + 2400 + 2400 })));
    await assertFails(save(finalBill({ returnCharge: 5000, amount: 3200 + 600 + 5000 })));
    // A route price: the price, and the hours he was home late at the hourly rate.
    const route = { days: 1, dayRate: 5800, returnHours: 0, returnCharge: 0, awayHours: 60, km: 1214 };
    await assertSucceeds(save(finalBill({ ...route, extraHours: 0, extraCharge: 0, amount: 5800 })));
    await assertSucceeds(save(finalBill({ ...route, extraHours: 4, extraCharge: 480, amount: 5800 + 480 })));
    await assertFails(save(finalBill({ ...route, extraHours: 4, extraCharge: 480, amount: 5800 })));
    await assertFails(save(finalBill({ ...route, days: 2, extraHours: 0, extraCharge: 0, amount: 11600 })));
    await assertFails(save(finalBill({ ...route, returnHours: 24, returnCharge: 1200, extraHours: 0, extraCharge: 0, amount: 7000 })));
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

describe('driver app — jobs and live tracking', () => {
  const RAJU = '9893302783';
  const driver = (phone = RAJU, extra = {}) =>
    env.authenticatedContext(`driver-${phone}`, { role: 'driver', driverPhone: phone, driverId: 'd1', ...extra }).firestore();
  const assigned = (phone = RAJU) => ({ status: 'assigned', assignedDriver: { id: 'd1', name: 'Raju Sahu', phone }, customerUid: 'cust1' });
  const point = (extra = {}) => ({
    lat: 21.25, lng: 81.63, acc: 12, heading: 90, speed: 8.5, active: true,
    at: serverTimestamp(), phoneAt: new Date(), driverPhone: RAJU, driverName: 'Raju Sahu', ...extra,
  });

  test('a driver reads and lists only the bookings assigned to his number right now', async () => {
    await seedBooking('mine', assigned());
    await seedBooking('other', assigned('9111111111'));
    await seedBooking('done', { ...assigned(), status: 'completed' });
    await seedBooking('free', { status: 'confirmed' });

    await assertSucceeds(getDoc(doc(driver(), 'bookings', 'mine')));
    await assertFails(getDoc(doc(driver(), 'bookings', 'other')));
    await assertFails(getDoc(doc(driver(), 'bookings', 'done')));
    await assertFails(getDoc(doc(driver(), 'bookings', 'free')));

    const q = query(collection(driver(), 'bookings'), where('assignedDriver.phone', '==', RAJU), where('status', '==', 'assigned'));
    const snap = await assertSucceeds(getDocs(q));
    assert.deepEqual(snap.docs.map((d) => d.id), ['mine']);
    await assertFails(getDocs(query(collection(driver(), 'bookings'), where('status', '==', 'assigned'))));
    await assertFails(getDocs(collection(driver(), 'bookings')));
  });

  test('a driver cannot change a booking, and a customer token with a phone number is not a driver', async () => {
    await seedBooking('mine', assigned());
    await assertFails(updateDoc(doc(driver(), 'bookings', 'mine'), { status: 'completed' }));
    const fake = env.authenticatedContext('cust9', { phone_number: `+91${RAJU}` }).firestore();
    await assertFails(getDoc(doc(fake, 'bookings', 'mine')));
    const noRole = env.authenticatedContext('x', { driverPhone: RAJU }).firestore();
    await assertFails(getDoc(doc(noRole, 'bookings', 'mine')));
  });

  test('the assigned driver shares his location; the customer and admin see it; nobody else', async () => {
    await seedBooking('mine', assigned());
    const t = doc(driver(), 'tracking', 'mine');
    await assertSucceeds(setDoc(t, point()));
    await assertSucceeds(setDoc(t, point({ lat: 21.26, active: false })));

    await assertSucceeds(getDoc(doc(customer('cust1'), 'tracking', 'mine')));
    await assertSucceeds(getDoc(doc(admin(), 'tracking', 'mine')));
    await assertSucceeds(getDoc(doc(driver(), 'tracking', 'mine')));
    await assertFails(getDoc(doc(customer('cust2'), 'tracking', 'mine')));
    await assertFails(getDoc(doc(guest(), 'tracking', 'mine')));
    await assertFails(getDoc(doc(driver('9111111111'), 'tracking', 'mine')));
    await assertFails(deleteDoc(t));
  });

  test('tracking: only on his own current job, in the exact shape, with the server time', async () => {
    await seedBooking('other', assigned('9111111111'));
    await seedBooking('done', { ...assigned(), status: 'completed' });
    await seedBooking('mine', assigned());
    await assertFails(setDoc(doc(driver(), 'tracking', 'other'), point()));
    await assertFails(setDoc(doc(driver(), 'tracking', 'done'), point()));
    await assertFails(setDoc(doc(driver(), 'tracking', 'nobooking'), point()));
    await assertFails(setDoc(doc(customer('cust1'), 'tracking', 'mine'), point()));
    const t = doc(driver(), 'tracking', 'mine');
    await assertFails(setDoc(t, point({ at: new Date() })));
    await assertFails(setDoc(t, point({ driverPhone: '9111111111' })));
    await assertFails(setDoc(t, point({ lat: 51.5, lng: -0.12 }))); // outside India
    await assertFails(setDoc(t, point({ phoneAt: new Date(Date.now() + 3600e3) })));
    await assertFails(setDoc(t, point({ extra: 1 })));
    await assertFails(setDoc(t, point({ active: 'yes' })));
    const { heading, speed, driverName, ...bare } = point();
    await assertSucceeds(setDoc(t, bare));
  });
});

describe('drivers — an admin adding one directly', () => {
  const added = (extra = {}) => ({
    name: 'Raju Sahu', phone: '9893302783', city: 'Raipur', experienceYears: 8, licence: 'lmv',
    about: '', adminNote: 'Licence and police check seen', status: 'active', source: 'admin',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: 'admin1', ...extra,
  });

  test('an admin can add a driver as Active or Verified', async () => {
    await assertSucceeds(addDoc(collection(admin(), 'drivers'), added()));
    await assertSucceeds(addDoc(collection(admin(), 'drivers'), added({ status: 'verified' })));
  });

  test('nobody else can, and not in any other shape', async () => {
    await assertFails(addDoc(collection(guest(), 'drivers'), added()));
    await assertFails(addDoc(collection(notAdmin(), 'drivers'), added({ updatedBy: 'google1' })));
    await assertFails(addDoc(collection(admin(), 'drivers'), added({ status: 'rejected' })));
    await assertFails(addDoc(collection(admin(), 'drivers'), added({ source: 'website' })));
    await assertFails(addDoc(collection(admin(), 'drivers'), added({ experienceYears: 3 })));
    await assertFails(addDoc(collection(admin(), 'drivers'), added({ updatedBy: 'someone-else' })));
    await assertFails(addDoc(collection(admin(), 'drivers'), added({ createdAt: new Date() })));
    await assertFails(addDoc(collection(admin(), 'drivers'), added({ extra: 1 })));
    // A guest can still apply as before, only as "new".
    await assertFails(addDoc(collection(guest(), 'drivers'), { ...driverApp(), status: 'active' }));
    await assertSucceeds(addDoc(collection(guest(), 'drivers'), driverApp()));
  });
});

describe('job offers — admin posts, an Active driver in that city takes it', () => {
  const RAJU = { id: 'd1', name: 'Raju Sahu', phone: '9893302783' };
  const SONU = { id: 'd2', name: 'Sonu Verma', phone: '9425212345' };
  const drv = (d) => env.authenticatedContext(`driver-${d.phone}`, { role: 'driver', driverPhone: d.phone, driverId: d.id }).firestore();
  const offer = (extra = {}) => ({
    bookingId: 'b1', ref: 'DB-1042', city: 'Raipur', package: '3-hours-600', when: '', area: 'Shankar Nagar',
    to: '', price: 600, cutPercent: 25, driverPay: 450, status: 'open', takenBy: null, takenAt: null,
    done: false, paid: false, paidAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), by: 'admin1', ...extra,
  });
  const seedDrivers = () =>
    env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'drivers', 'd1'), { ...RAJU, city: 'Raipur', status: 'active' });
      await setDoc(doc(db, 'drivers', 'd2'), { ...SONU, city: 'Bhilai', status: 'active' });
      await setDoc(doc(db, 'drivers', 'd3'), { name: 'Old Driver', phone: '9111111111', city: 'Raipur', status: 'inactive' });
    });
  const take = (db, who) =>
    runTransaction(db, async (tx) => {
      const ref = doc(db, 'offers', 'b1');
      const snap = await tx.get(ref);
      if (snap.data()?.status !== 'open') throw new Error('gone');
      tx.update(ref, { status: 'taken', takenBy: who, takenAt: serverTimestamp(), updatedAt: serverTimestamp() });
      tx.update(doc(db, 'bookings', 'b1'), { status: 'assigned', assignedDriver: who, updatedAt: serverTimestamp(), updatedBy: `driver-${who.phone}` });
    });

  beforeEach(async () => {
    await seedDrivers();
    await seedBooking('b1', { status: 'confirmed', customerUid: 'cust1' });
  });

  test('an admin posts an offer; customers and guests cannot see it', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'offers', 'b1'), offer()));
    await assertFails(getDoc(doc(customer('cust1'), 'offers', 'b1')));
    await assertFails(getDoc(doc(guest(), 'offers', 'b1')));
    await assertFails(setDoc(doc(admin(), 'offers', 'nobooking'), offer({ bookingId: 'nobooking' })));
    await assertFails(setDoc(doc(admin(), 'offers', 'b1'), offer({ cutPercent: 10 })));
    await assertFails(setDoc(doc(admin(), 'offers', 'b1'), offer({ status: 'taken', takenBy: RAJU })));
    await assertFails(setDoc(doc(drv(RAJU), 'offers', 'b1'), offer()));
  });

  test('Active drivers of that city see open offers; others do not', async () => {
    await setDoc(doc(admin(), 'offers', 'b1'), offer());
    const open = (db, city) => getDocs(query(collection(db, 'offers'), where('status', '==', 'open'), where('city', '==', city)));
    await assertSucceeds(open(drv(RAJU), 'Raipur'));
    await assertSucceeds(getDoc(doc(drv(RAJU), 'offers', 'b1')));
    await assertFails(open(drv(SONU), 'Raipur')); // Bhilai driver
    await assertFails(getDoc(doc(drv({ id: 'd3', name: 'Old Driver', phone: '9111111111' }), 'offers', 'b1'))); // inactive
    await assertFails(getDoc(doc(drv({ id: 'd1', name: 'Raju Sahu', phone: '9000000000' }), 'offers', 'b1'))); // wrong number for d1
    await assertSucceeds(getDoc(doc(drv(RAJU), 'drivers', 'd1')));
    await assertFails(getDoc(doc(drv(RAJU), 'drivers', 'd2')));
  });

  test('the first driver to accept gets the job and the booking; the second cannot', async () => {
    await setDoc(doc(admin(), 'offers', 'b1'), offer());
    await assertSucceeds(take(drv(RAJU), RAJU));
    const b = await env.withSecurityRulesDisabled(async (ctx) => (await getDoc(doc(ctx.firestore(), 'bookings', 'b1'))).data());
    assert.equal(b.status, 'assigned');
    assert.deepEqual(b.assignedDriver, RAJU);
    // He now sees the job, and his offer as earnings.
    await assertSucceeds(getDoc(doc(drv(RAJU), 'bookings', 'b1')));
    await assertSucceeds(getDocs(query(collection(drv(RAJU), 'offers'), where('takenBy.phone', '==', RAJU.phone))));
    // A second Raipur driver is too late.
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'drivers', 'd4'), { name: 'Vijay', phone: '9300000000', city: 'Raipur', status: 'active' }));
    const VIJAY = { id: 'd4', name: 'Vijay', phone: '9300000000' };
    await assertFails(take(drv(VIJAY), VIJAY));
  });

  test('a driver can only take it for himself, only in his city, and only with the offer', async () => {
    await setDoc(doc(admin(), 'offers', 'b1'), offer());
    // Booking alone, without the offer: refused.
    await assertFails(updateDoc(doc(drv(RAJU), 'bookings', 'b1'), { status: 'assigned', assignedDriver: RAJU, updatedAt: serverTimestamp(), updatedBy: `driver-${RAJU.phone}` }));
    // For someone else: refused.
    await assertFails(take(drv(RAJU), SONU));
    // Another city: refused.
    await assertFails(take(drv(SONU), SONU));
    // A withdrawn offer: refused.
    await updateDoc(doc(admin(), 'offers', 'b1'), { status: 'withdrawn', updatedAt: serverTimestamp(), by: 'admin1' });
    await assertFails(take(drv(RAJU), RAJU));
  });

  test('an admin marks the job done and the driver paid; a driver cannot', async () => {
    await setDoc(doc(admin(), 'offers', 'b1'), offer());
    await take(drv(RAJU), RAJU);
    await assertFails(updateDoc(doc(drv(RAJU), 'offers', 'b1'), { paid: true, updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(admin(), 'offers', 'b1'), { done: true, updatedAt: serverTimestamp(), by: 'admin1' }));
    await assertSucceeds(updateDoc(doc(admin(), 'offers', 'b1'), { paid: true, paidAt: serverTimestamp(), updatedAt: serverTimestamp(), by: 'admin1' }));
    await assertFails(deleteDoc(doc(admin(), 'offers', 'b1')));
  });
});

describe('availability — Online in the Driver app', () => {
  const RAJU = { id: 'd1', name: 'Raju Sahu', phone: '9893302783' };
  const drv = (d) => env.authenticatedContext(`driver-${d.phone}`, { role: 'driver', driverPhone: d.phone, driverId: d.id }).firestore();
  const on = (extra = {}) => ({ online: true, city: 'Raipur', name: 'Raju Sahu', phone: '9893302783', lat: 21.25, lng: 81.63, acc: 20, pushToken: 'ExponentPushToken[abc]', at: serverTimestamp(), ...extra });

  beforeEach(() =>
    env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'drivers', 'd1'), { ...RAJU, city: 'Raipur', status: 'active' });
      await setDoc(doc(ctx.firestore(), 'drivers', 'd3'), { name: 'Old Driver', phone: '9111111111', city: 'Raipur', status: 'inactive' });
    }),
  );

  test('an Active driver goes online and offline on his own document', async () => {
    await assertSucceeds(setDoc(doc(drv(RAJU), 'availability', 'd1'), on()));
    const { lat, lng, acc, ...bare } = on({ online: false });
    await assertSucceeds(setDoc(doc(drv(RAJU), 'availability', 'd1'), bare));
    await assertSucceeds(getDoc(doc(drv(RAJU), 'availability', 'd1')));
    await assertSucceeds(getDoc(doc(admin(), 'availability', 'd1')));
  });

  test('not for someone else, another city, an inactive driver, or a customer', async () => {
    await assertFails(setDoc(doc(drv(RAJU), 'availability', 'd3'), on()));
    await assertFails(setDoc(doc(drv(RAJU), 'availability', 'd1'), on({ city: 'Bhilai' })));
    await assertFails(setDoc(doc(drv(RAJU), 'availability', 'd1'), on({ at: new Date() })));
    await assertFails(setDoc(doc(drv(RAJU), 'availability', 'd1'), on({ lat: 51.5 })));
    await assertFails(setDoc(doc(drv({ id: 'd3', name: 'Old Driver', phone: '9111111111' }), 'availability', 'd3'), on({ city: 'Raipur', name: 'Old Driver', phone: '9111111111' })));
    await assertFails(getDoc(doc(customer(), 'availability', 'd1')));
    await assertFails(setDoc(doc(customer(), 'availability', 'd1'), on()));
  });
});

/* ---------------------------------------------- automation (spec items 2–12) */

const RAJU = { id: 'd1', name: 'Raju Sahu', phone: '9893302783' };
const SONU = { id: 'd2', name: 'Sonu Verma', phone: '9425212345' };
const drvDb = (d) => env.authenticatedContext(`driver-${d.phone}`, { role: 'driver', driverPhone: d.phone, driverId: d.id }).firestore();
const seedDriversRB = () =>
  env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'drivers', 'd1'), { ...RAJU, city: 'Raipur', status: 'active' });
    await setDoc(doc(db, 'drivers', 'd2'), { ...SONU, city: 'Bhilai', status: 'active' });
  });
const seedAs = (path, data) => env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), ...path.split('/')), data));
const offerDoc = (extra = {}) => ({
  bookingId: 'b1', ref: 'DB-1042', city: 'Raipur', package: '3-hours-600', when: '', area: 'Shankar Nagar',
  to: '', price: 600, cutPercent: 25, driverPay: 450, status: 'open', takenBy: null, takenAt: null,
  done: false, paid: false, paidAt: null, createdAt: new Date(), updatedAt: new Date(), by: 'robot', ...extra,
});

describe('bookings — the customer accepts the trip price (2)', () => {
  const trip = { to: 'Nagpur', destId: 'nagpur', kind: 'one-way', km: 284, days: 1, returnHours: 6, estFrom: 1440, estTo: 1600 };
  const accept = (db, extra = {}) => updateDoc(doc(db, 'bookings', 't1'), { acceptedPrice: { amount: 1600, at: serverTimestamp(), ...extra } });

  beforeEach(() => seedBooking('t1', { package: 'one-way-drop', trip, customerUid: 'cust1' }));

  test('the customer who made it accepts the estimate once, at the server time', async () => {
    await assertSucceeds(accept(customer('cust1')));
    // Only once.
    await assertFails(updateDoc(doc(customer('cust1'), 'bookings', 't1'), { acceptedPrice: { amount: 1600, at: serverTimestamp() } }));
  });

  test('also while confirmed; not once a driver is on it, completed or cancelled', async () => {
    await seedBooking('t1', { package: 'one-way-drop', trip, customerUid: 'cust1', status: 'confirmed' });
    await assertSucceeds(accept(customer('cust1')));
    for (const status of ['assigned', 'completed', 'cancelled']) {
      await seedBooking('t1', { package: 'one-way-drop', trip, customerUid: 'cust1', status });
      await assertFails(accept(customer('cust1')));
    }
  });

  test('nobody else, no other amount, nothing else with it', async () => {
    await assertFails(accept(customer('cust2')));
    await assertFails(accept(guest()));
    await assertFails(accept(admin())); // the office saves a quote instead
    await assertFails(accept(drvDb(RAJU)));
    await assertFails(accept(customer('cust1'), { amount: 1440 })); // only the estimate shown
    await assertFails(accept(customer('cust1'), { amount: '1600' }));
    await assertFails(accept(customer('cust1'), { at: new Date() }));
    await assertFails(accept(customer('cust1'), { note: 'ok' }));
    await assertFails(updateDoc(doc(customer('cust1'), 'bookings', 't1'), { acceptedPrice: { amount: 1600 } }));
    await assertFails(updateDoc(doc(customer('cust1'), 'bookings', 't1'), { acceptedPrice: { amount: 1600, at: serverTimestamp() }, status: 'confirmed' }));
    await assertFails(updateDoc(doc(customer('cust1'), 'bookings', 't1'), { acceptedPrice: 1600 }));
  });

  test('only a booking with an estimate', async () => {
    await seedBooking('t1', { customerUid: 'cust1' }); // 3 hours: no trip
    await assertFails(accept(customer('cust1')));
    await seedBooking('t1', { package: 'one-way-drop', trip: { ...trip, estFrom: 0, estTo: 0 }, customerUid: 'cust1' });
    await assertFails(updateDoc(doc(customer('cust1'), 'bookings', 't1'), { acceptedPrice: { amount: 0, at: serverTimestamp() } }));
  });
});

describe("driver app — can't make it (3)", () => {
  const giveBack = (db, who, { booking = {}, offer = {} } = {}) =>
    runTransaction(db, async (tx) => {
      const ref = doc(db, 'offers', 'b1');
      await tx.get(ref);
      tx.update(ref, { status: 'released', updatedAt: serverTimestamp(), ...offer });
      tx.update(doc(db, 'bookings', 'b1'), { status: 'confirmed', assignedDriver: null, updatedAt: serverTimestamp(), updatedBy: `driver-${who.phone}`, ...booking });
    });

  beforeEach(async () => {
    await seedDriversRB();
    await seedBooking('b1', { status: 'assigned', assignedDriver: RAJU, customerUid: 'cust1' });
    await seedAs('offers/b1', offerDoc({ status: 'taken', takenBy: RAJU, takenAt: new Date() }));
  });

  test('the driver who took it gives it back before Start: offer released, booking back to confirmed', async () => {
    await assertSucceeds(giveBack(drvDb(RAJU), RAJU));
    const after = await env.withSecurityRulesDisabled(async (ctx) => ({
      b: (await getDoc(doc(ctx.firestore(), 'bookings', 'b1'))).data(),
      o: (await getDoc(doc(ctx.firestore(), 'offers', 'b1'))).data(),
    }));
    assert.equal(after.b.status, 'confirmed');
    assert.equal(after.b.assignedDriver, null);
    assert.equal(after.o.status, 'released');
  });

  test('also with Start not yet tapped but the taps document missing fields', async () => {
    await seedAs('tripTaps/b1', { driverPhone: RAJU.phone });
    await assertSucceeds(giveBack(drvDb(RAJU), RAJU));
  });

  test('not after he tapped Start', async () => {
    await seedAs('tripTaps/b1', { driverPhone: RAJU.phone, leftAt: new Date() });
    await assertFails(giveBack(drvDb(RAJU), RAJU));
  });

  test('not for someone else, and only both halves together', async () => {
    await assertFails(giveBack(drvDb(SONU), SONU));
    await assertFails(giveBack(customer('cust1'), { phone: 'cust1' }));
    const db = drvDb(RAJU);
    await assertFails(updateDoc(doc(db, 'offers', 'b1'), { status: 'released', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db, 'bookings', 'b1'), { status: 'confirmed', assignedDriver: null, updatedAt: serverTimestamp(), updatedBy: `driver-${RAJU.phone}` }));
    // Back to "new", to someone else, or with anything else changed: refused.
    await assertFails(giveBack(db, RAJU, { booking: { status: 'new' } }));
    await assertFails(giveBack(db, RAJU, { booking: { assignedDriver: SONU } }));
    await assertFails(giveBack(db, RAJU, { offer: { takenBy: null } }));
    await assertFails(giveBack(db, RAJU, { offer: { status: 'withdrawn' } }));
  });

  test('a job already marked done cannot be given back', async () => {
    await seedAs('offers/b1', offerDoc({ status: 'taken', takenBy: RAJU, takenAt: new Date(), done: true }));
    await assertFails(giveBack(drvDb(RAJU), RAJU));
  });

  test('an admin can still post the released offer again (status released is a valid offer)', async () => {
    await giveBack(drvDb(RAJU), RAJU);
    await assertSucceeds(updateDoc(doc(admin(), 'offers', 'b1'), { status: 'open', takenBy: null, takenAt: null, cities: ['Raipur'], updatedAt: serverTimestamp(), by: 'admin1' }));
  });
});

describe('trip taps — Start, Arrived, Job done, Reached home (5)', () => {
  const ref = (db, id = 'b1') => doc(db, 'tripTaps', id);
  const start = (db, id = 'b1', extra = {}) => setDoc(ref(db, id), { driverPhone: RAJU.phone, leftAt: serverTimestamp(), ...extra });
  const tap = (db, field, id = 'b1') => updateDoc(ref(db, id), { [field]: serverTimestamp() });

  beforeEach(async () => {
    await seedBooking('b1', { status: 'assigned', assignedDriver: RAJU, customerUid: 'cust1' });
    await seedBooking('t1', { status: 'assigned', assignedDriver: RAJU, package: 'one-way-drop' });
  });

  test('the assigned driver taps each step once, in order, at the server time', async () => {
    const db = drvDb(RAJU);
    await assertSucceeds(start(db));
    await assertFails(tap(db, 'leftAt')); // once
    await assertFails(tap(db, 'doneAt')); // Arrived first
    await assertSucceeds(tap(db, 'arrivedAt'));
    await assertFails(tap(db, 'arrivedAt'));
    await assertSucceeds(tap(db, 'doneAt'));
    await assertFails(tap(db, 'homeAt')); // only one-way drops get home
    await assertSucceeds(getDoc(ref(db)));
  });

  test('a one-way drop ends with Reached home', async () => {
    const db = drvDb(RAJU);
    await assertSucceeds(start(db, 't1'));
    await assertFails(tap(db, 'homeAt', 't1'));
    await assertSucceeds(tap(db, 'arrivedAt', 't1'));
    await assertSucceeds(tap(db, 'doneAt', 't1'));
    await assertSucceeds(tap(db, 'homeAt', 't1'));
    await assertFails(tap(db, 'homeAt', 't1'));
  });

  test('no picking his own time, no other shape, no two steps at once', async () => {
    const db = drvDb(RAJU);
    await assertFails(start(db, 'b1', { leftAt: new Date() }));
    await assertFails(start(db, 'b1', { driverPhone: SONU.phone }));
    await assertFails(start(db, 'b1', { arrivedAt: serverTimestamp() }));
    await assertFails(setDoc(ref(db), { driverPhone: RAJU.phone, arrivedAt: serverTimestamp() }));
    await assertFails(setDoc(ref(db), { leftAt: serverTimestamp() }));
    await start(db);
    await assertFails(updateDoc(ref(db), { arrivedAt: new Date() }));
    await assertFails(updateDoc(ref(db), { arrivedAt: serverTimestamp(), doneAt: serverTimestamp() }));
    await assertFails(updateDoc(ref(db), { arrivedAt: serverTimestamp(), note: 'x' }));
    await assertFails(updateDoc(ref(db), { driverPhone: SONU.phone }));
    await assertFails(deleteDoc(ref(db)));
  });

  test('only on his current job; nobody else taps; customers and other drivers cannot read it', async () => {
    await seedBooking('other', { status: 'assigned', assignedDriver: SONU });
    await seedBooking('done', { status: 'completed', assignedDriver: RAJU });
    const db = drvDb(RAJU);
    await assertFails(start(db, 'other'));
    await assertFails(start(db, 'done'));
    await assertFails(start(db, 'nobooking'));
    await assertFails(start(customer('cust1')));
    await assertFails(start(admin()));
    await start(db);
    await assertSucceeds(getDoc(ref(admin())));
    await assertFails(getDoc(ref(customer('cust1'))));
    await assertFails(getDoc(ref(drvDb(SONU))));
    await assertFails(getDoc(ref(guest())));
    // He can look before his first tap (nothing there yet).
    await assertSucceeds(getDoc(ref(db, 't1')));
  });

  test('after the job is completed he still sees his taps, but taps no more', async () => {
    const db = drvDb(RAJU);
    await start(db);
    await tap(db, 'arrivedAt');
    await seedBooking('b1', { status: 'completed', assignedDriver: RAJU, customerUid: 'cust1' });
    await assertSucceeds(getDoc(ref(db)));
    await assertFails(tap(db, 'doneAt'));
  });
});

describe('ratings (7)', () => {
  const rating = (extra = {}) => ({ stars: 5, comment: 'Very polite', driverId: 'd1', customerUid: 'cust1', at: serverTimestamp(), ...extra });
  const rate = (db, extra) => setDoc(doc(db, 'ratings', 'b1'), rating(extra));

  beforeEach(() => seedBooking('b1', { status: 'completed', assignedDriver: RAJU, customerUid: 'cust1' }));

  test('the customer rates the driver of a completed job, once; never changed or deleted', async () => {
    await assertSucceeds(rate(customer('cust1')));
    await assertFails(rate(customer('cust1'), { stars: 1 }));
    await assertFails(updateDoc(doc(customer('cust1'), 'ratings', 'b1'), { stars: 1 }));
    await assertFails(deleteDoc(doc(customer('cust1'), 'ratings', 'b1')));
    await assertFails(deleteDoc(doc(admin(), 'ratings', 'b1')));
    await assertSucceeds(getDoc(doc(admin(), 'ratings', 'b1')));
    await assertSucceeds(getDoc(doc(customer('cust1'), 'ratings', 'b1')));
    await assertFails(getDoc(doc(customer('cust2'), 'ratings', 'b1')));
    await assertFails(getDoc(doc(drvDb(RAJU), 'ratings', 'b1')));
    await assertFails(getDoc(doc(guest(), 'ratings', 'b1')));
  });

  test('a comment is optional, up to 300 characters', async () => {
    await assertSucceeds(rate(customer('cust1'), { stars: 3, comment: '' }));
  });

  test('1 to 5 whole stars, his own name, the right driver, the server time, nothing else', async () => {
    const db = customer('cust1');
    for (const stars of [0, 6, 4.5, '5']) await assertFails(rate(db, { stars }));
    await assertFails(rate(db, { comment: 'x'.repeat(301) }));
    await assertFails(rate(db, { driverId: 'd2' }));
    await assertFails(rate(db, { customerUid: 'cust2' }));
    await assertFails(rate(db, { at: new Date() }));
    await assertFails(rate(db, { tip: 50 }));
    const { comment, ...noComment } = rating();
    await assertFails(setDoc(doc(db, 'ratings', 'b1'), noComment));
  });

  test('not by anyone else, not before the job is completed', async () => {
    await assertFails(rate(customer('cust2'), { customerUid: 'cust2' }));
    await assertFails(rate(guest()));
    await assertFails(rate(admin(), { customerUid: 'admin1' }));
    for (const status of ['confirmed', 'assigned', 'cancelled']) {
      await seedBooking('b1', { status, assignedDriver: RAJU, customerUid: 'cust1' });
      await assertFails(rate(customer('cust1')));
    }
    await seedBooking('b1', { status: 'completed', customerUid: 'cust1' }); // no driver on it
    await assertFails(rate(customer('cust1')));
    await assertFails(setDoc(doc(customer('cust1'), 'ratings', 'nobooking'), rating()));
  });
});

describe('drivers — his UPI ID; ratings and strikes are the robot’s (8, 10)', () => {
  const upi = (db, value, extra = {}) => updateDoc(doc(db, 'drivers', 'd1'), { upi: value, ...extra });

  beforeEach(seedDriversRB);

  test('the driver sets and changes his own UPI ID', async () => {
    const db = drvDb(RAJU);
    await assertSucceeds(upi(db, 'raju@okaxis'));
    await assertSucceeds(upi(db, 'raju.sahu-91_x@ybl'));
    await assertSucceeds(upi(db, '9893302783@paytm', { updatedAt: serverTimestamp() }));
  });

  test('only a UPI-shaped ID, only his own record, nothing else on it', async () => {
    const db = drvDb(RAJU);
    for (const bad of ['raju', 'raju@', '@okaxis', 'r@okaxis', 'raju@ok1', 'raju@okaxis.com', 'raju sahu@okaxis', 'raju@o', 42, ''])
      await assertFails(upi(db, bad));
    await assertFails(upi(db, 'raju@okaxis', { updatedAt: new Date() }));
    await assertFails(upi(db, 'raju@okaxis', { name: 'Raju S' }));
    await assertFails(upi(db, 'raju@okaxis', { status: 'inactive' }));
    await assertFails(upi(db, 'raju@okaxis', { strikes: 0 }));
    await assertFails(updateDoc(doc(drvDb(SONU), 'drivers', 'd1'), { upi: 'sonu@okaxis' }));
    await assertFails(upi(customer(), 'raju@okaxis'));
    // His login must match his record's number.
    const wrongPhone = env.authenticatedContext('driver-9000000000', { role: 'driver', driverPhone: '9000000000', driverId: 'd1' }).firestore();
    await assertFails(upi(wrongPhone, 'raju@okaxis'));
  });

  test('nobody but the robot writes ratingAvg, ratingCount or strikes — not the driver, not an admin', async () => {
    const db = drvDb(RAJU);
    await assertFails(updateDoc(doc(db, 'drivers', 'd1'), { ratingAvg: 5 }));
    await assertFails(updateDoc(doc(db, 'drivers', 'd1'), { strikes: 0 }));
    const stamp = { updatedAt: serverTimestamp(), updatedBy: 'admin1' };
    await assertFails(updateDoc(doc(admin(), 'drivers', 'd1'), { ratingAvg: 5, ratingCount: 1, ...stamp }));
    await assertFails(updateDoc(doc(admin(), 'drivers', 'd1'), { strikes: 0, ...stamp }));
    await assertSucceeds(updateDoc(doc(admin(), 'drivers', 'd1'), { status: 'inactive', ...stamp }));
  });
});

describe('offers — nearby cities (12)', () => {
  const take = (db, who) =>
    runTransaction(db, async (tx) => {
      const ref = doc(db, 'offers', 'b1');
      const snap = await tx.get(ref);
      if (snap.data()?.status !== 'open') throw new Error('gone');
      tx.update(ref, { status: 'taken', takenBy: who, takenAt: serverTimestamp(), updatedAt: serverTimestamp() });
      tx.update(doc(db, 'bookings', 'b1'), { status: 'assigned', assignedDriver: who, updatedAt: serverTimestamp(), updatedBy: `driver-${who.phone}` });
    });
  const adminOffer = (extra = {}) => offerDoc({ createdAt: serverTimestamp(), updatedAt: serverTimestamp(), by: 'admin1', ...extra });
  const byCities = (db, city) => getDocs(query(collection(db, 'offers'), where('status', '==', 'open'), where('cities', 'array-contains', city)));

  beforeEach(async () => {
    await seedDriversRB();
    await seedBooking('b1', { status: 'confirmed', customerUid: 'cust1' });
  });

  test('widened by the robot: a Bhilai driver sees it (the app asks by cities) and can take it', async () => {
    await seedAs('offers/b1', offerDoc({ cities: ['Raipur', 'Bhilai', 'Durg'] }));
    const snap = await assertSucceeds(byCities(drvDb(SONU), 'Bhilai'));
    assert.deepEqual(snap.docs.map((d) => d.id), ['b1']);
    await assertSucceeds(getDoc(doc(drvDb(SONU), 'offers', 'b1')));
    await assertSucceeds(byCities(drvDb(RAJU), 'Raipur'));
    await assertSucceeds(take(drvDb(SONU), SONU));
  });

  test('its own city only: a Bhilai driver neither sees nor takes it', async () => {
    await seedAs('offers/b1', offerDoc({ cities: ['Raipur'] }));
    // His own city's list is allowed — and does not have it.
    const mine = await assertSucceeds(byCities(drvDb(SONU), 'Bhilai'));
    assert.equal(mine.size, 0);
    await assertFails(getDoc(doc(drvDb(SONU), 'offers', 'b1')));
    await assertFails(take(drvDb(SONU), SONU));
    // Asking for another city's offers is refused, too.
    await assertFails(byCities(drvDb(SONU), 'Raipur'));
    await assertSucceeds(take(drvDb(RAJU), RAJU));
  });

  test('an older offer without cities still works by its city', async () => {
    await seedAs('offers/b1', offerDoc());
    await assertSucceeds(getDocs(query(collection(drvDb(RAJU), 'offers'), where('status', '==', 'open'), where('city', '==', 'Raipur'))));
    await assertFails(getDoc(doc(drvDb(SONU), 'offers', 'b1')));
    await assertSucceeds(take(drvDb(RAJU), RAJU));
  });

  test('an admin posts with its own city only; cities are served cities with its own among them', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'offers', 'b1'), adminOffer({ cities: ['Raipur'] })));
    await seedBooking('b2', { status: 'confirmed' });
    const post = (extra) => setDoc(doc(admin(), 'offers', 'b2'), adminOffer({ bookingId: 'b2', ...extra }));
    await assertFails(post({ cities: ['Raipur', 'Bhilai'] })); // widening is the robot's, when nobody takes it
    await assertFails(post({ cities: ['Bhilai'] }));
    await assertFails(post({ cities: 'Raipur' }));
    await assertSucceeds(post({}));
    const patch = (cities) => updateDoc(doc(admin(), 'offers', 'b2'), { cities, updatedAt: serverTimestamp(), by: 'admin1' });
    await assertSucceeds(patch(['Raipur', 'Durg']));
    await assertFails(patch(['Durg']));
    await assertFails(patch(['Raipur', 'Mumbai']));
    await assertFails(patch([]));
    await assertFails(patch(['Raipur', 'Bhilai', 'Durg', 'Bilaspur', 'Raipur']));
  });

  test('a driver cannot widen an offer himself', async () => {
    await seedAs('offers/b1', offerDoc({ cities: ['Raipur'] }));
    await assertFails(updateDoc(doc(drvDb(RAJU), 'offers', 'b1'), { cities: ['Raipur', 'Bhilai'], updatedAt: serverTimestamp() }));
  });
});

describe("the robot's own notes", () => {
  test('offerAlerts and reminders are closed to every browser', async () => {
    await seedAs('reminders/b1', { remindedAt: new Date() });
    await seedAs('offerAlerts/b1', { stage: 1 });
    for (const db of [admin(), customer(), drvDb(RAJU), guest()]) {
      await assertFails(getDoc(doc(db, 'reminders', 'b1')));
      await assertFails(getDoc(doc(db, 'offerAlerts', 'b1')));
      await assertFails(setDoc(doc(db, 'reminders', 'b2'), { remindedAt: new Date() }));
    }
  });
});
