/**
 * DriveBuddy — server side (Cloud Functions for Firebase, 2nd gen).
 *
 * The website stays a static site that writes bookings straight to Firestore.
 * These functions run on Google's servers and react to those writes, so they work
 * when every laptop, phone and browser tab is closed:
 *
 *   onBookingCreated   new booking → reference number (DB-1042), customer record,
 *                      timeline entry, Telegram + email alert
 *   onDriverApplied    new driver application → Telegram + email alert
 *   remindUnhandled    every 10 min: a booking still "new" after 10 minutes gets
 *                      one more Telegram nudge, so nothing sits unseen
 *   claimAdmin         grants the admin panel to the emails in ADMIN_EMAILS
 *
 * Deploy:  npm run deploy:backend   (from the repo root — see docs/bookings-system.md)
 */

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { defineSecret, defineString } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import nodemailer from 'nodemailer';

import {
  bookingEmail,
  bookingRef,
  bookingTelegram,
  driverEmail,
  driverTelegram,
  reminderTelegram,
} from './lib/format.js';

initializeApp();
const db = getFirestore();

/* ------------------------------------------------------------ configuration --
   Plain settings live in functions/.env (committed). Secrets live in Google
   Secret Manager and are set once with `npm run setup:alerts`. */

const REGION = defineString('FUNCTIONS_REGION', { default: 'asia-south1' });
const SITE_URL = defineString('SITE_URL', { default: 'https://thedrivebuddy.in' });
const ALERT_EMAIL = defineString('ALERT_EMAIL', { default: 'drivebuddyind@gmail.com' });

