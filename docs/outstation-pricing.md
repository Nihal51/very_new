# Outstation trips and one-way drops: how the price works

Decided with the owner on 19 Oct 2026; the timings and the hourly rules on
28 Oct 2026. The code is in [`lib/outstation.ts`](../lib/outstation.ts); every
rupee figure is in [`site-settings.ts`](../site-settings.ts)
(`prices.outstation` and the `outstation` block), so a change there updates
the website, the app and the `/admin` calculator together.

## What the customer sees

On the booking form (and in the app) the customer picks **One-Way Car Drop**
or **Outstation Trip**, where to, and **when the driver leaves** (date and
time; blank = 7 AM). The estimate shows straight away, with the driver's trip
hour by hour.

### One-way drops

```
full days × prices.outstation          each hoursPerDay (12 h, ~600 km) of driving
+ extra hours × outstation.extraHour   the driving left over (a drive under 12 h: all of it)
+ way home × outstation.returnHour     from the drop until he is home, waiting included
                                       (at most returnMaxPerDay in any 24 h)
```

1. **Driving:** the one-way km at `averageKmh` (50). Raipur → Mumbai, 1,118 km
   = 22.4 h = 1 day + 11 h.
2. **Timings, from the start date and time:** he drives 12 hours and rests 12
   (up to an hour more he finishes that evening) — or, if the customer ticks
   **Drive day and night**, straight through (the same driving price). That
   gives the drop time; then `stationHours` (1 h) to the station.
3. **The train home — real trains for that date** (see *Trains home* below):
   the lookup finds the trains from the destination's stations to the pickup
   city's station (Raipur `R`; Durg `DURG`, also for Bhilai; Bilaspur `BSP`)
   for the drop date. Direct trains first; if none leaves within
   `trains.directWithinHours`, connections through the destination's change
   station (e.g. Nagpur) where **both** trains came back from the lookup and
   the change leaves at least `trains.transferBufferMinutes`. The customer
   sees the recommended train (home soonest) and can choose another; the
   estimate follows. **No train times are typed into the code.**
4. **When no train is confirmed** (no date picked yet, a bus route, the
   lookup not set up, or it fails or finds nothing): the typical hours home
   from `destinations[].home` are used, and the card **says so**, with links
   to NTES and IRCTC. A place typed in by hand uses km ÷ `busKmh`.
5. **Way home:** every hour from the drop until he is home — waiting for the
   train included — at `returnHour` (₹120), at most `returnMaxPerDay`
   (₹1,200) in any 24 hours. Shown split: waiting + on the train, charged once.
6. Not in the price, listed separately: his ticket (the customer books it),
   meals (`mealAllowance` a day if not given), fuel, tolls, parking, and a
   hotel only if a night stop is agreed. The **final bill** uses the real
   times. Booking extra days (stops on the way) charges each as a full day.

### Round trips

The days of the trip × the day price for the distance (the driver is with
the customer the whole time). Nearer places cost less a day (decided 29 Oct
2026), by one-way road km from the pickup city — `prices.outstationNear`:

| One way from the pickup city | Per day | For example, from Raipur |
| --- | --- | --- |
| up to 150 km | ₹1,300–1,400 | Bilaspur, Rajnandgaon, Dhamtari, Kanker |
| up to 300 km | ₹1,450–1,550 | Korba, Raigarh, Gondia, Nagpur, Jagdalpur |
| farther | ₹1,550–1,650 (`prices.outstation`) | Ambikapur, Jabalpur and beyond |

The same day price applies to a one-way drop's full days, but those only
happen on drives of 12 hours or more (about 600 km), so in practice one-way
drops use `prices.outstation`; a short drop is all by the hour. Back home within the 24 hours — up to `sameDayMaxHours` (14)
of driving there and back — is one day; longer ones drive the distance twice.

Small print for both: fuel, tolls and parking are extra; give the driver his
meals or `mealAllowance` (₹300) a day. Closer than `localWithinKm` (60 km),
the form suggests the Local Full Day instead.

### Worked examples (₹1,550–1,650 a day, ₹120 an hour), from Raipur at 7 AM, before the train lookup

| One-way drop | Driving | Drops the car | Typical way home (allowance) | Hours home | Estimate |
| --- | --- | --- | --- | --- | --- |
| Nagpur | 6 h | day 1, 12:40 PM | 1 h + train ~5 h | 6 h | ₹1,440 |
| Jagdalpur | 6 h | day 1, 12:45 PM | 1 h + bus ~7 h | 8 h | ₹1,680 |
| Mumbai | 1 day + 11 h | day 2, 5:20 PM | 1 h + train ~18 h | 19 h | ₹4,070–4,170 |

With a date, the lookup replaces the allowance with the real trains for that
day — including the wait for the train: dropped at 12 PM, train at 3 PM = 3 h
waiting + the hours on the train. Day and night can cost more in the end when
the earlier drop only means a longer wait for the same train; the estimate
shows it.

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

