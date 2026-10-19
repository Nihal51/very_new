# Spam protection

Anyone can book without logging in — that is on purpose, it is how customers
book. The flip side: someone could send fake bookings. Three layers deal with
it, from "works today" to "switch on later".

## 1. Block a number (works today)

In `/admin`, open one of the fake bookings → bottom of the panel → **Block this
number** → a short reason → **Block**. From then on, `firestore.rules` refuses
every new booking and driver application with that number — from the website
and the app alike. Bookings it already made stay; cancel them as usual.
**Unblock** in the same place undoes it.

The list lives in Firestore `blocked/{phone}`; only admins can see it.

## 2. The flood guard (works today)

If more than 8 new bookings arrive within one minute, the alerts robot still
numbers every one of them and puts them in the Sheet and `/admin`, but sends
only the first 3 to Telegram and email one by one, plus **one** summary:
"⚠️ 15 new bookings at once — possibly spam". At most one summary every 10
minutes, so a flood can never bury your phone in notifications.

## 3. Firebase App Check (switch on later)

App Check makes Firestore accept bookings only from your real website and
your real app — not from a script that copied the website's Firebase settings.
It is the strongest layer, but it has to be switched on in the right order, or
real customers' bookings would be refused.

**Website — about 15 minutes:**

1. https://www.google.com/recaptcha/admin/create → reCAPTCHA **v3** → domains
   `thedrivebuddy.in` → Submit. Copy the **site key** and the **secret key**.
2. Firebase console → **App Check** → Apps → your web app → **reCAPTCHA** →
   paste the **secret** key → Save.
3. Put the **site key** in `.env.production`:
   `NEXT_PUBLIC_RECAPTCHA_SITE_KEY=…` → commit → the website deploys.
4. Firebase console → App Check → **APIs** → Cloud Firestore: leave it on
   **Monitor** (do not press *Enforce*). After a few days the chart shows how
   many requests are "verified".

**Enforce only when the app sends App Check tokens too.** The DriveBuddy app
needs Firebase's native modules for that (Play Integrity on Android, App
Attest on iPhone), which are added with the first phone build, when they can
be tested on a real phone. Until then, enforcing would block every booking
made in the app. Once the app version that sends tokens is what customers
have, and the App Check chart shows nearly 100 % verified requests: Firestore
→ **Enforce**.
