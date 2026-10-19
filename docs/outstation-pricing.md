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
days × prices.outstation  +  return days × outstation.returnDay
```

- **Distance** is the one-way road distance from the pickup city. Distances
  from Raipur are measured (38 places in `lib/outstation.ts`); from Bhilai,
  Durg and Bilaspur they are worked out from those. "Somewhere else" shows the
  daily rates and the team works out the distance on the call.
- **Driving days:** about `kmPerDay` (400 km) a day. Up to 40 km over a full
  day does not add a day (Raipur → Delhi, 1,214 km, is 3 days). A round trip
  drives the distance twice. The customer can book more days (resting,
  sightseeing); every day booked is charged.
- **Return days** (one-way drops only): the days the driver needs to get home
  by bus or train, about `returnKmPerDay` (800 km) a day. None when the drive
  and the ride home fit in one 12-hour day (Raipur → Bilaspur).
- Small print: up to 12 hours of driving a day, the extra-hour rate beyond;
  fuel, tolls, parking and the driver's ticket home are extra; give the driver
  his meals or the meal allowance.
- Closer than `localWithinKm` (60 km), the form suggests the Local Full Day
  instead.

Worked examples at today's settings (₹1,450–1,650 a driving day, ₹1,000–1,200
a return day — the driver on a bus or train home, not driving):

| Trip from Raipur | Days | Estimate |
| --- | --- | --- |
| Bilaspur, one-way | 1 + 0 return | ₹1,450–1,650 |
| Nagpur, one-way | 1 + 1 return | ₹2,450–2,850 |
| Nagpur, round trip | 2 | ₹2,900–3,300 |
| Bhopal, one-way | 2 + 1 return | ₹3,900–4,500 |
| 1,200 km, one-way | 3 + 2 return | ₹6,350–7,350 |
| 1,200 km, one-way, 5 days booked | 5 + 2 return | ₹9,250–10,650 |

The booking saves the trip and the estimate, and the Telegram alert, email
and Sheet show them.

## The exact price, on the call — `/admin`

Open the booking → **Price for the customer** → **Work out the price**:

1. Type what this driver asked for one outstation day.
2. Check the days, return days, the driver's pay for a return day, extra
   hours, and the bus/train ticket (passed on at cost, no profit on it).
3. Tick **A partner sent this customer** if a hotel or travel agent did; the
   commission is priced in so your profit still holds.
4. Read out **Tell the customer**, then **Save this price**.

The day rate is the driver's cost plus the minimum profit
(`outstation.minProfitPercent`), rounded up to the next ₹50. A return day is
worked out the same way from what the driver gets for it, and is never below
the lowest return-day price customers were shown. The panel shows
what the driver gets and your profit, in red if it is under the minimum, and
says so if the day rate is above the range customers were shown.

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
| `outstation.returnDay` | 1000–1200 | Per day the driver travels home by bus/train |
| `outstation.extraHour` | 120 | Per hour beyond `hoursPerDay` |
| `outstation.hoursPerDay` | 12 | Driving hours in a day |
| `outstation.mealAllowance` | 100 | Per meal, if the customer does not feed the driver |
| `outstation.kmPerDay` | 400 | Planning distance per driving day |
| `outstation.averageKmh` | 45 | Decides whether a short drop needs a return day |
| `outstation.returnKmPerDay` | 800 | Bus/train distance per day home |
| `outstation.localWithinKm` | 60 | Below this, suggest Local Full Day |
| `outstation.minProfitPercent` | 15 | Floor for the `/admin` calculator and the profit guard |

To add a destination, copy a line in `destinations` in `lib/outstation.ts`
(road and straight-line km from Raipur) and run `npm test`. Never rename an
`id`: bookings store it.