1. Type what this driver asked for one outstation day.
2. Check the full days (each 12 h of driving; 0 for a shorter drive), the
   extra driving hours, the hours from the drop until he is home (for the
   final bill, use when he really got home), the driver's pay per hour home
   (at most 10 of them in any 24 hours), and a ticket only if you bought it
   (usually 0: the customer books it). For a one-way drop the days and extra
   hours start from the distance, as the estimate.
3. Tick **A partner sent this customer** if a hotel or travel agent did; the
   commission is priced in so your profit still holds.
4. Read out **Tell the customer**, then **Save this price**.

The day rate is the driver's cost plus the minimum profit
(`outstation.minProfitPercent`), rounded up to the next ₹50. An hour of the
way home is worked out the same way from what the driver gets for it, never
below the ₹120 customers were shown, with the same daily maximum in hours
(10); extra driving hours at the published ₹120 or the cost-based rate,
whichever is higher.
The panel shows what the driver gets and your profit, in red if it is under the
minimum, and says so if a rate is above what customers were shown.

**What is saved where:** the booking gets only the customer's price (they see
it in My account and the app). The driver's cost and your profit go in the
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
| Driving | One-way: start → drop. Round trip: start → back |
| Normal trip | Each 24 h from the start is a day (12 h driving + 12 h rest); what is left after the last 24 h is driving: 12 h of it is one more day, the rest ₹120 an hour |
| Day and night | Every 12 h is a day, the rest ₹120 an hour (tick *Driven day and night*; it starts ticked if the customer asked) |
| Extra hours | Never more than one more day |
| Round trip | At least one day |
| Way home (one-way) | Drop → home, ₹120 an hour, at most ₹1,200 in any 24 h |
| Minutes | The first 15 minutes of an hour are free (`outstation.graceMinutes`): 4 h 15 m = 4 h, 4 h 16 m = 5 h |

Raipur → Bengaluru, day and night, ₹1,600 a day: left Thu 7:45 AM, dropped
Fri 12:40 PM (28 h 55 m → 2 days + 5 h = ₹3,800), home Sun 2:20 AM (37 h
40 m → 38 h = ₹2,400): **₹6,200**.

Before the first use: publish the new `firestore.rules` (the *Deploy backend*
workflow, or paste them in the Firebase console) and paste the new
`apps-script/Code.js` into the Apps Script editor.

## The profit guard (optional)

Add a GitHub secret `DRIVER_COSTS` (Settings → Secrets and variables →
Actions), for example `outstation=1000-1100; fullDay=700` with your real
figures. Every deploy then checks that each listed price still earns the
minimum profit on those costs, and stops with a plain message if a typo
(say 1150 for 1450) would lose money. The `outstation` cost is checked
against every nearby day price too (`prices.outstationNear`), since the same
driver does those trips. The message names the price, never the
cost, because build logs of a public repository are public.

## Changing the rules

All in `site-settings.ts`:

| Setting | Today | Meaning |
| --- | --- | --- |
| `prices.outstation` | 1550–1650 | Customer price per day, farther than the nearby tiers |
| `prices.outstationNear` | ≤150 km 1300–1400, ≤300 km 1450–1550 | Cheaper days for places closer by (one-way road km); nearest first; `[]` = one price everywhere |
| `outstation.returnHour` | 120 | Per hour of the way home, from the drop until he is home |
| `outstation.returnMaxPerDay` | 1200 | The most the way home costs in any 24 hours |
| `outstation.extraHour` | 120 | Per driving hour beyond the full days |
| `outstation.hoursPerDay` | 12 | Driving hours in a day |
| `outstation.mealAllowance` | 300 | Per day, if the customer does not feed the driver |
| `outstation.kmPerDay` | 600 | Planning distance per driving day |
| `outstation.averageKmh` | 50 | Highway average with stops (when he drops the car) |
| `outstation.sameDayMaxHours` | 14 | Round trip driving that still fits in one day |
| `outstation.busKmh` | 50 | Bus/train average on the way home |
| `outstation.stationHours` | 1 | From the drop to the bus stand or station |
| `outstation.graceMinutes` | 15 | Final bill: minutes of an hour not charged |
| `outstation.localWithinKm` | 60 | Below this, suggest Local Full Day |
| `outstation.minProfitPercent` | 15 | Floor for the `/admin` calculator and the profit guard |

To add a destination, copy a line in `destinations` in `lib/outstation.ts`
(road and straight-line km from Raipur, the typical hours home) and run
`npm test`. For a train route, add its stations (`rail.stations`, the main
one first) and, where direct trains are few, a change station (`rail.hubs`).
Never type in train times. Never rename an `id`: bookings store it.

The train lookup's rules are in `site-settings.ts` → `trains`:
`transferBufferMinutes` (90), `maxTransferHours` (12), `directWithinHours`
(24), `maxWaitHours` (48), `maxOptions` (5), `lookupUrl`.
