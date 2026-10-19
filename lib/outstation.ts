/**
 * Outstation trips and one-way car drops: distances, how many days a trip
 * takes, the price ESTIMATE customers see, and the exact QUOTE the team works
 * out in /admin from what the driver actually costs.
 *
 * Pure functions and data, no imports, so the same file runs in the website,
 * in Node tests (scripts/outstation.test.mjs) and, published through
 * /app-config.json, in the mobile app. The rupee amounts come from
 * site-settings.ts and are passed in — none are typed here.
 *
 * How a trip is priced (decided with the owner, 19 Oct 2026):
 *   - One-way distance from the pickup city decides everything. Most trips are
 *     one-way drops: the driver delivers the car and comes home by bus/train.
 *   - Driving days: at least one-way km ÷ kmPerDay (≈ 400 km a day, with
 *     breaks; up to 40 km over doesn't add a day), or the days the customer
 *     books if more (resting, sightseeing).
 *     A round trip drives the distance twice.
 *   - Return days (one-way only): the days the driver spends getting home by
 *     bus or train, charged at a flat non-driving rate. None if the drive and
 *     the ride home fit in one working day (a short drop).
 *   - The customer sees a range; the team quotes the exact price on the call,
 *     from the driver's real cost plus at least the minimum profit.
 */

/* ------------------------------------------------------------- rules ---- */

/** The trip rules from site-settings.ts (`outstation`), plus the per-day price range. */
export type TripRules = {
  /** Customer price per driving day — the range customers are shown. */
  dayRate: { from: number; to: number };
  /**
   * Customer price per return day (the driver travelling home by bus/train,
   * not driving) — a range, as what the driver asks for varies.
   */
  returnDay: { from: number; to: number };
  /** Customer price per hour beyond hoursPerDay on a driving day. */
  extraHour: number;
  /** Hours on duty in one outstation day. */
  hoursPerDay: number;
  /** Planning distance one driver covers in a day, with breaks. */
  kmPerDay: number;
  /** Average highway speed including stops — for "does it fit in one day". */
  averageKmh: number;
  /** How far a driver gets home by bus or train in one day of travel. */
  returnKmPerDay: number;
  /** A destination closer than this (one way) is a local trip, not outstation. */
  localWithinKm: number;
};

/* -------------------------------------------------------- destinations -- */

export type Destination = {
  /** Stable id, saved on bookings. Never rename one. */
  id: string;
  name: string;
  nameHi: string;
  /** For grouping in the picker. */
  region: 'cg' | 'india';
  lat: number;
  lng: number;
  /** One-way road and straight-line distance from Raipur, in km. */
  fromRaipur: { road: number; air: number };
};

/**
 * Popular destinations. Road distances from Raipur: distancebetween2.com,
 * checked 19 Oct 2026 — check a few against Google Maps once a year. Add a
 * place by copying a line; the other pickup cities are worked out from these.
 */
