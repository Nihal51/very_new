# Outstation trips and one-way drops: how the price works

Decided with the owner on 19 Oct 2026; the return day, 600 km a day and the
start time on 28 Oct 2026. The code is in
[`lib/outstation.ts`](../lib/outstation.ts); every rupee figure is in
[`site-settings.ts`](../site-settings.ts) (`prices.outstation` and the
`outstation` block), so a change there updates the website, the app and the
`/admin` calculator together.

## What the customer sees

On the booking form the customer picks **Outstation Trip** or **One-Way Car
Drop**, where they are going and **when the driver leaves** (date and time;
blank = 7 AM). The form shows an estimate straight away:

```
driving days × prices.outstation
  + one return day (returnMaxPerDay)      — one-way, if he is not home when the driving days end
  + late hours × returnHour               — if he is still travelling after the return day (max returnMaxPerDay a day)
```

In the owner's words: **a driving day is a driving day, and the trip home is
its own day.** Raipur → Mumbai is 2 driving days + 1 return day =
₹3,100 + ₹1,200 = ₹4,300 (plus late hours if he gets home late).

- **Distance** is the one-way road distance from the pickup city. Distances
  from Raipur are measured (38 places in `lib/outstation.ts`); from Bhilai,
  Durg and Bilaspur they are worked out from those. "Somewhere else" shows the
  daily rate and the team works out the distance on the call.
- **Driving days:** about `kmPerDay` (600 km, ~12 h at `averageKmh` 50) a day.
  Up to 60 km over a full day does not add a day (Raipur → Delhi, 1,214 km,
  is 2 days). Each driving day is the driver's 24 hours from the start time.
  The customer can book more days (resting, sightseeing); every day booked is
  charged, and he drops the car on the last one.
- **Round trips:** back home within the 24 hours — there and back in up to
  `sameDayMaxHours` (14) of driving, about 350 km each way — is **one day**
  (Raipur → Jharsuguda → Raipur, 640 km). Longer round trips need a night
  away and drive the distance twice (Jabalpur and back: 2 days; Delhi: 4).
- **The start time picks the train home** (one-way). From the start time and
  the distance the estimate works out when he drops the car (the last day's
  km ÷ `averageKmh`), adds `stationHours` (1 h to reach the station), and
  takes the first regular train he can catch that gets him home soonest —
  `home.trains` next to each long-distance place in `lib/outstation.ts`
  (ixigo, 28 Oct 2026; only trains that run daily or nearly daily). Places
  without a list (buses, short routes with a service every hour or two) use
  the average time home (`home.raipur`, `durg`, `bilaspur` — erail.in, redBus,
  AbhiBus). Trains are timed to Raipur; Durg (also used for Bhilai) and
  Bilaspur add the difference in those averages. A place typed in by hand
  falls back to km ÷ `busKmh`. Example: Hyderabad, he drops the car around
  10:30 AM on day 2 and waits for the 10:40 PM train — home 1:20 PM day 3,
  after day 2 ended: a return day.
- **Return day:** if he is home before the last driving day ends, nothing.
  Otherwise one return day, `returnMaxPerDay` (₹1,200).
- **Late hours:** still travelling when the return day ends (a missed train,
  no seat): `returnHour` (₹120) an hour, at most ₹1,200 in any 24 hours.
- **The final bill** uses the time he really gets home; the estimate predicts
  it. The customer books and pays for his ticket home.
- Small print: up to 12 hours of driving a day, the extra-hour rate beyond;
  fuel, tolls and parking are extra; give the driver his meals or
  `mealAllowance` (₹300) a day.
- Closer than `localWithinKm` (60 km), the form suggests the Local Full Day
  instead.

Worked examples at today's settings (₹1,550–1,650 a day, ₹1,200 return day,
₹120 a late hour), leaving Raipur at 7 AM:

| Trip from Raipur | Driving days | Way home | Return | Estimate |
| --- | --- | --- | --- | --- |
| Bilaspur, one-way | 1 | train ~1½ h → home day 1, 11:45 AM | none | ₹1,550–1,650 |
| Raigarh, one-way | 1 | train ~4 h → home day 1, 5:10 PM | none | ₹1,550–1,650 |
| Jagdalpur, one-way | 1 | bus ~7 h → home day 1, 8:45 PM | none | ₹1,550–1,650 |
| Nagpur, one-way | 1 | train ~5 h → home day 1, 6:40 PM | none | ₹1,550–1,650 |
| Nagpur, round trip | 1 | — | — | ₹1,550–1,650 |
| Jharsuguda, round trip | 1 | — | — | ₹1,550–1,650 |
| Bhopal, one-way | 1 | bus ~12 h → home day 2, 8:20 AM | return day | ₹2,750–2,850 |
| Visakhapatnam, one-way | 1 | 18518 at 9 PM → home day 2, 7 AM | none | ₹1,550–1,650 |
| Hyderabad, one-way | 2 | 12771 at 10:40 PM → home day 3, 1:20 PM | return day | ₹4,300–4,500 |
| Kolkata, one-way | 2 | 12860 at 1:40 PM → home day 3, 2:40 AM | none | ₹3,100–3,300 |
| Pune, one-way | 2 | 12129 at 6:35 PM → home day 3, 2:35 PM | return day | ₹4,300–4,500 |
| Mumbai, one-way | 2 | 12809 at 9:10 PM → home day 3, 4:05 PM | return day | ₹4,300–4,500 |
| Delhi, one-way | 2 | 12808 at 7 AM day 3 → home day 4, 5:50 AM | return day | ₹4,300–4,500 |
| Delhi, one-way, 4 days booked | 4 | the same, two days later | return day | ₹7,400–7,800 |
| Delhi, round trip | 4 | — | — | ₹6,200–6,600 |

The booking saves the trip and the estimate, and the Telegram alert, email
and Sheet show them.

## The exact price, on the call — `/admin`

Open the booking → **Price for the customer** → **Work out the price**:

1. Type what this driver asked for one outstation day.
2. Check the driving days, the hours after the driving days until he is home
   (any at all = a return day; past 24 = late hours — for the final bill, use
   when he really got home), the driver's pay per late hour (his return day
   is 10 of them), extra driving hours, and a ticket
   only if you bought it (usually 0: the customer books it).
3. Tick **A partner sent this customer** if a hotel or travel agent did; the
   commission is priced in so your profit still holds.
4. Read out **Tell the customer**, then **Save this price**.

The day rate is the driver's cost plus the minimum profit
(`outstation.minProfitPercent`), rounded up to the next ₹50. A late hour is
worked out the same way from what the driver gets for it (₹100 → ₹120), never
below the ₹120 customers were shown; the return day is 10 of them (₹1,200),
and late hours cost at most that in any 24 hours.
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
| `outstation.returnMaxPerDay` | 1200 | The return day — and the most late hours cost in any 24 hours |
| `outstation.returnHour` | 120 | Per late hour, after the return day |
| `outstation.extraHour` | 120 | Per hour beyond `hoursPerDay` |
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
name, departure time, hours to Raipur). Never rename an `id`: bookings store
it.
