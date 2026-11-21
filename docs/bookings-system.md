# DriveBuddy bookings system

How a booking travels from a customer's phone to a driver, and how to set it up.
**Running cost: ₹0. No card needed.** Everything runs on free Google services.

## The design in one picture

```
 Customer's browser                   Firebase (free Spark plan)         Google Apps Script (free)
 ─────────────────                    ──────────────────────────         ─────────────────────────
 Booking form ── create ───────────▶ Firestore bookings/{id}  ◀── every minute ──  alerts robot
   (guest, or logged in                status: new                       (apps-script/Code.js,
    with Google)                                                          inside the Google Sheet
                                                                          "DriveBuddy Bookings")
 /account ◀── own bookings ───────    customers/{phone}  ◀─────────────  • numbers it DB-1042
                                      bookings/{id}/events ◀───────────  • customer record + timeline
 /admin (admin Google account)                                           • Telegram + email alert
   live list ◀── onSnapshot ───────   bookings, drivers, customers       • adds a row to the Sheet
   Confirm / Assign / Complete ────▶  update + timeline (one batch)      • reminder if still "New"
                                                                           after 10 minutes
```

- The website stays a static site on GitHub Pages (free).
- Firestore stores everything (free up to 50,000 reads and 20,000 writes a day; DriveBuddy uses a few thousand).
- The alerts robot is a Google Apps Script attached to a Google Sheet. It runs on Google's servers every minute, so alerts arrive **within a minute even when every laptop and phone is off**. It also writes each booking into the Sheet, so you can read them like Excel.
- Apps Script on a normal Gmail account allows 90 minutes of automatic runs a day and 100 emails a day. The robot uses roughly 30 minutes a day and one email per booking.

## Data model

| Collection | One document per | Written by | Read by |
|---|---|---|---|
| `bookings/{id}` | booking | customer, on the website or in the app (create, `source` = `website` / `app`), robot (ref, alerts, what the customer was told), admin (status, driver, agreed price) | admin; the customer who made it while logged in |
| `bookings/{id}/events/{id}` | change or internal note | robot, admin | admin only |
| `drivers/{id}` | driver application | applicant (create), admin (status, note) | admin |
| `customers/{phone}` | customer, by mobile number | robot only | admin |
| `users/{uid}` | login account | that customer | that customer, admin |
| `users/{uid}/devices/{id}` | phone with the DriveBuddy app and notifications on | the app (push token + language) | that customer; the robot |
| `admins/{email}` | admin Google account | robot's `setup` (or the Firebase console) | that admin, to check their own access |
| `meta/counters` | — | robot only | nobody from a browser |
| `offers/{bookingId}` | job offered to drivers | admin, robot; the driver who takes it or gives it back | admin; Active drivers of the cities in `cities` (open offers); the driver who took it |
| `tripTaps/{bookingId}` | job a driver is on | the assigned driver (Start, Arrived, Job done, Reached home) | admin, that driver |
| `ratings/{bookingId}` | completed job the customer rated | that customer (once) | admin, that customer |
| `reminders/{bookingId}`, `offerAlerts/{bookingId}` | the robot's own notes (reminders, payment, rating request; who was alerted) | robot only | nobody from a browser |

**Booking lifecycle:** `new → confirmed → assigned → completed`, or `cancelled` from any open state. Completed and cancelled bookings can be reopened.
**Driver lifecycle:** `new (applied) → verified → active ⇄ inactive`, or `rejected`. Only `active` drivers can be assigned.

Design choices, and why:

- **Bookings are never deleted**, only cancelled, so the history stays complete.
- **One customer record per phone number**, so five guest bookings from one person are one customer.
- **Internal notes live in the admin-only timeline**, never on the booking, because a logged-in customer can read their own booking. The same goes for prices: the booking holds only what the customer pays (`quote`); the driver's cost and the profit go in the timeline.
- **Outstation trips and one-way drops carry a `trip`** (destination, km, days, return days and the estimate the customer saw). See [outstation-pricing.md](outstation-pricing.md).
- **Admin access is an entry in `admins/`**, created from the robot's `ADMIN_EMAILS` property. No email address is written in the code or the rules.
- **Each change and its timeline entry are saved together** (one batch from the admin panel, one commit from the robot), so the history can never disagree with the booking.
- **The robot runs under a lock** and only numbers bookings that have no number yet, so a booking is never numbered or alerted twice.

`firestore.rules` enforces all of this. `tests/rules/rules.test.mjs` checks every role against it (`npm run test:rules`, needs Java). `scripts/alerts-script.test.mjs` runs the robot against a simulated Firestore (`npm test`).