const TELEGRAM_BOT_TOKEN = defineSecret('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = defineSecret('TELEGRAM_CHAT_ID');
/** A Gmail "app password" for ALERT_EMAIL, or the word `none` to switch email alerts off. */
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD');
/** Comma-separated Google account emails allowed into /admin. Not in the repo on purpose. */
const ADMIN_EMAILS = defineSecret('ADMIN_EMAILS');

// maxInstances caps the bill if something ever floods the forms.
setGlobalOptions({ region: REGION, maxInstances: 5, memory: '256MiB' });

/* ----------------------------------------------------------------- senders -- */

async function sendTelegram({ text, reply_markup }) {
  const token = TELEGRAM_BOT_TOKEN.value().trim();
  const chatIds = TELEGRAM_CHAT_ID.value()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!token || token === 'none' || chatIds.length === 0) return 'off';

  const results = await Promise.all(
    chatIds.map(async (chat_id) => {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', reply_markup, disable_web_page_preview: true }),
      });
      if (!res.ok) throw new Error(`Telegram ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return true;
    }),
  );
  return results.every(Boolean) ? 'sent' : 'failed';
}

let transport;
async function sendEmail({ subject, text, html }) {
  const pass = GMAIL_APP_PASSWORD.value().trim();
  if (!pass || pass === 'none') return 'off';
  transport ??= nodemailer.createTransport({
    service: 'gmail',
    auth: { user: ALERT_EMAIL.value(), pass: pass.replace(/\s+/g, '') },
  });
  await transport.sendMail({ from: `DriveBuddy Alerts <${ALERT_EMAIL.value()}>`, to: ALERT_EMAIL.value(), subject, text, html });
  return 'sent';
}

/** Run both senders; one failing never stops the other. */
async function alertAll(telegramMsg, emailMsg) {
  const [tg, em] = await Promise.allSettled([sendTelegram(telegramMsg), sendEmail(emailMsg)]);
  const status = (r, name) => {
    if (r.status === 'fulfilled') return r.value;
    logger.error(`${name} alert failed`, r.reason);
    return 'failed';
  };
  return { telegram: status(tg, 'Telegram'), email: status(em, 'Email') };
}

const ALERT_SECRETS = [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GMAIL_APP_PASSWORD];

/* ------------------------------------------------------------- new booking -- */

export const onBookingCreated = onDocumentCreated(
  { document: 'bookings/{bookingId}', secrets: ALERT_SECRETS },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const id = event.params.bookingId;
    const booking = snap.data();

    /* One transaction: next reference number, the customer record and the first
       timeline entry either all happen or none do. Retried deliveries find `ref`
       already set and stop, so a booking is never numbered — or alerted — twice. */
    const counterRef = db.doc('meta/counters');
    const customerRef = db.doc(`customers/${booking.phone}`);

    const outcome = await db.runTransaction(async (tx) => {
      const [fresh, counter, customer] = await Promise.all([
        tx.get(snap.ref),
        tx.get(counterRef),
        tx.get(customerRef),
      ]);
      if (!fresh.exists || fresh.get('ref')) return null;

      const n = (counter.get('bookings') ?? 0) + 1;
      const ref = bookingRef(n);
      const previousBookings = customer.exists ? (customer.get('bookingsCount') ?? 0) : 0;
      const createdAt = booking.createdAt ?? Timestamp.now();

      tx.set(counterRef, { bookings: n, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.update(snap.ref, {
        ref,
        number: n,
        isReturning: previousBookings > 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(
        customerRef,
        {
          phone: booking.phone,
          name: booking.name,
          city: booking.city,
          bookingsCount: FieldValue.increment(1),
          lastBookingAt: createdAt,
          lastBookingId: id,
          lastBookingRef: ref,
          lastPackage: booking.package,
          updatedAt: FieldValue.serverTimestamp(),
          ...(!customer.exists && { firstBookingAt: createdAt }),
          ...(booking.customerUid && { uids: FieldValue.arrayUnion(booking.customerUid) }),
        },
        { merge: true },
      );
      tx.create(snap.ref.collection('events').doc(), {
        type: 'created',
        from: null,
        to: 'new',
        note: 'Booking received from the website',
        by: 'system',
        at: FieldValue.serverTimestamp(),
      });
      return { ref, previousBookings };
    });

    if (!outcome) return;

    const ctx = {
      booking,
      id,
      ref: outcome.ref,
      isReturning: outcome.previousBookings > 0,
      previousBookings: outcome.previousBookings,
      siteUrl: SITE_URL.value(),
    };
    const alerts = await alertAll(bookingTelegram(ctx), bookingEmail(ctx));
    await snap.ref.update({ alerts, alertedAt: FieldValue.serverTimestamp() });
    logger.info(`Booking ${outcome.ref} processed`, { id, alerts });
  },
);

/* ------------------------------------------------------- driver application -- */

export const onDriverApplied = onDocumentCreated(
  { document: 'drivers/{driverId}', secrets: ALERT_SECRETS },
  async (event) => {
    const snap = event.data;
    if (!snap || snap.get('alerts')) return;
    const ctx = { driver: snap.data(), siteUrl: SITE_URL.value() };
    const alerts = await alertAll(driverTelegram(ctx), driverEmail(ctx));
    await snap.ref.update({ alerts, alertedAt: FieldValue.serverTimestamp() });
  },
);

/* ----------------------------------------------------- unhandled reminders -- */

export const remindUnhandled = onSchedule(
  { schedule: 'every 10 minutes', timeZone: 'Asia/Kolkata', secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID] },
  async () => {
    const cutoff = Timestamp.fromMillis(Date.now() - 10 * 60 * 1000);
    const stale = await db
      .collection('bookings')
      .where('status', '==', 'new')
      .where('createdAt', '<=', cutoff)
      .orderBy('createdAt', 'desc')
      .limit(25)
      .get();

    for (const doc of stale.docs) {
      if (doc.get('reminderSentAt')) continue;
      const minutes = Math.round((Date.now() - doc.get('createdAt').toMillis()) / 60000);
      // Only nudge about bookings from the last day; older ones are history.
      if (minutes > 24 * 60) continue;
      try {
        await sendTelegram(reminderTelegram({ booking: doc.data(), id: doc.id, minutes, siteUrl: SITE_URL.value() }));
        await doc.ref.update({ reminderSentAt: FieldValue.serverTimestamp() });
      } catch (err) {
        logger.error('Reminder failed', { id: doc.id, err });
      }
    }
  },
);

/* --------------------------------------------------------------- admin access -- */

/**
 * The admin panel calls this right after a Google sign-in. If the account's
 * verified email is in ADMIN_EMAILS, it gets the `admin` claim that
 * firestore.rules checks. Everyone else gets "permission-denied" and sees nothing.
 */
export const claimAdmin = onCall(
  { secrets: [ADMIN_EMAILS], cors: [/thedrivebuddy\.in$/, /localhost(:\d+)?$/, /127\.0\.0\.1(:\d+)?$/] },
  async (request) => {
    const token = request.auth?.token;
    if (!token) throw new HttpsError('unauthenticated', 'Sign in first.');

    const allowed = ADMIN_EMAILS.value()
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const email = String(token.email ?? '').toLowerCase();

    if (!email || token.email_verified !== true || !allowed.includes(email)) {
      logger.warn('Admin access refused', { email });
      throw new HttpsError('permission-denied', 'This account is not a DriveBuddy admin.');
    }

    if (token.admin !== true) {
      const user = await getAuth().getUser(request.auth.uid);
      await getAuth().setCustomUserClaims(request.auth.uid, { ...(user.customClaims ?? {}), admin: true });
      logger.info('Admin access granted', { email });
    }
    return { admin: true };
  },
);
