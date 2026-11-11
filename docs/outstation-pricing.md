# Outstation trips and one-way drops: how the price works

Decided with the owner on 19 Oct 2026; the timings on 28 Oct 2026; **one
rule for the driver's time on 8 Nov 2026** (it replaces the earlier day,
hour, short-drive and route prices). The code is in [`lib/outstation.ts`](../lib/outstation.ts); every
rupee figure is in [`site-settings.ts`](../site-settings.ts)
(`prices.outstation` and the `outstation` block), so a change there updates
the website, the app and the `/admin` calculator together.

## What the customer sees

On the booking form (and in the app) the customer picks **One-Way Car Drop**
or **Outstation Trip**, where to, and **when the driver leaves** (date and
time; blank = 7 AM). The estimate shows straight away, with the driver's trip
hour by hour.

### One-way drops: the driver's time

The customer pays for the driver's **time**, from when he leaves until he is
home by train or bus — the drive, waiting for his train and the ride home:

```
each 24 hours he is away × the day price for the distance
+ the hours past those 24-hour blocks × outstation.extraHour (₹130)
  — never more than one more day: then it is one more day
```

- **Up to 160 km** (the first `prices.outstationNear` tier) he is home the
  same day: **one price for the trip**, ₹1,050 close by rising to ₹1,350 at
  160 km (Bilaspur ₹1,200, Kanker ₹1,250, Janjgir ₹1,350).
- **Farther:** ₹1,450 rising to ₹1,750 at `outstation.dayTopFromKm` (300 km)
  and beyond, for each 24 hours (Korba ₹1,550, Nagpur ₹1,700). If he drops
  the car in 8 hours, the other 16 cover his waiting and his train home — no
  extra.
- The day price for the distance (`dayRateFor`): from the first tier's
  `from` at `outstation.nearFromKm` (60 km) rising to its `to` at its
  `upToKm`; then `prices.outstation.from` rising to `.to` at `dayTopFromKm`;
  to the nearest ₹50.

How the hours are worked out:

1. **Driving:** the one-way km at `averageKmh` (50). Raipur → Mumbai, 1,118 km
   = 22.4 h.
2. **Timings, from the start date and time:** he drives 12 hours and rests 12
   (up to an hour more he finishes that evening) — or, if the customer ticks
   **Drive day and night**, straight through. That gives the drop time.
3. **Until the customer picks a date: the route's average.** Each
   destination has the average wait for his train (`home.wait`: getting to
   the station and any change included) and the average ride home, worked
   out from the timetables over every hour of every day of the week (8 Nov
   2026; bus routes: 1.5 h and the usual ride). So the estimate is right on
   average whatever time the car is dropped.
4. **With a date: the real train** (see *Trains home* below) — the customer
   sees the recommended train and can pick another; the price follows that
   train's wait and arrival.
5. **The final bill** uses the real times (start → home), the same blocks.
6. Not in the price, listed separately: his ticket (the customer books it),
   meals (`mealAllowance` a day if not given), fuel, tolls, parking, and a
   hotel only if a night stop is agreed.

Quotes and bills from before 8 Nov 2026 (by the hours with a way-home
charge, or a route price with `awayHours`) are still billed the way they were
agreed (`finalBill`).

### Round trips

The days of the trip × the day price for the distance (the driver is with
the customer the whole time), driving beyond `hoursPerDay` a day at
`extraHour`. Back home within the 24 hours — up to `sameDayMaxHours` (14) of
driving there and back — is one day; longer ones drive the distance twice.
Raipur → Surat and back in 7 days: 7 × ₹1,750 = ₹12,250.

Small print for both: fuel, tolls and parking are extra; give the driver his
meals or `mealAllowance` (₹300) a day. Closer than `localWithinKm` (60 km),
the form suggests the Local Full Day instead.

### Worked examples, from Raipur at 7 AM, with the route's average wait and ride

