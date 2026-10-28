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
   gives the drop time. Then `stationHours` (1 h) to the station, and the
   first regular train home he can catch **on a day it runs** that gets him
   home soonest (`home.trains` next to each long route in `lib/outstation.ts`,
   with running days and connections, e.g. Hyderabad and Bengaluru via Nagpur). Routes
   without a list (buses, short routes with a service every hour or two) use
   the average time home. Trains are timed to Raipur; Durg (also Bhilai) and
   Bilaspur add the difference in the averages. A place typed in by hand
   falls back to km ÷ `busKmh`.
3. **Way home:** every hour from the drop until he is home — waiting for the
   train included — at `returnHour` (₹120), at most `returnMaxPerDay`
   (₹1,200) in any 24 hours.
4. The customer books his ticket home. The **final bill** uses the real
   times; the estimate predicts them. Booking extra days (stops on the way)
   charges each as a full day and moves the drop on.

Without a date, trains that run only on some days are left out (the daily
ones and the connections still count) — pick the date for the exact train.

### Round trips

The days of the trip × `prices.outstation` (the driver is with the customer
the whole time). Back home within the 24 hours — up to `sameDayMaxHours` (14)
of driving there and back — is one day; longer ones drive the distance twice.

Small print for both: fuel, tolls and parking are extra; give the driver his
meals or `mealAllowance` (₹300) a day. Closer than `localWithinKm` (60 km),
the form suggests the Local Full Day instead.

### Worked examples (₹1,550–1,650 a day, ₹120 an hour), from Raipur at 7 AM

| One-way drop | Driving | Drops the car | Way home | Hours home | Estimate |
| --- | --- | --- | --- | --- | --- |
| Nagpur | 6 h | day 1, 12:40 PM | train ~5 h → home day 1, 6:40 PM | 6 h | ₹1,440 |
| Jagdalpur | 6 h | day 1, 12:45 PM | bus ~7 h → home day 1, 8:45 PM | 8 h | ₹1,680 |
| Visakhapatnam | 11 h | day 1, 5:55 PM | 18518 at 9:00 PM → home day 2, 7:00 AM | 14 h | ₹2,520 |
| Bhopal | 1 day + 1 h | day 1, 7:35 PM | bus ~12 h → home day 2, 8:20 AM | 13 h | ₹2,870–2,970 |
| Kolkata | 1 day + 5 h | day 2, 11:35 AM | 12860 at 1:40 PM → home day 3, 2:40 AM | 16 h | ₹3,350–3,450 |
| Hyderabad | 1 day + 4 h | day 2, 10:35 AM | 12721 via Nagpur at 11:25 PM → home day 3, 3:50 PM | 30 h | ₹3,950–4,050 |
| Pune | 1 day + 9 h | day 2, 3:10 PM | 12129 at 6:35 PM → home day 3, 2:35 PM | 24 h | ₹3,830–3,930 |
| Mumbai | 1 day + 11 h | day 2, 5:20 PM | 12809 at 9:10 PM → home day 3, 4:05 PM | 23 h | ₹4,070–4,170 |
| Mumbai, day and night | 1 day + 11 h | day 2, 5:20 AM | 12809 at 9:10 PM → home day 3, 4:05 PM | 35 h | ₹5,270–5,370 |
| Delhi | 2 days + 1 h | day 2, 7:15 PM | 18238 at 4:25 AM → home day 4, 8:25 AM | 38 h | ₹5,620–5,820 |
| Delhi, leaving Sun | 2 days + 1 h | Mon 7:15 PM | 12808 at 7:00 AM → home Wed 5:50 AM | 35 h | ₹5,620–5,820 |
| Bengaluru, leaving Mon | 2 days + 4 h | Wed 10:25 AM | 22366 via Nagpur at 11:50 PM → home Fri 7:30 AM | 46 h | ₹5,980–6,180 |
| Chennai | 2 days + 5 h | day 3, 11:05 AM | train ~23 h → home day 4, 11:05 AM | 24 h | ₹4,900–5,100 |

Day and night can cost more in the end: Mumbai non-stop arrives at 5:20 AM,
but the train home is still the 9:10 PM one, so he waits — the estimate
shows it.

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

## The profit guard (optional)

Add a GitHub secret `DRIVER_COSTS` (Settings → Secrets and variables →
Actions), for example `outstation=1000-1100; fullDay=700` with your real
figures. Every deploy then checks that each listed price still earns the
minimum profit on those costs, and stops with a plain message if a typo
(say 1150 for 1450) would lose money. The message names the price, never the
cost, because build logs of a public repository are public.

## Changing the rules

All in `site-settings.ts`:

| Setting | Today | Meaning |
| --- | --- | --- |
| `prices.outstation` | 1550–1650 | Customer price per driving day |
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
| `outstation.localWithinKm` | 60 | Below this, suggest Local Full Day |
| `outstation.minProfitPercent` | 15 | Floor for the `/admin` calculator and the profit guard |

To add a destination, copy a line in `destinations` in `lib/outstation.ts`
(road and straight-line km from Raipur) and run `npm test`. For a long
route with few trains a day, add its regular trains home (`trains`: number,
name, departure time, hours to Raipur, `days` it runs if not daily, `via` for
a change of train). Never rename an `id`: bookings store it.
