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

### One-way drops farther than 160 km: the drive, the nights, his wait for the train (v4, 24 Nov 2026)

A one-way drop farther than the first nearby tier
(`prices.outstationNear[0].upToKm`, 160 km) is priced by the km in two
bands, the nights he stops on the road and — over 500 km — his wait for the
train home (`lib/outstation.ts` `longOneWayPrice`; the mobile app does the
same from `app-config.json`). All customer prices, in `outstation.oneWay` —
never the driver's pay (his rate card is set in Script Properties):

```
drive  = first + perKm × (km − firstKm, between 0 and fartherFromKm − firstKm)
               + perKmFarther × (km − fartherFromKm, at least 0)
nights = the plan's calendar days − 1      (0 when driven day and night)
wait   = over waitFromKm only: min(waitMax, waitHour × each started hour of W past waitFreeHours)
price  = max(minimum, the nearest roundTo of drive + nights × night + wait)   + his ticket
```

- Today: `first` 1,500 for the first `firstKm` 200 km, `perKm` 2.50 to
  `fartherFromKm` 500, `perKmFarther` 3.25 after it, `night` 300,
  `waitFromKm` 500, `waitFreeHours` 4, `waitHour` 100, `waitMax` 1,200,
  `minimum` 1,500, `roundTo` 50 (to the NEAREST 50).
- W = hours from the drop until he boards: the route's average wait
  (`home.wait`; `stationHours` for a place from the map) on the estimate; a
  train picked on the booking form or chosen at the drop: its departure − the
  drop; the final bill: his **Boarded** tap − the drop (a late or missed train
  is the customer's, still never more than `waitMax`); no Boarded tap: the
  chosen train's departure; neither: the estimate. The train ride itself is
  never charged.
- Final bill only: **stops the customer asked for** — the real start → drop
  beyond the plan's road time (driving + breaks + nights) and
  `stopsFreeHours` (1), each started hour × `stopsHour` (100). /admin shows it
  as its own line and the office can set it to 0 before saving.
- Under the estimate: over 500 km "The final price is set by the train he
  takes home — at most ₹1,200 more for his wait."; 160–500 km "No charge for
  his wait at this distance."
- The customer books and pays his ticket and gives his meals, as before.

| From Raipur, 7 AM | Km | Drive | Nights | Wait (route average) | Price |
| --- | --- | --- | --- | --- | --- |
| Gondia | 201 | 1,502.50 | 0 | — | **1,500** |
| Ambikapur | 334 | 1,835 | 0 | — | **1,850** |
| Visakhapatnam | 546 | 2,399.50 | 0 | 4 h 45 m → 1 h = 100 | **2,500** |
| Ranchi | 616 | 2,627 | 0 | 10 h 45 m → 7 h = 700 | **3,350** |
| Lucknow | 779 | 3,156.75 | 1 = 300 | 20 h 45 m → 17 h: at most 1,200 | **4,650** |
| Delhi | 1,214 | 4,570.50 | 1 = 300 | 7 h 15 m → 4 h = 400 | **5,250** |
| Bengaluru | 1,370 | 5,077.50 | 2 = 600 | 8 h 45 m → 5 h = 500 | **6,200** |

All 16 examples of the spec (Gondia 1,500 … Chennai 6,400) are unit tests in
`scripts/outstation.test.mjs`; the mobile app's tests use the same numbers.

**The drive's timing** (`outstation.drive`: when he arrives, which train he
can catch, his wait, the days): driving at `kmh` (55), a break of
`breakMinutes` (35) after each full `breakEveryHours` (4) of driving; more
than `maxRoadHoursPerDay` (12) on the road — an hour more finishes that
evening — and he rests the night, unless the customer wants it driven day
and night (`lib/outstation.ts` `roadTime`, `planTrip`). Round trips keep
`averageKmh`.

**Saved:** on the booking `trip.days` = the calendar days, `trip.estFrom` /
`estTo` = the price (the robot's offers use it). The /admin quote and the
final bill save `dayRate` = the drive (to the rupee) with `days` 1, `km`,
`nights` and `nightRate`, `waitHours` (the hours charged), `waitHourRate`,
`waitCharge`, on the bill also `stopsHours`, `stopsHourRate`, `stopsCharge`,
no way-home or extra-hour charge, `minimum` and `adjust` (the round-off, at
most ₹100 either way, or the top-up to the minimum); `amount` = dayRate +
nights × nightRate + waitCharge + stopsCharge + adjust + ticket
(firestore.rules `isV4Price`). `nightRate` marks a v4 quote or bill.

**The driver's pay** is unchanged (the robot's rate card, `DRIVER_RATES`): his
whole time T, start → home, `max(tripDay, floor(T / 24) × tripDay +
min(tripDay, ceil(T mod 24) × returnHour))`.