| One-way drop | Km | Driving | Wait + ride home (average) | His time | Charged | Estimate |
| --- | --- | --- | --- | --- | --- | --- |
| Bilaspur | 113 | 2.3 h | 2 h + 1.5 h | 6 h | same day | ₹1,200 |
| Nagpur | 284 | 5.7 h | 2.5 h + 4.75 h | 13 h | 1 × 24 h | ₹1,700 |
| Visakhapatnam | 546 | 10.9 h | 4.75 h + 9.5 h | 26 h | 1 × 24 h + 2 h | ₹2,010 |
| Bhubaneswar | 547 | 10.9 h | 8.5 h + 13 h | 33 h | 1 × 24 h + 9 h | ₹2,920 |
| Mumbai | 1,118 | 1 day + 10.4 h | 4.75 h + 17 h | 57 h | 2 × 24 h + 9 h | ₹4,670 |
| Delhi | 1,214 | 1 day + 12.3 h | 7.25 h + 22 h | 66 h | 2 × 24 h + 18 h → 3 × 24 h | ₹5,250 |

## Trains home — the live lookup (RailRadar)

Chosen on 29 Oct 2026 after reading both providers' documentation:

- **RailRadar** (railradar.in/docs) documents a trains-between-stations search
  **with a date** (`GET /v1/trains/between/{from}/{to}?date=YYYY-MM-DD`), day
  numbers for overnight arrivals, the full timetable (`/v1/trains/{number}`),
  live running status (`/v1/trains/{number}/live`, and `live=true` on the
  search), and a Bearer key in a header. Plans: free sandbox 100 requests a
  month (testing only, not commercial); **Developer ₹999/month (₹499 the
  first month), 30,000 requests, 30 a minute**; Growth ₹2,999.
- **Qrail** (qrail.in/developers) was not chosen: its documentation shows
  only Train Route, PNR and Running Status, with no response formats, and the
  key goes in the URL; its advertised between-stations search is not
  documented, so it cannot be verified.

How it works:

1. The website never holds the key. It asks the **alerts robot**
   (`apps-script/Code.js`, `doGet` with `action=trains`), which calls
   RailRadar with `RAILRADAR_API_KEY` from its Script Properties and passes on
   only the documented fields.
2. The robot caches each search 6 hours (5 minutes with live status) and caps
   calls: `RAIL_MINUTE_LIMIT` (default 25) and `RAIL_DAILY_LIMIT` (default
   900). Over a cap it answers `busy`; RailRadar's own 429 is passed on as
   `rate-limited`.
3. `lib/rail.ts` turns each answer into real instants in India time (date +
   HH:MM + the day numbers), leaves out — and reports — any train whose data
   does not add up (bad times, days out of order, duration mismatch, not
   running on that day), and plans direct trains and connections.
4. Live delays are used only when RailRadar returns live data for today's
   run, and are labelled live; everything else is labelled scheduled, with
   the time it was checked. Nothing claims a seat or a ticket.

**One-time setup** (until then the card says the check is not switched on):

1. Sign up at railradar.in/developers and copy your API key (`rr_live_…`).
   For real customers, take the Developer plan (the sandbox is for testing
   only and allows 100 requests a month — set `RAIL_DAILY_LIMIT` to 3 and
   `RAIL_MINUTE_LIMIT` to 8 while on it).
2. Apps Script (the "DriveBuddy Bookings" Sheet → Extensions → Apps Script):
   paste the new `apps-script/Code.js`; Project Settings → Script properties
   → add `RAILRADAR_API_KEY` with the key.
3. Deploy → New deployment → Web app: execute as **Me**, access **Anyone** →
   copy the URL ending in `/exec`. (Already deployed? Manage deployments →
   Edit → Version: New version → Deploy; the URL stays the same.)
4. In `site-settings.ts`, put that URL in `trains.lookupUrl` (or in
   `alerts.pingUrl` — it is used for both), commit and push.

Station codes and change stations live next to each train destination in
`lib/outstation.ts` (`rail: { stations, hubs }`). A wrong code shows up as
"could not check" on the card, never as an invented train.

The booking saves the trip and the estimate, and the Telegram alert, email
and Sheet show them.

