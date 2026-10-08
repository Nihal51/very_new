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
| `bookings/{id}` | booking | customer (create), robot (ref, alerts), admin (status, driver) | admin; the customer who made it while logged in |
| `bookings/{id}/events/{id}` | change or internal note | robot, admin | admin only |
| `drivers/{id}` | driver application | applicant (create), admin (status, note) | admin |
| `customers/{phone}` | customer, by mobile number | robot only | admin |
| `users/{uid}` | login account | that customer | that customer, admin |
| `admins/{email}` | admin Google account | robot's `setup` (or the Firebase console) | that admin, to check their own access |
| `meta/counters` | — | robot only | nobody from a browser |

**Booking lifecycle:** `new → confirmed → assigned → completed`, or `cancelled` from any open state. Completed and cancelled bookings can be reopened.
**Driver lifecycle:** `new (applied) → verified → active ⇄ inactive`, or `rejected`. Only `active` drivers can be assigned.

Design choices, and why:

- **Bookings are never deleted**, only cancelled, so the history stays complete.
- **One customer record per phone number**, so five guest bookings from one person are one customer.
- **Internal notes live in the admin-only timeline**, never on the booking, because a logged-in customer can read their own booking.
- **Admin access is an entry in `admins/`**, created from the robot's `ADMIN_EMAILS` property. No email address is written in the code or the rules.
- **Each change and its timeline entry are saved together** (one batch from the admin panel, one commit from the robot), so the history can never disagree with the booking.
- **The robot runs under a lock** and only numbers bookings that have no number yet, so a booking is never numbered or alerted twice.

`firestore.rules` enforces all of this. `tests/rules/rules.test.mjs` checks every role against it (`npm run test:rules`, needs Java). `scripts/alerts-script.test.mjs` runs the robot against a simulated Firestore (`npm test`).

## One-time setup (about 20 minutes)

Use the Google account that **owns the Firebase project** (Firebase console → ⚙ Project settings → Users and permissions → Owner).

**1. Turn on Google login (free).** Firebase console → Authentication → Get started → Sign-in method → **Google** → Enable → Save. Then Authentication → Settings → Authorized domains → Add domain → `thedrivebuddy.in`.

**2. Make your Telegram bot.** In Telegram, open **@BotFather**, send `/newbot`, choose a name (e.g. *DriveBuddy Alerts*) and a username ending in `bot`. Copy the token it gives you (looks like `123456:ABC-xyz`). Then open your new bot, press **START** and send `hi`.

**3. Create the alerts robot.**
1. Go to https://sheets.new and name the sheet **DriveBuddy Bookings**.
2. Extensions → **Apps Script**. Click *Untitled project* at the top and rename it **DriveBuddy**. Delete the sample code. Open `apps-script\Code.js` from this repo in Notepad, copy everything, and paste it in.
3. ⚙ Project Settings → tick **Show "appsscript.json" manifest file in editor**. Back in the editor, open `appsscript.json` and replace its contents with `apps-script\appsscript.json` from this repo.
4. ⚙ Project Settings → **Script properties** → add:
   - `TELEGRAM_BOT_TOKEN` = the token from step 2
   - `ADMIN_EMAILS` = the Google account you will use for `/admin` (several are allowed, separated by commas)
   - optional: `ALERT_EMAIL` = where alert emails go (default: this account); write `none` to turn email off
5. In the editor, pick **setup** in the function list and press **Run**. Google asks for permission. Choose your account → *Advanced* → *Go to DriveBuddy (unsafe)*: it is your own script → Allow.
6. The log should show five ✓ lines, and Telegram should get "DriveBuddy alerts are connected".

**4. Deploy the security rules.** In `C:\git\drivebuddy`:

    npx firebase-tools login
    npm run deploy:backend

**5. Publish the website:** `git push`. Then open https://thedrivebuddy.in/admin/, sign in with the admin Google account, and make a test booking from your phone. It should reach Telegram within a minute.

### If `setup` shows an error

- **"Firestore 403 … permission"**: the script is running under a Google account that is not an Owner of the Firebase project. Use the owner account, or add this account as Owner in Firebase → Users and permissions.
- **"No Telegram chat found"**: open the bot, press START, send `hi`, and run `setup` again.
- **"Firestore 400 … index"**: run `npm run deploy:backend` (step 4) first, then wait 2–3 minutes for the indexes to build.

## Everyday use

- **New booking:** Telegram buzzes (plus email, plus a new row in the Sheet). Tap *Open in admin panel*, or call the number in the message.
- In `/admin`: **Confirm – I called them** → **Assign driver** → **Mark completed**.
- A booking left "New" for 10 minutes sends one reminder to Telegram.
- **New driver application:** Telegram alert and a row in the *Drivers* sheet. In the Drivers tab: Verify (after the ID and police check) → Activate.
- To add another admin later: add the email to `ADMIN_EMAILS` and run `setup` again.

## Optional paid upgrades

- **Phone + SMS-code login:** Firebase charges per SMS, and it needs the Blaze plan with a card. Switch to Blaze, enable *Phone* under Authentication → Sign-in method, and set `login.phoneOtp: true` in `site-settings.ts`.
- **Alerts in seconds instead of within a minute:** Cloud Functions (Blaze). The full version is in git history, commit `1115476`.