**Older bookings** keep computing as they were agreed, told apart by the
fields saved on them: v3 (`kmRate`: the drive at km × kmRate plus his way home
by the hour, at most 15 hours' worth a day) and the first 24 Nov 2026 rule
(driving days and the way home at an hourly rate, `pricedV2Long`).

### The train check at the drop (24 Nov 2026)

When a one-way drop over 160 km gets its drop time — the trip link's **Car
dropped** or the Driver app's **Job done**, whichever the robot sees first —
the robot (`apps-script/Code.js` `returnCheckFor_`) looks up the trains home
from the drop place's stations (and one change at a hub) to the pickup city's
home station, through the same RailRadar path and budget. He is ready
`trains.toStationMinutes` (90) after the drop; up to 3 trains leaving within
`trains.maxWaitHours`, each with the final price with that train's wait.

- `bookings/{id}.returnCheck` (the robot's alone, also copied to the trip
  link): `{ at, dropAt, options: [{ train, name, from, dep, arr, change,
  waitMin, waitCharge, price }], bus, failed }`. `bus` when the first train
  leaves more than 12 h after he is ready, or there is none; `failed` when the
  lookup could not run (the message says the team will call).
- Telegram to the office, with the options; a push to the customer: "Your
  driver has dropped the car. Book his ticket home — pick a train." (Hindi too).
- The customer books the ticket (we never check seats: each train has a
  **Check seats ↗** link) and taps **I booked this train** in My account or the
  app: `returnChoice = { train, dep, at }`, once, one of the trains offered;
  the office can set any train or clear it in /admin.
- The robot then writes `returnPrice = { price, waitCharge, train, at }` and
  pushes "Final price ₹X with train N" (Telegram too).
- The trip page and the Driver app show the options, then "Your train: N at
  …", and a **Boarded the train** tap between Car dropped and Home
  (`boardAt`, once, after the drop); the robot copies it into the clock and the
  final bill takes his wait from it. A bus: he taps Home without Boarded.

### Any place in India (the place box, 24 Nov 2026)

"Drop the car in" and "Where to?" are a search box (`components/PlacePicker.tsx`,
an accessible combobox) over our destinations and every place in India
(`public/data/india-places.json`, 3,502 places, built by
`scripts/places/build-places.js`; the browser fetches it only when the box is
used). Type 2 letters or more: names, old names (Allahabad → Prayagraj) and
states match, accents and case ignored; names that begin with it first, then
a later word, then the state's places, then names it is inside — ours first
among equals, then the biggest; at most 20. "Somewhere else" keeps what was
typed, priced on the call as before. Islands without a road (Andaman and
Nicobar, Lakshadweep) are not offered.

- **One of ours:** exactly as before — measured km, the route's average way
  home, its stations and change stations.
- **Any other place:** km = round(straight line from the pickup city ×
  `outstation.roadFactor`, 1.3), shown as "estimated from the map — the team
  confirms" (Raipur → Ambikapur: 342 km against the measured 334). Then the
  same rules: up to 160 km the same-day price, farther the price by the km
  plus his way home; round trips the days at the day price for that km. His
  way home: the bus/train average (km ÷ `busKmh` + `stationHours`) until a
  date is picked; then the train lookup from the place's nearest station (the
  list's `station`, renamed codes mapped to today's — `RENAMED_STATIONS`) to
  the pickup city's home station, direct trains only, through the robot as
  for our places. No train found: the average stays.
- **Saved:** `trip.to` = "Name, State" (at most 60 characters), `trip.destId`
  = '' (as a typed place), `trip.km` = the km from the map, the estimate as
  shown. /admin plans it from that km; the robot's offers and rate card use
  `trip.estTo`, `trip.km` and `trip.returnHours` as for any trip, and its
  booking line says "(km from the map)".

Credits: places GeoNames (CC BY 4.0), stations datameet/railways (CC0) —
under the box and on /about.

### One-way drops up to 160 km (and before 24 Nov 2026): the driver's time

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
   dropped** (one-way only) → **Boarded the train** (one-way; skipped when he takes a bus) → **Home** (round trip: **Back**). Each tap saves
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
| One-way farther than 160 km (v4, 24 Nov 2026 on) | The agreed drive and nights, his wait drop → Boarded (else the chosen train, else the estimate) past the free hours, at most `waitMax`, and the stops the customer asked for (`v4`, saved with `nightRate`) |
| One-way farther than 160 km (v3 and the first 24 Nov rule) | As agreed: the drive and his way home drop → home (`v3`, saved with `kmRate`), or driving days and the way home (`v2Long`) |
| One-way up to 160 km (8 Nov 2026 on) | The driver's time, start → home: each 24 h the agreed price for each 24 h, the hours past them the agreed hourly rate, never more than one more day (`time`, saved with the km) |
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
| `outstation.oneWay` | 1500 for 200 km / 2.50 / 3.25 from 500 km / 300 a night / wait 100 an hour past 4 h, at most 1200, over 500 km / stops 100 an hour past 1 h / 1500 / 50 | One-way drops farther than the first tier (customer prices): `first`, `firstKm`, `perKm`, `perKmFarther`, `fartherFromKm`, `night`, `waitHour`, `waitFreeHours`, `waitMax`, `waitFromKm`, `stopsHour`, `stopsFreeHours`, `minimum`, `roundTo` |
| `outstation.roadFactor` | 1.3 | A place not among ours: road km ≈ the straight line from the pickup city × this |
| `outstation.drive` | 55 / 4 / 35 / 12 | One-way timings: `kmh`, a break after each full `breakEveryHours` of driving, `breakMinutes` long, `maxRoadHoursPerDay` on the road |
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
(24), `maxWaitHours` (48), `maxOptions` (5), `toStationMinutes` (90: the
drop to the station, for the train check at the drop), `lookupUrl`.