## The exact price, on the call — `/admin`

Open the booking → **Price for the customer** → **Work out the price**:

1. Type what this driver asked: **for each 24 hours of his time** (up to
   160 km: **for the trip**), and his pay **an hour past the 24-hour blocks**
   (it starts at the customer's ₹130 less the profit).
2. Check **the hours he is away** — from when he leaves until he is home. It
   starts from the train in the booking's note ("he is away … h in all") or,
   without one, the route's average for the booked start. A place not in the
   list: type the km too.
3. Tick **A partner sent this customer** if a hotel or travel agent did; the
   commission is priced in so your profit still holds.
4. Read out **Tell the customer**, then **Save this price**.

The price for each 24 h is the driver's cost with `outstation.targetProfitPercent`
on top (and the partner's commission), to the nearest ₹50 (the hours to the
nearest ₹10) — or type the customer's price yourself. The panel shows what
the driver gets ("N × 24 h × his cost + X h × his hourly pay"), the partner's
share and your profit, **in red outside `minProfitPercent`–`maxProfitPercent`**,
with a plain sentence saying whether it is too little for you or too much for
the customer, and the website's price for the same hours. Round trips: the
days and the extra driving hours, the same way.

**What is saved where:** the booking gets only the customer's price (they see
it in My account and the app): the 24-hour blocks at the price, the hours
past them, and the km — no `awayHours`, no way-home charge
(`firestore.rules` isQuote). The driver's cost and your profit go in the
booking's history, which only admins can read. Nothing about costs is ever in
this public repository.

## The final bill — the trip clock

The estimate predicts the times; the final bill uses the real ones.

1. **Make the link.** Open the booking in `/admin` once a driver is
   assigned → *Trip clock & final bill* → **Make …'s trip link** →
   **Send to …** (WhatsApp, Hindi and English). The driver needs no app and
   no login; the link works for that one trip only. Practice page for a new
   driver: `/trip/?k=demo` (saves nothing).
2. **He taps.** One big button for the next step: **Trip started** → **Car
   dropped** (one-way only) → **Home** (round trip: **Back**). Each tap saves
   the server's time, his phone's time (in case he had no network) and, if
   he allows it, where he was. He cannot change or undo a tap.
3. **You watch.** Telegram gets a message for each tap (the alerts robot,
   `apps-script/Code.js`), and the customer sees the times in My account and
   the app. While he is on the road `/admin` shows the bill so far.
4. **Check and save.** When he is home, `/admin` shows the final bill next
   to the agreed price, with a warning if the drive or the way home took
   much longer than the plan for his real start. Fix any time (**Change**,
   **Use his phone's time**, **Undo**), then **Save final bill** and **Send
   the bill** to the customer on WhatsApp. Saving closes the link. Type the
   driver's cost to see his pay and your profit (kept in the admin-only
   history).

How the times are charged (`finalBill` in `lib/outstation.ts`):

| | Rule |
| --- | --- |
| One-way (8 Nov 2026 on) | The driver's time, start → home: each 24 h the agreed price for each 24 h, the hours past them the agreed hourly rate, never more than one more day (`time`, saved with the km) |
| Round trips, and older quotes | as below |
| Driving | One-way: start → drop. Round trip: start → back |
| Normal trip | Each 24 h from the start is a day (12 h driving + 12 h rest); what is left after the last 24 h is driving: 12 h of it is one more day, the rest by the hour |
| Day and night | Every 12 h is a day, the rest by the hour (tick *Driven day and night*; it starts ticked if the customer asked) |
| Extra hours | Never more than one more day |
| Round trip | At least one day |
| Way home (quotes before 8 Nov 2026) | Drop → home, ₹120 an hour, at most ₹1,200 in any 24 h |
| Minutes | The first 15 minutes of an hour are free (`outstation.graceMinutes`): 4 h 15 m = 4 h, 4 h 16 m = 5 h |