export const destinations: readonly Destination[] = [
  // Chhattisgarh and just across the border
  { id: 'raipur', name: 'Raipur', nameHi: 'रायपुर', region: 'cg', lat: 21.2514, lng: 81.6296, fromRaipur: { road: 0, air: 0 } },
  { id: 'bhilai', name: 'Bhilai', nameHi: 'भिलाई', region: 'cg', lat: 21.1938, lng: 81.3509, fromRaipur: { road: 33, air: 29.6 } },
  { id: 'durg', name: 'Durg', nameHi: 'दुर्ग', region: 'cg', lat: 21.1904, lng: 81.2849, fromRaipur: { road: 40, air: 36.4 } },
  { id: 'mahasamund', name: 'Mahasamund', nameHi: 'महासमुंद', region: 'cg', lat: 21.1074, lng: 82.0948, fromRaipur: { road: 55, air: 51.1 } },
  { id: 'dhamtari', name: 'Dhamtari', nameHi: 'धमतरी', region: 'cg', lat: 20.7076, lng: 81.5494, fromRaipur: { road: 67, air: 61.6 } },
  { id: 'rajnandgaon', name: 'Rajnandgaon', nameHi: 'राजनांदगांव', region: 'cg', lat: 21.0974, lng: 81.0337, fromRaipur: { road: 74, air: 64.5 } },
  { id: 'dongargarh', name: 'Dongargarh', nameHi: 'डोंगरगढ़', region: 'cg', lat: 21.1891, lng: 80.755, fromRaipur: { road: 108, air: 90.5 } },
  { id: 'bilaspur', name: 'Bilaspur', nameHi: 'बिलासपुर', region: 'cg', lat: 22.0797, lng: 82.1409, fromRaipur: { road: 113, air: 106.1 } },
  { id: 'kawardha', name: 'Kawardha', nameHi: 'कवर्धा', region: 'cg', lat: 22.0086, lng: 81.2318, fromRaipur: { road: 116, air: 94.1 } },
  { id: 'kanker', name: 'Kanker', nameHi: 'कांकेर', region: 'cg', lat: 20.2719, lng: 81.492, fromRaipur: { road: 127, air: 109.8 } },
  { id: 'janjgir', name: 'Janjgir', nameHi: 'जांजगीर', region: 'cg', lat: 22.009, lng: 82.5772, fromRaipur: { road: 160, air: 128.9 } },
  { id: 'amarkantak', name: 'Amarkantak', nameHi: 'अमरकंटक', region: 'cg', lat: 22.673, lng: 81.7536, fromRaipur: { road: 209, air: 159.7 } },
  { id: 'korba', name: 'Korba', nameHi: 'कोरबा', region: 'cg', lat: 22.3595, lng: 82.7501, fromRaipur: { road: 216, air: 169 } },
  { id: 'raigarh', name: 'Raigarh', nameHi: 'रायगढ़', region: 'cg', lat: 21.8974, lng: 83.395, fromRaipur: { road: 258, air: 196.2 } },
  { id: 'jagdalpur', name: 'Jagdalpur', nameHi: 'जगदलपुर', region: 'cg', lat: 19.0748, lng: 82.008, fromRaipur: { road: 287, air: 245.3 } },
  { id: 'ambikapur', name: 'Ambikapur', nameHi: 'अंबिकापुर', region: 'cg', lat: 23.1355, lng: 83.182, fromRaipur: { road: 334, air: 263.6 } },
  // Other states
  { id: 'gondia', name: 'Gondia', nameHi: 'गोंदिया', region: 'india', lat: 21.4624, lng: 80.192, fromRaipur: { road: 201, air: 147.9 } },
  { id: 'sambalpur', name: 'Sambalpur', nameHi: 'संबलपुर', region: 'india', lat: 21.4669, lng: 83.9812, fromRaipur: { road: 275, air: 244.8 } },
  { id: 'nagpur', name: 'Nagpur', nameHi: 'नागपुर', region: 'india', lat: 21.1458, lng: 79.0882, fromRaipur: { road: 284, air: 263.8 } },
  { id: 'jharsuguda', name: 'Jharsuguda', nameHi: 'झारसुगुड़ा', region: 'india', lat: 21.8554, lng: 84.0062, fromRaipur: { road: 320, air: 254.9 } },
  { id: 'jabalpur', name: 'Jabalpur', nameHi: 'जबलपुर', region: 'india', lat: 23.1815, lng: 79.9864, fromRaipur: { road: 383, air: 273.5 } },
  { id: 'visakhapatnam', name: 'Visakhapatnam', nameHi: 'विशाखापत्तनम', region: 'india', lat: 17.6868, lng: 83.2185, fromRaipur: { road: 546, air: 430 } },
  { id: 'bhubaneswar', name: 'Bhubaneswar', nameHi: 'भुवनेश्वर', region: 'india', lat: 20.2961, lng: 85.8245, fromRaipur: { road: 547, air: 449 } },
  { id: 'puri', name: 'Puri', nameHi: 'पुरी', region: 'india', lat: 19.8135, lng: 85.8312, fromRaipur: { road: 577, air: 465.9 } },
  { id: 'prayagraj', name: 'Prayagraj', nameHi: 'प्रयागराज', region: 'india', lat: 25.4358, lng: 81.8463, fromRaipur: { road: 578, air: 465.9 } },
  { id: 'ranchi', name: 'Ranchi', nameHi: 'रांची', region: 'india', lat: 23.3441, lng: 85.3096, fromRaipur: { road: 616, air: 444 } },
  { id: 'bhopal', name: 'Bhopal', nameHi: 'भोपाल', region: 'india', lat: 23.2599, lng: 77.4126, fromRaipur: { road: 628, air: 488 } },
  { id: 'varanasi', name: 'Varanasi', nameHi: 'वाराणसी', region: 'india', lat: 25.3176, lng: 82.9739, fromRaipur: { road: 644, air: 472.7 } },
  { id: 'indore', name: 'Indore', nameHi: 'इंदौर', region: 'india', lat: 22.7196, lng: 75.8577, fromRaipur: { road: 727, air: 617.2 } },
  { id: 'patna', name: 'Patna', nameHi: 'पटना', region: 'india', lat: 25.5941, lng: 85.1376, fromRaipur: { road: 739, air: 601 } },
  { id: 'lucknow', name: 'Lucknow', nameHi: 'लखनऊ', region: 'india', lat: 26.8467, lng: 80.9462, fromRaipur: { road: 779, air: 626.2 } },
  { id: 'hyderabad', name: 'Hyderabad', nameHi: 'हैदराबाद', region: 'india', lat: 17.385, lng: 78.4867, fromRaipur: { road: 780, air: 542 } },
  { id: 'kolkata', name: 'Kolkata', nameHi: 'कोलकाता', region: 'india', lat: 22.5726, lng: 88.3639, fromRaipur: { road: 831, air: 710 } },
  { id: 'pune', name: 'Pune', nameHi: 'पुणे', region: 'india', lat: 18.5204, lng: 73.8567, fromRaipur: { road: 1007, air: 867 } },
  { id: 'mumbai', name: 'Mumbai', nameHi: 'मुंबई', region: 'india', lat: 19.076, lng: 72.8777, fromRaipur: { road: 1118, air: 945 } },
  { id: 'delhi', name: 'Delhi', nameHi: 'दिल्ली', region: 'india', lat: 28.6139, lng: 77.209, fromRaipur: { road: 1214, air: 946 } },
  { id: 'bengaluru', name: 'Bengaluru', nameHi: 'बेंगलुरु', region: 'india', lat: 12.9716, lng: 77.5946, fromRaipur: { road: 1370, air: 1015.7 } },
  { id: 'chennai', name: 'Chennai', nameHi: 'चेन्नई', region: 'india', lat: 13.0827, lng: 80.2707, fromRaipur: { road: 1405, air: 920 } },
];