## One-time setup (about 20 minutes)

Use the Google account that **owns the Firebase project** (Firebase console → ⚙ Project settings → Users and permissions → Owner).

**1. Turn on Google login (free).** Firebase console → Authentication → Get started → Sign-in method → **Google** → Enable → Save. Then Authentication → Settings → Authorized domains → Add domain → `thedrivebuddy.in`.

**2. Make your Telegram bot.** In Telegram, open **@BotFather**, send `/newbot`, choose a name (e.g. *DriveBuddy Alerts*) and a username ending in `bot`. Copy the token it gives you (looks like `123456:ABC-xyz`). Then open your new bot, press **START** and send `hi`.

**3. Create the alerts robot** (with the Firebase owner account).
1. Go to https://sheets.new and name the sheet **DriveBuddy Bookings**.
2. Extensions → **Apps Script**. Click *Untitled project* at the top and rename it **DriveBuddy**. Delete the sample code. Open `apps-script\Code.js` from this repo in Notepad, copy everything, and paste it in.
3. ⚙ Project Settings → tick **Show "appsscript.json" manifest file in editor**. Back in the editor, open `appsscript.json` and replace its contents with `apps-script\appsscript.json` from this repo. Save (Ctrl+S).
4. Reload the Sheet. A **DriveBuddy** menu appears → **Connect Telegram and start**. Google asks for permission: choose your account → *Advanced* → *Go to DriveBuddy (unsafe)*: it is your own script → Allow. Run the menu item again, paste the bot token from step 2, OK.
5. You get "All set ✅", Telegram gets "DriveBuddy alerts are connected", and the Sheet fills with every booking so far.

Optional script properties (⚙ Project Settings → Script properties): `ADMIN_EMAILS` (who can open `/admin`; default: the account that owns the script; several allowed, comma-separated — run the menu item again after changing it) and `ALERT_EMAIL` (where alert emails go; `none` turns email off).

**4. Publish the security rules.** Firebase console → Firestore Database → **Rules** → replace everything with the contents of `firestore.rules` → **Publish**. (Or from `C:\git\drivebuddy`: `npx firebase-tools login` then `npm run deploy:backend`.) No indexes are needed: every query is on one field.

**5. Publish the website:** `git push`. Then open https://thedrivebuddy.in/admin/, sign in with the admin Google account, and make a test booking from your phone. It should reach Telegram and the Sheet within a minute.

### If setup shows an error

- **"Firestore 403 … permission"**: the script is running under a Google account that is not an Owner of the Firebase project. Use the owner account, or add this account as Owner in Firebase → Users and permissions.
- **"No Telegram chat found"**: open the bot, press START, send `hi`, and run **Connect Telegram and start** again.
- **A row in the Sheet looks wrong, or you deleted rows**: DriveBuddy menu → **Refresh the whole sheet**.

## Customer updates

When you move a booking along in `/admin`, the customer hears about it:

- **In the DriveBuddy app** (customers logged in on the app): a phone notification for *Confirmed*, *Driver assigned* (with the driver's name), *Completed* and *Cancelled*, in the language they use in the app. Tapping it opens that booking. The robot sends these within a minute through Expo's free push service; nothing to set up here.
- **On WhatsApp, one tap (free, works now):** open the booking in `/admin` after assigning a driver → **Tell the customer their driver is coming** → *English* or *हिंदी*. WhatsApp opens with the driver's name, number, trip time and pickup typed in; press Send.
- **On WhatsApp, automatic (optional, paid per message):** the robot sends the same details by itself the moment you assign a driver. Off until you set up the WhatsApp Business API: see [whatsapp.md](whatsapp.md).

Each booking remembers what the customer was last told (`pushedKey`, `whatsappKey`), so nothing is sent twice; assigning a different driver tells them again.

**After changing `apps-script/Code.js`** (as in this update), paste the new file into the Sheet's Apps Script editor (Extensions → Apps Script → select all in `Code.js` → paste → Save). The every-minute trigger keeps running.

If the change is in the web address part (the doorbell or the train lookup, `doGet`), the address keeps serving the old version until you deploy a new one: **Deploy → Manage deployments → ✏ (edit) → Version: New version → Deploy**. The address stays the same, so nothing on the website changes. (The automatic deploy in docs/automatic-deploys.md pushes the code but does not do this step.)

## Automation: what the robot does by itself

The Driver and Customer apps and the robot now handle the simple jobs without a call:

1. **Instant booking.** A booking from a logged-in customer for *1 hour* or *3 hours*, or a trip whose estimate the customer accepted in the app (**Accept price**), is confirmed by the robot within a minute ("auto-confirmed" in Telegram, "Confirmed automatically" in the history) and offered to drivers as usual. Hospital / emergency bookings are always a call. Script property `INSTANT_BOOKINGS` = `off` stops it.
2. **Can't make it.** A driver can give back a job he took, until he taps Start. The robot offers it again from the start (never to him) and adds a strike to his record (Drivers tab: *Jobs given back*).
3. **Reminders.** An hour before the trip time, the customer ("Your driver Raju arrives at 3:30 pm") and the driver ("Job at 3:30 pm · Shankar Nagar") get one notification.
4. **Trip taps.** The driver taps **Start → Arrived → Job done** (one-way drops: **→ Reached home**) in the Driver app. For outstation trips and one-way drops the times go to the booking's clock and Telegram, as with the trip link; you still save the final bill. For local jobs (1 hour, 3 hours, full day, night) **Job done** makes the bill — the package price plus each hour over it after 15 minutes' grace, at `prices.localExtraHour` in `site-settings.ts` — and completes the booking.
5. **Payment link (optional).** With `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` set, a completed job with a bill gets a Razorpay payment link by SMS; the app shows **Pay** / **Paid ✓**, and the robot checks every 5 minutes. Without the keys nothing happens.
6. **Ratings.** After the job (and the payment, when payments are on) the customer is asked once to rate the driver. Ratings make the driver's average in the Drivers tab; a 5-star customer is invited to review you on Google. Drivers rated below 4 (3+ ratings) or with 3+ jobs given back get new jobs after the others. Below 3.5 with 5+ ratings, Telegram asks whether to pause him — the robot never does that itself.
7. **Payouts.** Mondays around 9:30, Telegram lists each driver to pay (total, UPI ID he set in the app, jobs) with a **Paid ✓** button. Press it after paying: his jobs are marked paid. Only presses in your own chat count.
8. **9 pm report.** Today's bookings, revenue, DriveBuddy's cut, jobs nobody took, drivers online and payouts due.
9. **Nearby cities.** An automatic offer nobody takes 10 minutes after its pay reached the top goes to Bhilai and Durg drivers too (for Raipur; and the other way round), and the customer hears "Still finding your driver".

After pasting the new `Code.js`, nothing else is needed: the Monday and 9 pm triggers set themselves up on the next minute's run (or run **Connect Telegram and start** again). Publish the new `firestore.rules` at the same time as the apps that use them.

## Everyday use

- **New booking:** Telegram buzzes (plus email, plus a new row in the Sheet). Tap *Open in admin panel*, or call the number in the message.
- In `/admin` the top tiles are shortcuts (*New – call now*, *Needs action*, *Booked today*). The table works like a spreadsheet: filter by status, city and date, search, click a column heading to sort, click a row for details. The **Next step** button on each row does the usual move in one click: **Confirm** → **Assign driver** → **Complete**. **Excel** downloads exactly the rows you are looking at.
- **The Google Sheet** is a live copy kept by the robot: newest bookings on top, a colour per status, filter buttons on every column, and a **Summary** tab (today, this week, this month, by city, by package, by month). Status and driver changes from `/admin` reach it within a minute. Add your own columns (e.g. *Paid?*) anywhere; the robot never touches them. Treat the robot's columns as read-only: change bookings in `/admin`.
- A booking left "New" for 10 minutes sends one reminder to Telegram.
- **Outstation trip or one-way drop:** the alert shows the trip and the estimate. On the call, open the booking → **Work out the price**, type what the driver costs, read out the price, **Save this price**. Details in [outstation-pricing.md](outstation-pricing.md).
- **Driver assigned:** in the booking's panel, tap **English** or **हिंदी** under *Tell the customer their driver is coming*, then Send in WhatsApp. App users also get a notification by themselves.
- **New driver application:** Telegram alert and a row in the *Drivers* sheet. In the Drivers tab: Verify (after the ID and police check) → Activate.
- To add another admin later: add the email to the `ADMIN_EMAILS` script property and run **Connect Telegram and start** again.

## Optional paid upgrades

- **Phone + SMS-code login:** Firebase charges per SMS, and it needs the Blaze plan with a card. Switch to Blaze, enable *Phone* under Authentication → Sign-in method, and set `login.phoneOtp: true` in `site-settings.ts`.
- **Alerts in seconds instead of within a minute:** Cloud Functions (Blaze). The full version is in git history, commit `1115476`.