Raipur → Mumbai at ₹1,750 for each 24 h and ₹130 an hour: left Thu 7:45 AM,
home Sat 4:55 PM = 57 h 10 m → 57 h = 2 × 24 h + 9 h = ₹3,500 + ₹1,170 =
**₹4,670**. Home 4 hours later (61 h): 13 h past the blocks would cost
₹1,690 — still less than a day — so ₹5,190; 6 hours later (63 h): 15 h would
cost more than a day, so 3 × 24 h = ₹5,250.

Before the first use: publish the new `firestore.rules` (the *Deploy backend*
workflow, or paste them in the Firebase console) and paste the new
`apps-script/Code.js` into the Apps Script editor.

## The profit guard (optional)

Add a GitHub secret `DRIVER_COSTS` (Settings → Secrets and variables →
Actions), for example `outstation=1000-1100; outstationNear=700-800;
fullDay=700` with your real figures. Every deploy then checks that each
listed price still earns `outstation.guardProfitPercent` on those costs, and stops with a
plain message if a typo (say 1150 for 1450) would lose money.
`outstationNear` is what a driver costs for a same-day drop, checked against
each nearby tier (`prices.outstationNear`); `outstation` is checked against
the price for each 24 h farther away. The message names the price, never the
cost, because build logs of a public repository are public.

## Changing the rules

All in `site-settings.ts`:

| Setting | Today | Meaning |
| --- | --- | --- |
| `prices.outstation` | 1450–1750 | Customer price for each 24 h of the driver's time, farther than the nearby tiers (rising with the distance) |
| `prices.outstationNear` | ≤160 km 1050–1350 | Same-day drops (one price for the trip) and round-trip days close by; nearest first |
| `outstation.nearFromKm` | 60 | The day price starts rising from the first tier's `from` here … |
| `outstation.dayTopFromKm` | 300 | … and reaches `prices.outstation.to` here (farther: the same) |
| `outstation.extraHour` | 130 | Per hour past the 24-hour blocks of a one-way drop (never more than a day); per driving hour beyond the day on a round trip |
| `outstation.returnHour` | 120 | Quotes and bills from before 8 Nov 2026 only: per hour of the way home |
| `outstation.returnMaxPerDay` | 1200 | Quotes and bills from before 8 Nov 2026 only: the most the way home costs in any 24 hours |
| `outstation.hoursPerDay` | 12 | Driving hours in a day |
| `outstation.mealAllowance` | 300 | Per day, if the customer does not feed the driver |
| `outstation.kmPerDay` | 600 | Planning distance per driving day |
| `outstation.averageKmh` | 50 | Highway average with stops (when he drops the car) |
| `outstation.sameDayMaxHours` | 14 | Round trip driving that still fits in one day |
| `outstation.busKmh` | 50 | Bus/train average on the way home, for a place not in the list |
| `outstation.stationHours` | 1 | From the drop to the bus stand or station, for a place without an average wait |
| `outstation.graceMinutes` | 15 | Final bill: minutes of an hour not charged |
| `outstation.localWithinKm` | 60 | Below this, suggest Local Full Day |
| `outstation.targetProfitPercent` | 25 | The `/admin` calculator works the price out with this profit |
| `outstation.minProfitPercent` / `maxProfitPercent` | 20 / 30 | The profit band: the calculator warns outside it |
| `outstation.guardProfitPercent` | 15 | The build's profit guard (the `DRIVER_COSTS` secret): no price on the site may earn less than this |

To add a destination, copy a line in `destinations` in `lib/outstation.ts`
(road and straight-line km from Raipur, the average hours home and, for a
train route, the average wait `home.wait` from the timetables) and run
`npm test`. For a train route, add its stations (`rail.stations`, the main
one first) and, where direct trains are few, a change station (`rail.hubs`).
Never type in train times. Never rename an `id`: bookings store it.

The train lookup's rules are in `site-settings.ts` → `trains`:
`transferBufferMinutes` (90), `maxTransferHours` (12), `directWithinHours`
(24), `maxWaitHours` (48), `maxOptions` (5), `lookupUrl`.