/** The four pickup cities — booking `city` values — and where they are. */
export const pickupCities = ['Raipur', 'Bhilai', 'Durg', 'Bilaspur'] as const;
export type PickupCity = (typeof pickupCities)[number];

export const findDestination = (id: string) => destinations.find((d) => d.id === id);

/* ------------------------------------------------------------ distance -- */

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Straight-line distance in km. */
export function airKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const h =
    Math.sin(toRad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * One-way road distance from a pickup city, in km.
 *
 * From Raipur it is the measured figure. From Bhilai, Durg or Bilaspur it is
 * the shorter of (a) going via Raipur and (b) the straight line scaled by how
 * winding the road to that place is from Raipur — good to about ±10%, which is
 * all an estimate needs; the team confirms on the call.
 */
export function roadKm(from: PickupCity, dest: Destination): number {
  const origin = findDestination(from.toLowerCase());
  if (!origin || origin.id === dest.id) return 0;
  if (origin.id === 'raipur') return dest.fromRaipur.road;
  const viaRaipur = origin.fromRaipur.road + dest.fromRaipur.road;
  const winding =
    dest.fromRaipur.air > 20 ? Math.min(1.5, Math.max(1.05, dest.fromRaipur.road / dest.fromRaipur.air)) : 1.2;
  const direct = airKm(origin, dest) * winding;
  return Math.round(Math.min(viaRaipur, direct) / 10) * 10;
}

/* --------------------------------------------------------------- days ---- */

export type TripKind = 'one-way' | 'round';

export type TripPlan = {
  km: number;
  kind: TripKind;
  /** Closer than localWithinKm: book a local package instead. */
  local: boolean;
  /** The fewest driving days the distance allows. */
  minDays: number;
  /** Driving days charged: minDays, or more if the customer booked more. */
  days: number;
  /** Days the driver spends getting home by bus/train (one-way only). */
  returnDays: number;
};

/**
 * Driving days for a distance: one per kmPerDay, but a little over a full
 * day's drive (up to a tenth of a day, 40 km at 400 km a day) does not add
 * another day — Raipur → Delhi, 1,214 km, is 3 days, not 4.
 */
export function drivingDays(rules: Pick<TripRules, 'kmPerDay'>, km: number): number {
  return Math.max(1, Math.ceil(km / rules.kmPerDay - 0.1));
}

export function planTrip(rules: TripRules, km: number, kind: TripKind, bookedDays = 0): TripPlan {
  const oneWay = Math.max(0, Math.round(km));
  const driveKm = kind === 'round' ? oneWay * 2 : oneWay;
  const minDays = drivingDays(rules, driveKm);
  const days = Math.min(60, Math.max(minDays, Math.floor(bookedDays) || 0));
  return {
    km: oneWay,
    kind,
    local: oneWay < rules.localWithinKm,
    minDays,
    days,
    returnDays: kind === 'one-way' ? returnDays(rules, oneWay) : 0,
  };
}

/**
 * Days the driver spends getting home after a one-way drop. None when the
 * drive and the ride home together fit in one working day (e.g. Bilaspur);
 * otherwise about one day per returnKmPerDay of bus/train travel.
 */
export function returnDays(rules: TripRules, km: number): number {
  if (km <= 0) return 0;
  const sameDay = drivingDays(rules, km) === 1 && (2 * km) / rules.averageKmh <= rules.hoursPerDay;
  return sameDay ? 0 : Math.max(1, Math.ceil(km / rules.returnKmPerDay));
}

/* ----------------------------------------------------------- estimate ---- */

type Money = { from: number; to: number };
export type Estimate = { from: number; to: number; driving: Money; returnCharge: Money };

/** What the customer sees: a range, from the per-day price range. */
export function estimate(rules: TripRules, plan: Pick<TripPlan, 'days' | 'returnDays'>): Estimate {
  const driving = { from: plan.days * rules.dayRate.from, to: plan.days * rules.dayRate.to };
  const returnCharge = { from: plan.returnDays * rules.returnDay.from, to: plan.returnDays * rules.returnDay.to };
  return { from: driving.from + returnCharge.from, to: driving.to + returnCharge.to, driving, returnCharge };
}

/* -------------------------------------------------------------- quote ---- */

export type QuoteInput = {
  /** What this driver charges for one outstation day. */
  driverDayCost: number;
  /** What the driver gets for each return day. */
  driverReturnPay: number;
  days: number;
  returnDays: number;
  /** Hours beyond hoursPerDay, summed over the trip. */
  extraHours: number;
  /** Bus/train ticket home — passed straight through, no profit on it. */
  ticket: number;
  /** % of the booking paid to a partner who sent the customer (0 if none). */
  partnerPercent: number;
  /** The lowest acceptable profit, % of what the customer pays. */
  minProfitPercent: number;
};

export type Quote = {
  dayRate: number;
  /** What the customer pays per return day: the driver's return pay plus the profit, never below returnDay.from. */
  returnDayRate: number;
  extraHourRate: number;
  /** Driver charges the customer pays, before the ticket. */
  charges: number;
  /** charges + ticket — the number to tell the customer. */
  total: number;
  driverPay: number;
  partnerPay: number;
  profit: number;
  /** profit as % of charges, one decimal. */
  profitPercent: number;
  /** profitPercent >= minProfitPercent. */
  ok: boolean;
  /** The day or return-day rate is above the range customers were shown. */
  aboveShownRange: boolean;
};

const roundUpTo = (n: number, step: number) => Math.ceil(n / step - 1e-9) * step;
const whole = (n: number) => Math.max(0, Math.round(Number.isFinite(n) ? n : 0));

/**
 * The exact price for the call: the driver's real day cost plus the minimum
 * profit, rounded up to the next ₹50 a day (₹10 an hour for overtime). A
 * return day is priced the same way from what the driver gets for it, but
 * never below the lowest return-day price customers were shown.
 */
export function quote(rules: TripRules, input: QuoteInput): Quote {
  const days = Math.max(1, whole(input.days));
  const back = whole(input.returnDays);
  const hours = whole(input.extraHours);
  const cost = whole(input.driverDayCost);
  const margin = Math.min(90, Math.max(0, input.minProfitPercent)) / 100;
  const partner = Math.min(50, Math.max(0, input.partnerPercent)) / 100;

  // Price so that what is left after the driver AND the partner is still the margin.
  const keep = 1 - margin - partner;
  const dayRate = roundUpTo(cost / keep, 50);
  const hourCost = cost / rules.hoursPerDay;
  const extraHourRate = Math.max(rules.extraHour, roundUpTo(hourCost / keep, 10));
  const returnDayRate = Math.max(rules.returnDay.from, roundUpTo(whole(input.driverReturnPay) / keep, 50));

  const charges = days * dayRate + back * returnDayRate + hours * extraHourRate;
  const driverPay = Math.round(days * cost + back * whole(input.driverReturnPay) + hours * hourCost);
  const partnerPay = Math.round(charges * partner);
  const profit = charges - driverPay - partnerPay;
  const profitPercent = charges > 0 ? Math.round((profit / charges) * 1000) / 10 : 0;
  return {
    dayRate,
    returnDayRate,
    extraHourRate,
    charges,
    total: charges + whole(input.ticket),
    driverPay,
    partnerPay,
    profit,
    profitPercent,
    ok: profitPercent + 1e-9 >= input.minProfitPercent,
    aboveShownRange: dayRate > rules.dayRate.to || (back > 0 && returnDayRate > rules.returnDay.to),
  };
}

/* ------------------------------------------------------- app publishing -- */

/**
 * Everything the mobile app needs for its estimate, worked out here once so
 * the app and the website can never disagree: for each destination and each
 * pickup city, the km, and the days for a one-way drop and a round trip.
 */
export function destinationTable(rules: TripRules) {
  return destinations.map((d) => ({
    id: d.id,
    name: d.name,
    nameHi: d.nameHi,
    region: d.region,
    from: Object.fromEntries(
      pickupCities.map((city) => {
        const km = roadKm(city, d);
        const one = planTrip(rules, km, 'one-way');
        const round = planTrip(rules, km, 'round');
        return [city, { km, oneWay: { days: one.minDays, returnDays: one.returnDays }, roundDays: round.minDays }];
      }),
    ) as Record<PickupCity, { km: number; oneWay: { days: number; returnDays: number }; roundDays: number }>,
  }));
}
