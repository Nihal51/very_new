# DriveBuddy bookings system

How a booking travels from a customer's phone to a driver, and how to set it up.

## The design in one picture

```
 Customer's browser                     Google Cloud (Firebase project drive-buddy-acc4c)
 ─────────────────                      ──────────────────────────────────────────────────
 Booking form ── create ──────────────▶ Firestore  bookings/{id}   status: new
   (guest, or logged in:                    │
    phone OTP / Google)                     │ onBookingCreated (Cloud Function, asia-south1)
                                            ├─▶ numbers it DB-1042 (meta/counters, in a transaction)
 /account  ◀── reads own bookings ──────    ├─▶ upserts customers/{phone}  (count, first/last booking)
                                            ├─▶ writes timeline bookings/{id}/events
                                            └─▶ Telegram message + email   ──▶ your phone
 /admin (admin Google account)
   live list ◀─────────── onSnapshot ───  bookings, drivers, customers
   Confirm / Assign driver / Complete ──▶ booking update + timeline event (one atomic batch)

                                          remindUnhandled (every 10 min): a booking still "new"
                                          after 10 minutes → one more Telegram nudge
```

The website is still a static site on GitHub Pages. There is no server to keep
running: Firestore stores the data, and the Cloud Functions run only when a
booking or application arrives. Alerts go out even when every laptop and
browser is closed.

## Data model

| Collection | One document per | Written by | Read by |
|---|---|---|---|
| `bookings/{id}` | booking | customer (create), server (ref, number, alerts), admin (status, driver) | admin; the customer who made it while logged in |
| `bookings/{id}/events/{id}` | change or internal note | server, admin | admin only |
| `drivers/{id}` | driver application | applicant (create), admin (status, note) | admin |
| `customers/{phone}` | customer (by mobile number) | server only | admin |
| `users/{uid}` | login account | that customer | that customer, admin |
| `meta/counters` | — | server only | nobody from a browser |

**Booking lifecycle:** `new → confirmed → assigned → completed`, or `cancelled` from any open state.
Completed and cancelled bookings can be reopened.
**Driver lifecycle:** `new (applied) → verified → active ⇄ inactive`, or `rejected`.
Only `active` drivers can be assigned to bookings.

Design choices, and why:

- **Bookings are never deleted**, only cancelled, so history and reporting stay complete.
- **Customer records are keyed by phone number**, so five guest bookings from one person are one customer.
- **Internal notes live in the admin-only timeline**, never on the booking, because a logged-in customer can read their own booking document.
- **Admin access is a custom claim** granted by the `claimAdmin` function to the emails in the `ADMIN_EMAILS` secret. No admin email appears in the code or the rules.
- **Every status change and its timeline entry are one batch**, so the history can never disagree with the booking.
- **Reference numbers come from a transaction** on `meta/counters`, so two bookings in the same second can never share a number, and a retried function never numbers or alerts the same booking twice.

Security is enforced in `firestore.rules`, and `tests/rules/rules.test.mjs` checks each role against them (`npm run test:rules`, needs Java).

## One-time setup (about 20 minutes)

1. **Blaze plan.** Firebase console → project drive-buddy-acc4c → ⚙ Usage and billing → Modify plan → Blaze. Add your card. Then Google Cloud console → Billing → Budgets & alerts → create a ₹100 monthly budget with email alerts at 50%, 90% and 100%. At DriveBuddy's volume, functions, Firestore and Secret Manager stay inside the free allowance.
2. **Turn on login.** Firebase console → Authentication → Get started → Sign-in method: enable **Phone** and **Google**. Then Authentication → Settings → Authorized domains → add `thedrivebuddy.in`.
3. **Log the CLI in** (once per computer): `npx firebase-tools login`
4. **Alerts and admins:** `npm run setup:alerts`. It walks you through creating the Telegram bot, finds your chat automatically, sends a test message, takes the Gmail app password (optional) and the admin email(s), and saves them as secrets.
5. **Deploy:** `npm run deploy:backend`. This deploys the security rules, indexes and the four functions. The first deploy takes a few minutes and may ask to enable some Google APIs; answer yes.
6. **Push the website:** `git push`. Then open https://thedrivebuddy.in/admin/, sign in with the admin Google account, and make a test booking from your phone.

If the deploy says the functions region does not match the database location,
set `FUNCTIONS_REGION` in `functions/.env` to the location shown in Firestore → Settings,
and `FUNCTIONS_REGION` in `lib/firebase.ts` to the same value.

## Everyday use

- **New booking:** Telegram buzzes (plus email). Tap *Open in admin panel* or call the number in the message.
- In `/admin`: **Confirm – I called them**, then **Assign driver**, then **Mark completed** after the trip.
- A booking left "New" for 10 minutes sends one reminder to Telegram.
- **New driver application:** Telegram alert. In the Drivers tab: Verify (after ID and police check), then Activate.
- `npm run inbox` and `npm run leads` still work for Excel exports.

## Costs to know

- **Phone OTP:** Google charges per SMS sent, on the Blaze plan. Google sign-in is free.
- **Telegram:** free.
- **Email:** free (Gmail).
- **Cloud Functions, Firestore, Secret Manager, Scheduler:** within the free tier at current volume. The budget alert warns you long before anything is significant.
