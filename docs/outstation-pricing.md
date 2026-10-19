# Outstation trips and one-way drops: how the price works

Decided with the owner on 19 Oct 2026. The code is in
[`lib/outstation.ts`](../lib/outstation.ts); every rupee figure is in
[`site-settings.ts`](../site-settings.ts) (`prices.outstation` and the
`outstation` block), so a change there updates the website, the app and the
`/admin` calculator together.

## What the customer sees

On the booking form (and in the app) the customer picks **Outstation Trip**
or **One-Way Car Drop**, then where they are going. The form shows an
estimate straight away:

```
days × prices.outstation  +  return hours × outstation.returnHour   (at most returnMaxPerDay in any 24 h)
```

**Each day covers the driver's whole 24 hours, counted from the start** — up
to 12 hours of driving, and his bus or train home too. Return hours are only
the hours he is still travelling home *after* the last paid day ends. The
owner's example: starts 6 AM, home by 6 AM next day → no return charge; home
at 10 AM → 4 hours × ₹120 = ₹480.

- **Distance** is the one-way road distance from the pickup city. Distances
  from Raipur are measured (38 places in `lib/outstation.ts`); from Bhilai,
  Durg and Bilaspur they are worked out from those. "Somewhere else" shows the
  daily rate and the team works out the distance on the call.
- **Days:** about `kmPerDay` (400 km) of driving a day. Up to 40 km over a
  full day does not add a day (Raipur → Delhi, 1,214 km, is 3 days). The
  customer can book more days (resting, sightseeing); every day booked is
  charged.
- **Round trips follow the same 24-hour rule:** if the driver is back home
  within the 24 hours — there and back in up to `sameDayMaxHours` (16) of
  driving, about 360 km each way — it is **one day** (Raipur → Jharsuguda →
  Raipur, 640 km: 1 day). Longer round trips need a night away and drive the
  distance twice (Jabalpur and back: 2 days; Bhopal: 4).
- **Return hours** (one-way drops only): the last day's drive (km beyond the
  full days ÷ `averageKmh`) + `stationHours` (1 h to reach the station and
  wait) + **the real train or bus time home**, minus 24. If that is zero or
  less, nothing is due. The time home is checked for every destination in
  the timetables (erail.in, redBus, AbhiBus — 20 Oct 2026): the regular daily
  trains or buses a driver gets on short notice, not weekly premium trains,
  separately to Raipur, Durg (also used for Bhilai) and Bilaspur — e.g.
  Delhi → Raipur ~22½ h, Mumbai ~18 h, Kolkata ~13¼ h (but ~11¼ h to
  Bilaspur, which those trains reach first), Hyderabad ~15 h, Lucknow ~20 h
  (no daily train; via Prayagraj). They live next to each place in
  `destinations` in `lib/outstation.ts` — check them once a year. A place
  typed in by hand falls back to km ÷ `busKmh`. Charged at `returnHour` (₹120) an hour, at most
  `returnMaxPerDay` (₹1,200) in any 24 hours. Booking extra days does not
  change them: the drop and the end of the paid time move together.
- Small print: up to 12 hours of driving a day, the extra-hour rate beyond;
  fuel, tolls, parking and the driver's ticket home are extra; give the driver
  his meals or `mealAllowance` (₹300) a day.
- Closer than `localWithinKm` (60 km), the form suggests the Local Full Day
  instead.

Worked examples at today's settings (₹1,450–1,650 a day, ₹120 a return hour,
at most ₹1,200 a day):

| Trip from Raipur | Days | Return hours after the paid days | Estimate |
| --- | --- | --- | --- |
| Bilaspur, one-way | 1 | 0 | ₹1,450–1,650 |
| Nagpur, one-way | 1 | 0 (home the same evening) | ₹1,450–1,650 |
| Nagpur, round trip | 1 | — (home the same night) | ₹1,450–1,650 |
| Jharsuguda, round trip | 1 | — (home the same night) | ₹1,450–1,650 |
| Bhopal, one-way | 2 | 0 | ₹2,900–3,300 |
| Hyderabad, one-way | 2 | 1 → ₹120 (train ~15 h) | ₹3,020–3,420 |
| Kolkata, one-way | 2 | 0 (train ~13 h) | ₹2,900–3,300 |
| Lucknow, one-way | 2 | 6 → ₹720 (train ~20 h) | ₹3,620–4,020 |
| Mumbai, one-way | 3 | 3 → ₹360 (train ~18 h) | ₹4,710–5,310 |
| Delhi, one-way | 3 | 9 → ₹1,080 (train ~22½ h) | ₹5,430–6,030 |
| Delhi, one-way, 5 days booked | 5 | 9 → ₹1,080 | ₹8,330–9,330 |

The booking saves the trip and the estimate, and the Telegram alert, email
and Sheet show them.

## The exact price, on the call — `/admin`

Open the booking → **Price for the customer** → **Work out the price**:

1. Type what this driver asked for one outstation day.
2. Check the days, the return hours (hours he will still be travelling home
   after the paid days), the driver's pay per return hour (₹100 by default),
   extra driving hours, and the bus/train ticket (passed on at cost, no profit
   on it).
3. Tick **A partner sent this customer** if a hotel or travel agent did; the
   commission is priced in so your profit still holds.
4. Read out **Tell the customer**, then **Save this price**.

The day rate is the driver's cost plus the minimum profit
(`outstation.minProfitPercent`), rounded up to the next ₹50. A return hour is
worked out the same way from what the driver gets for it (₹100 → ₹120), never
below the ₹120 customers were shown, with the same daily maximum in hours (10).
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
| `prices.outstation` | 1450–1650 | Customer price per driving day |
| `outstation.returnHour` | 120 | Per hour the driver is still travelling home after the paid days |
| `outstation.returnMaxPerDay` | 1200 | The most return hours cost in any 24 hours |
| `outstation.extraHour` | 120 | Per hour beyond `hoursPerDay` |
| `outstation.hoursPerDay` | 12 | Driving hours in a day |
| `outstation.mealAllowance` | 300 | Per day, if the customer does not feed the driver |
| `outstation.kmPerDay` | 400 | Planning distance per driving day |
| `outstation.averageKmh` | 45 | Highway average with stops (the last day's drive) |
| `outstation.busKmh` | 50 | Bus/train average on the way home |
| `outstation.stationHours` | 1 | Reaching the bus stand or station and waiting |
| `outstation.localWithinKm` | 60 | Below this, suggest Local Full Day |
| `outstation.minProfitPercent` | 15 | Floor for the `/admin` calculator and the profit guard |

To add a destination, copy a line in `destinations` in `lib/outstation.ts`
(road and straight-line km from Raipur) and run `npm test`. Never rename an
`id`: bookings store it.
