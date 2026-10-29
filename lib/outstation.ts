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
 * How a trip is priced (decided with the owner, 19 Oct 2026; timings and the
 * hourly rules 28 Oct 2026):
 *   - One-way distance from the pickup city decides everything. Most trips are
 *     one-way drops: the driver delivers the car and comes home by bus/train.
 *   - Driving (one-way): the hours of driving at averageKmh. Each hoursPerDay
 *     of driving (12 h, about 600 km) is one day (dayRate); the hours left
 *     over — or the whole drive, if it is shorter — extraHour each.
 *   - The day price depends on how far the place is (decided 29 Oct 2026):
 *     nearRates for places close by (e.g. up to 150 km ₹1,300–1,400, up to
 *     300 km ₹1,450–1,550), dayRate beyond — see dayRateFor.
 *   - Timings: from the start date and time. Normally he drives 12 hours and
 *     rests 12 (up to an hour more finishes that evening); or, if the customer
 *     wants it, day and night without the rest (same price). That gives the
 *     drop time; then stationHours to the station and the train home: on
 *     train routes the real trains for that date from the lookup (lib/rail.ts,
 *     direct first, then a confirmed change such as Nagpur), applied with
 *     withReturn. Bus routes, and a train route whose lookup cannot confirm a
 *     train, use the typical hours home as a labelled allowance (decided
 *     29 Oct 2026: no train times are typed into this file).
 *   - The way home (one-way): from the drop until he is home — the waiting
 *     included — each 24 hours a day (returnMaxPerDay); the hours left over
 *     returnHour each up to returnFullDayAfter (6), more = a full day.
 *   - Round trips: the days of the trip (the driver is with the customer).
 *   - The customer books and pays for the driver's ticket home. The FINAL bill
 *     uses the real times; the estimate predicts them.
 *   - Final bill (finalBill, decided 29 Oct 2026): the driver taps Start, Drop
 *     and Home on his trip link. Driving is start → drop: each 24 h is a day
 *     (12 driving, 12 rest) and what is left after the last 24 is driving
 *     (12 h a day, the rest by the hour); day and night: every 12 h a day.
 *     The first 15 minutes of an hour are free. Round trips: start → back,
 *     the same way, at least one day.
 *   - The customer sees an estimate; the team quotes the exact price on the
 *     call, from the driver's real cost plus at least the minimum profit.
 */

/* ------------------------------------------------------------- rules ---- */

/** The trip rules from site-settings.ts (`outstation`), plus the per-day price range. */
export type TripRules = {
  /** Customer price per day (24 h from the start, up to hoursPerDay driving) for places farther than the last nearRates tier. */
  dayRate: { from: number; to: number };
  /**
   * Cheaper days for places closer by, nearest first: up to `upToKm` (one
   * way, by road, from the pickup city) a day is from–to. Left out: dayRate
   * everywhere. See dayRateFor.
   */
  nearRates?: readonly NearRate[];
  /** Customer price per hour of the driver's way home (one-way: from the drop until he is home). */
  returnHour: number;
  /** The most the way home costs in any 24 hours. */
  returnMaxPerDay: number;
  /**
   * The way home's hours left over after its full days (24 h each, at
   * returnMaxPerDay): up to this many are charged by the hour, more count as
   * a full day (decided 29 Oct 2026: 6).
   */
  returnFullDayAfter: number;
  /**
   * Driving hours left over after the full days: up to this many at
   * extraHour, more count as one more full day at dayRate (decided
   * 29 Oct 2026: 7). A shorter drive than this is all by the hour.
   */
  extraFullDayAfter: number;
  /** Customer price per driving hour beyond the full days (and after the first hours of a short drive). */
  extraHour: number;
  /**
   * A one-way drive shorter than a day (decided 29 Oct 2026): up to
   * `firstHours` cost `firstPrice` (the 3-hour package, ₹600), each hour after
   * that extraHour, and more than `localDayAfter` hours a local full day
   * (`localDay`, ₹1,000–1,200). Left out: the whole drive at extraHour.
   * His way home is charged on top, as for every one-way drop.
   */
  shortDrive?: { firstHours: number; firstPrice: number; localDayAfter: number; localDay: { from: number; to: number } };
  /** Driving hours in one outstation day. */
  hoursPerDay: number;
  /** A round trip with up to this many hours of driving in all is back within the 24 hours: one day. */
  sameDayMaxHours: number;
  /** Planning distance one driver covers in a day, with breaks. */
  kmPerDay: number;
  /** Average highway speed including stops. */
  averageKmh: number;
  /** Average bus/train speed on the way home, including stops. */
  busKmh: number;
  /** Getting to the bus stand or station and waiting, hours. */
  stationHours: number;
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
  /**
   * The driver's way home after a one-way drop: how he usually travels, and a
   * typical number of hours on board to Raipur, to Durg (also used for
   * Bhilai) and to Bilaspur. These are an ALLOWANCE for the estimate when no
   * train can be confirmed (and for bus routes): never shown as a train or a
   * timetable. Getting to the station (stationHours) is added on top.
   */
  home: {
    by: 'train' | 'bus' | 'bus + train';
    raipur: number;
    durg: number;
    bilaspur: number;
  };
  /**
   * Train routes: the destination's stations (Indian Railways codes, the main
   * one first) where the driver can board, and change stations (`hubs`) for
   * a connection when no direct train leaves soon enough. The trains and their
   * times come from the live lookup for the drop date (lib/rail.ts) — none
   * are typed in here.
   */
  rail?: { stations: readonly string[]; hubs?: readonly string[] };
};

/** The pickup cities' home stations: Bhilai drivers come home to Durg, the nearest main station. */
export const pickupStations = { Raipur: 'R', Bhilai: 'DURG', Durg: 'DURG', Bilaspur: 'BSP' } as const;

/**
 * Popular destinations. Road distances from Raipur: distancebetween2.com,
 * checked 19 Oct 2026 — check a few against Google Maps once a year. The
 * typical hours home (the allowance) from erail.in, redBus, AbhiBus, ixigo,
 * checked 20 Oct 2026. Station codes: Indian Railways. Add a place by copying
 * a line; the other pickup cities' distances are worked out from these.
 */
export const destinations: readonly Destination[] = [
  // Chhattisgarh and just across the border
  { id: 'raipur', name: 'Raipur', nameHi: 'रायपुर', region: 'cg', lat: 21.2514, lng: 81.6296, fromRaipur: { road: 0, air: 0 }, home: { by: 'train', raipur: 0, durg: 0.75, bilaspur: 1.5 } },
  { id: 'bhilai', name: 'Bhilai', nameHi: 'भिलाई', region: 'cg', lat: 21.1938, lng: 81.3509, fromRaipur: { road: 33, air: 29.6 }, home: { by: 'train', raipur: 0.75, durg: 0.3, bilaspur: 2.75 } },
  { id: 'durg', name: 'Durg', nameHi: 'दुर्ग', region: 'cg', lat: 21.1904, lng: 81.2849, fromRaipur: { road: 40, air: 36.4 }, home: { by: 'train', raipur: 0.75, durg: 0, bilaspur: 2.75 } },
  { id: 'mahasamund', name: 'Mahasamund', nameHi: 'महासमुंद', region: 'cg', lat: 21.1074, lng: 82.0948, fromRaipur: { road: 55, air: 51.1 }, home: { by: 'bus', raipur: 1.5, durg: 2.5, bilaspur: 3.5 } },
  { id: 'dhamtari', name: 'Dhamtari', nameHi: 'धमतरी', region: 'cg', lat: 20.7076, lng: 81.5494, fromRaipur: { road: 67, air: 61.6 }, home: { by: 'bus', raipur: 2, durg: 2.25, bilaspur: 4 } },
  { id: 'rajnandgaon', name: 'Rajnandgaon', nameHi: 'राजनांदगांव', region: 'cg', lat: 21.0974, lng: 81.0337, fromRaipur: { road: 74, air: 64.5 }, home: { by: 'train', raipur: 1.5, durg: 0.75, bilaspur: 3 }, rail: { stations: ['RJN'] } },
  { id: 'dongargarh', name: 'Dongargarh', nameHi: 'डोंगरगढ़', region: 'cg', lat: 21.1891, lng: 80.755, fromRaipur: { road: 108, air: 90.5 }, home: { by: 'train', raipur: 2, durg: 1.25, bilaspur: 3.75 }, rail: { stations: ['DGG'] } },
  { id: 'bilaspur', name: 'Bilaspur', nameHi: 'बिलासपुर', region: 'cg', lat: 22.0797, lng: 82.1409, fromRaipur: { road: 113, air: 106.1 }, home: { by: 'train', raipur: 1.5, durg: 2.5, bilaspur: 0 }, rail: { stations: ['BSP'] } },
  { id: 'kawardha', name: 'Kawardha', nameHi: 'कवर्धा', region: 'cg', lat: 22.0086, lng: 81.2318, fromRaipur: { road: 116, air: 94.1 }, home: { by: 'bus', raipur: 3, durg: 2.75, bilaspur: 3.25 } },
  { id: 'kanker', name: 'Kanker', nameHi: 'कांकेर', region: 'cg', lat: 20.2719, lng: 81.492, fromRaipur: { road: 127, air: 109.8 }, home: { by: 'bus', raipur: 3.5, durg: 3.75, bilaspur: 5.5 } },
  { id: 'janjgir', name: 'Janjgir', nameHi: 'जांजगीर', region: 'cg', lat: 22.009, lng: 82.5772, fromRaipur: { road: 160, air: 128.9 }, home: { by: 'train', raipur: 3, durg: 3.5, bilaspur: 1 }, rail: { stations: ['NIA'] } },
  { id: 'amarkantak', name: 'Amarkantak', nameHi: 'अमरकंटक', region: 'cg', lat: 22.673, lng: 81.7536, fromRaipur: { road: 209, air: 159.7 }, home: { by: 'bus + train', raipur: 5.5, durg: 6.5, bilaspur: 3 } },
  { id: 'korba', name: 'Korba', nameHi: 'कोरबा', region: 'cg', lat: 22.3595, lng: 82.7501, fromRaipur: { road: 216, air: 169 }, home: { by: 'train', raipur: 4, durg: 4.75, bilaspur: 2 }, rail: { stations: ['KRBA'] } },
  { id: 'raigarh', name: 'Raigarh', nameHi: 'रायगढ़', region: 'cg', lat: 21.8974, lng: 83.395, fromRaipur: { road: 258, air: 196.2 }, home: { by: 'train', raipur: 4, durg: 4.5, bilaspur: 2.25 }, rail: { stations: ['RIG'] } },
  { id: 'jagdalpur', name: 'Jagdalpur', nameHi: 'जगदलपुर', region: 'cg', lat: 19.0748, lng: 82.008, fromRaipur: { road: 287, air: 245.3 }, home: { by: 'bus', raipur: 7, durg: 8, bilaspur: 9 } },
  { id: 'ambikapur', name: 'Ambikapur', nameHi: 'अंबिकापुर', region: 'cg', lat: 23.1355, lng: 83.182, fromRaipur: { road: 334, air: 263.6 }, home: { by: 'bus', raipur: 7.5, durg: 8.5, bilaspur: 5.25 } },
  // Other states
  { id: 'gondia', name: 'Gondia', nameHi: 'गोंदिया', region: 'india', lat: 21.4624, lng: 80.192, fromRaipur: { road: 201, air: 147.9 }, home: { by: 'train', raipur: 3, durg: 2.25, bilaspur: 4.5 }, rail: { stations: ['G'] } },
  { id: 'sambalpur', name: 'Sambalpur', nameHi: 'संबलपुर', region: 'india', lat: 21.4669, lng: 83.9812, fromRaipur: { road: 275, air: 244.8 }, home: { by: 'bus', raipur: 6, durg: 6.5, bilaspur: 4.5 } },
  { id: 'nagpur', name: 'Nagpur', nameHi: 'नागपुर', region: 'india', lat: 21.1458, lng: 79.0882, fromRaipur: { road: 284, air: 263.8 }, home: { by: 'train', raipur: 5, durg: 4.25, bilaspur: 6.5 }, rail: { stations: ['NGP'] } },
  { id: 'jharsuguda', name: 'Jharsuguda', nameHi: 'झारसुगुड़ा', region: 'india', lat: 21.8554, lng: 84.0062, fromRaipur: { road: 320, air: 254.9 }, home: { by: 'train', raipur: 5, durg: 6, bilaspur: 3.25 }, rail: { stations: ['JSG'] } },
  { id: 'jabalpur', name: 'Jabalpur', nameHi: 'जबलपुर', region: 'india', lat: 23.1815, lng: 79.9864, fromRaipur: { road: 383, air: 273.5 }, home: { by: 'train', raipur: 9, durg: 8.5, bilaspur: 8.5 }, rail: { stations: ['JBP'] } },
  { id: 'visakhapatnam', name: 'Visakhapatnam', nameHi: 'विशाखापत्तनम', region: 'india', lat: 17.6868, lng: 83.2185, fromRaipur: { road: 546, air: 430 }, home: { by: 'train', raipur: 10, durg: 11, bilaspur: 12 }, rail: { stations: ['VSKP'] } },
  { id: 'bhubaneswar', name: 'Bhubaneswar', nameHi: 'भुवनेश्वर', region: 'india', lat: 20.2961, lng: 85.8245, fromRaipur: { road: 547, air: 449 }, home: { by: 'bus', raipur: 11.5, durg: 12.25, bilaspur: 13.5 } },
  { id: 'puri', name: 'Puri', nameHi: 'पुरी', region: 'india', lat: 19.8135, lng: 85.8312, fromRaipur: { road: 577, air: 465.9 }, home: { by: 'bus', raipur: 13, durg: 13.75, bilaspur: 15 } },
  { id: 'prayagraj', name: 'Prayagraj', nameHi: 'प्रयागराज', region: 'india', lat: 25.4358, lng: 81.8463, fromRaipur: { road: 578, air: 465.9 }, home: { by: 'train', raipur: 13.5, durg: 14.5, bilaspur: 11.5 }, rail: { stations: ['PRYJ'] } },
  { id: 'ranchi', name: 'Ranchi', nameHi: 'रांची', region: 'india', lat: 23.3441, lng: 85.3096, fromRaipur: { road: 616, air: 444 }, home: { by: 'bus', raipur: 12, durg: 12.5, bilaspur: 10 } },
  { id: 'bhopal', name: 'Bhopal', nameHi: 'भोपाल', region: 'india', lat: 23.2599, lng: 77.4126, fromRaipur: { road: 628, air: 488 }, home: { by: 'bus', raipur: 11.75, durg: 12, bilaspur: 13 } },
  { id: 'varanasi', name: 'Varanasi', nameHi: 'वाराणसी', region: 'india', lat: 25.3176, lng: 82.9739, fromRaipur: { road: 644, air: 472.7 }, home: { by: 'train', raipur: 17, durg: 18, bilaspur: 15 }, rail: { stations: ['BSB'] } },
  { id: 'indore', name: 'Indore', nameHi: 'इंदौर', region: 'india', lat: 22.7196, lng: 75.8577, fromRaipur: { road: 727, air: 617.2 }, home: { by: 'bus', raipur: 16.5, durg: 17.25, bilaspur: 18.5 } },
  { id: 'patna', name: 'Patna', nameHi: 'पटना', region: 'india', lat: 25.5941, lng: 85.1376, fromRaipur: { road: 739, air: 601 }, home: { by: 'bus', raipur: 19, durg: 19.75, bilaspur: 21 } },
  { id: 'lucknow', name: 'Lucknow', nameHi: 'लखनऊ', region: 'india', lat: 26.8467, lng: 80.9462, fromRaipur: { road: 779, air: 626.2 }, home: { by: 'train', raipur: 20, durg: 21, bilaspur: 18 }, rail: { stations: ['LKO', 'LJN'] } },
  { id: 'hyderabad', name: 'Hyderabad', nameHi: 'हैदराबाद', region: 'india', lat: 17.385, lng: 78.4867, fromRaipur: { road: 780, air: 542 }, home: { by: 'train', raipur: 15, durg: 15, bilaspur: 16.5 }, rail: { stations: ['SC', 'HYB', 'KCG'], hubs: ['NGP'] } },
  { id: 'kolkata', name: 'Kolkata', nameHi: 'कोलकाता', region: 'india', lat: 22.5726, lng: 88.3639, fromRaipur: { road: 831, air: 710 }, home: { by: 'train', raipur: 13.25, durg: 14.25, bilaspur: 11.25 }, rail: { stations: ['HWH', 'SHM'] } },
  { id: 'pune', name: 'Pune', nameHi: 'पुणे', region: 'india', lat: 18.5204, lng: 73.8567, fromRaipur: { road: 1007, air: 867 }, home: { by: 'train', raipur: 20, durg: 19.5, bilaspur: 22 }, rail: { stations: ['PUNE'], hubs: ['NGP'] } },
  { id: 'mumbai', name: 'Mumbai', nameHi: 'मुंबई', region: 'india', lat: 19.076, lng: 72.8777, fromRaipur: { road: 1118, air: 945 }, home: { by: 'train', raipur: 18, durg: 17.25, bilaspur: 20.5 }, rail: { stations: ['CSMT', 'LTT'], hubs: ['NGP'] } },
  { id: 'delhi', name: 'Delhi', nameHi: 'दिल्ली', region: 'india', lat: 28.6139, lng: 77.209, fromRaipur: { road: 1214, air: 946 }, home: { by: 'train', raipur: 22.5, durg: 22, bilaspur: 21 }, rail: { stations: ['NDLS', 'NZM'], hubs: ['NGP'] } },
  { id: 'bengaluru', name: 'Bengaluru', nameHi: 'बेंगलुरु', region: 'india', lat: 12.9716, lng: 77.5946, fromRaipur: { road: 1370, air: 1015.7 }, home: { by: 'train', raipur: 28, durg: 27.25, bilaspur: 30 }, rail: { stations: ['SMVB', 'SBC', 'YPR'], hubs: ['NGP'] } },
  { id: 'chennai', name: 'Chennai', nameHi: 'चेन्नई', region: 'india', lat: 13.0827, lng: 80.2707, fromRaipur: { road: 1405, air: 920 }, home: { by: 'train', raipur: 23, durg: 22.25, bilaspur: 25 }, rail: { stations: ['MAS'], hubs: ['NGP'] } },
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
  /** The fewest calendar days the trip takes. */
  minDays: number;
  /** Calendar days: minDays, or more if the customer booked more. */
  days: number;
  /** Charged at dayRate: one-way, each full hoursPerDay of driving (or the days booked); round trips, the days. */
  fullDays: number;
  /** One-way: driving hours beyond the full days (or of a drive shorter than a day), at extraHour. */
  extraHours: number;
  /** One-way: hours of driving in all. */
  driveHours: number;
  /** One-way: day and night, without the night's rest. */
  nonstop: boolean;
  /** One-way: whole hours from the drop until he is home (his way home, the waiting included). */
  returnHours: number;
  /** The start: hour of the day (7.5 = 7:30 AM) and, if known, the weekday (0 = Sunday). */
  startHour: number;
  weekday?: number;
  /** One-way: hours after the start when he drops the car, leaves by train/bus and is home. */
  dropAt?: number;
  leaveAt?: number;
  homeAt?: number;
  /**
   * One-way: where leaveAt/homeAt come from — 'allowance' (getting to the
   * station, then the typical hours home; no train confirmed) or 'train' (a
   * train from the lookup, set by withReturn).
   */
  homeBasis?: 'allowance' | 'train';
};

/** When nothing better is known, the estimate assumes the driver leaves at 7 AM. */
export const DEFAULT_START_HOUR = 7;

/** When the driver leaves: the hour of the day and, if the date is known, the weekday (0 = Sunday). */
export type TripStart = { hour: number; weekday?: number };

/** A day price for places up to `upToKm` away (one way, by road). */
export type NearRate = { upToKm: number; from: number; to: number };

/**
 * The day price for a place `km` away (one way, by road, from the pickup
 * city): the first nearby tier it falls in, else dayRate. A place not in the
 * list (km 0, unknown) gets dayRate — the team quotes it on the call.
 *   Bilaspur 113 km → ₹1,300–1,400; Nagpur 284 km → ₹1,450–1,550;
 *   Jabalpur 383 km → ₹1,550–1,650.
 */
export function dayRateFor(rules: Pick<TripRules, 'dayRate' | 'nearRates'>, km: number | undefined): { from: number; to: number } {
  const d = Math.round(Number(km) || 0);
  const tier = d > 0 ? rules.nearRates?.find((t) => d <= t.upToKm) : undefined;
  return tier ? { from: tier.from, to: tier.to } : { from: rules.dayRate.from, to: rules.dayRate.to };
}

/**
 * The driving charge of a one-way drive shorter than a day (`hours` whole
 * hours, no full days), as a range: up to firstHours the 3-hour package,
 * then `hourRate` an hour, and more than localDayAfter a local full day.
 *   1–3 h → ₹600; 5 h → ₹600 + 2 × ₹120 = ₹840; 6 h → ₹960; 7 h → ₹1,000–1,200.
 * `hourRate`: extraHour, or the agreed rate on a quote or bill. Without
 * rules.shortDrive (older settings): hours × hourRate.
 */
export function shortDriveCharge(
  rules: Pick<TripRules, 'extraHour' | 'shortDrive'>,
  hours: number,
  hourRate: number = rules.extraHour,
): { from: number; to: number } {
  const h = Math.max(0, Math.round(Number.isFinite(hours) ? hours : 0));
  const s = rules.shortDrive;
  if (h === 0) return { from: 0, to: 0 };
  if (!s) return { from: h * hourRate, to: h * hourRate };
  if (h > s.localDayAfter) return { from: s.localDay.from, to: s.localDay.to };
  const n = s.firstPrice + Math.max(0, h - s.firstHours) * hourRate;
  return { from: n, to: n };
}

/**
 * A short drive's charge in words: "3 h of driving: up to 3 h = ₹600",
 * "5 h of driving: ₹600 for the first 3 h + 2 h × ₹120", "7 h of driving:
 * more than 6 h = a local full day". `money` formats rupees.
 */
export function shortDriveWords(
  rules: Pick<TripRules, 'extraHour' | 'shortDrive'>,
  hours: number,
  money: (n: number) => string,
  hourRate: number = rules.extraHour,
): string {
  const h = Math.max(0, Math.round(Number.isFinite(hours) ? hours : 0));
  const s = rules.shortDrive;
  if (!s) return `${h} driving ${h === 1 ? 'hour' : 'hours'} × ${money(hourRate)}`;
  if (h <= s.firstHours) return `${h} h of driving: up to ${s.firstHours} h = ${money(s.firstPrice)}`;
  if (h <= s.localDayAfter)
    return `${h} h of driving: ${money(s.firstPrice)} for the first ${s.firstHours} h + ${h - s.firstHours} h × ${money(hourRate)}`;
  return `${h} h of driving: more than ${s.localDayAfter} h = a local full day`;
}

/** Hours of driving for a distance, at averageKmh. */
export const driveHours = (rules: Pick<TripRules, 'averageKmh'>, km: number) => km / rules.averageKmh;

/**
 * Days of driving for a distance, for round trips: one per kmPerDay, but a
 * little over a full day's drive (up to a tenth of a day) does not add one.
 */
export function drivingDays(rules: Pick<TripRules, 'kmPerDay'>, km: number): number {
  return Math.max(1, Math.ceil(km / rules.kmPerDay - 0.1));
}

/**
 * The fewest days for a round trip. Each day covers the driver's 24 hours from
 * the start, so a round trip he finishes within them is ONE day: there and back
 * in up to sameDayMaxHours of driving (Jharsuguda, 320 km each way → 1 day;
 * Nagpur → 1 day). Longer ones need a night away: the driving days for twice
 * the distance (Bhopal and back: 3 days).
 */
export function roundTripDays(rules: TripRules, km: number): number {
  return driveHours(rules, 2 * km) <= rules.sameDayMaxHours + 1e-9 ? 1 : drivingDays(rules, 2 * km);
}

/**
 * Hours on the train/bus home from a destination to a pickup city (Bhilai uses
 * the Durg times — the next station). Undefined for an unknown place.
 */
export function homeTravelHours(dest: Destination | undefined, city: PickupCity): number | undefined {
  if (!dest) return undefined;
  return city === 'Raipur' ? dest.home.raipur : city === 'Bilaspur' ? dest.home.bilaspur : dest.home.durg;
}

/** How the driver gets home from `dest` to `city`, for planTrip: the allowance in hours. */
export type HomeWay = {
  /** Typical hours on board (homeTravelHours). Left out: the distance at busKmh. */
  hours?: number;
};

/** The allowance for the way home from a destination to a pickup city. */
export function homeWay(dest: Destination, city: PickupCity): HomeWay {
  return { hours: homeTravelHours(dest, city) ?? 0 };
}

/**
 * When he drops the car, hours after the start, for `hours` of driving:
 * day and night (`nonstop`) straight through; otherwise hoursPerDay of
 * driving and the rest of the 24 hours resting, but up to an hour more he
 * finishes that evening rather than stop for the night. `extraDays`: days
 * the customer booked on top (stops on the way) move the drop on.
 */
export function dropTime(rules: Pick<TripRules, 'hoursPerDay'>, hours: number, nonstop = false, extraDays = 0): number {
  if (nonstop) return hours + extraDays * 24;
  const day = rules.hoursPerDay;
  const full = Math.floor(hours / day + 1e-9);
  const rest = hours - full * day;
  let at: number;
  if (full === 0) at = hours;
  else if (rest <= 1e-9) at = (full - 1) * 24 + day;
  else if (rest <= 1 + 1e-9) at = (full - 1) * 24 + day + rest;
  else at = full * 24 + rest;
  return at + extraDays * 24;
}

/**
 * The plan for a trip, from the start (hour of the day and, if known, the
 * weekday; a plain number is the hour) — see the rules at the top. The way
 * home is the ALLOWANCE (stationHours, then the typical hours home); a train
 * confirmed by the lookup replaces it through withReturn.
 *
 *   Mumbai, 7 AM: 22.4 h of driving = 1 day + 11 h; drops the car ~5:20 PM
 *   on day 2; allowance 1 + 18 h home: 19 h from the drop.
 *   Nagpur: 5.7 h of driving = 6 h at extraHour; allowance 1 + 5 h home.
 */
export function planTrip(
  rules: TripRules,
  km: number,
  kind: TripKind,
  bookedDays = 0,
  home: HomeWay | number = {},
  startAt: TripStart | number = DEFAULT_START_HOUR,
  nonstop = false,
): TripPlan {
  const way: HomeWay = typeof home === 'number' ? { hours: home } : home;
  const raw = typeof startAt === 'number' ? { hour: startAt } : startAt;
  const start: TripStart = {
    hour: Number.isFinite(raw.hour) ? ((raw.hour % 24) + 24) % 24 : DEFAULT_START_HOUR,
    ...(Number.isInteger(raw.weekday) && raw.weekday! >= 0 && raw.weekday! <= 6 && { weekday: raw.weekday }),
  };
  const oneWay = Math.max(0, Math.round(km));
  const booked = Math.min(60, Math.max(0, Math.floor(bookedDays) || 0));
  const base = {
    km: oneWay,
    kind,
    local: oneWay < rules.localWithinKm,
    startHour: start.hour,
    ...(start.weekday !== undefined && { weekday: start.weekday }),
  };

  if (kind === 'round' || oneWay <= 0) {
    const minDays = kind === 'round' ? roundTripDays(rules, oneWay) : 1;
    const days = Math.max(minDays, booked);
    return { ...base, minDays, days, fullDays: days, extraHours: 0, driveHours: 0, nonstop: false, returnHours: 0 };
  }

  // Driving: each hoursPerDay is a day, the rest by the hour.
  const hours = driveHours(rules, oneWay);
  const full = Math.floor(hours / rules.hoursPerDay + 1e-9);
  const rest = hours - full * rules.hoursPerDay;
  const leftover = rest > 1e-9 ? Math.ceil(rest - 1e-9) : 0;
  const lastDayAt = dropTime(rules, hours, nonstop);
  // Calendar days he is driving (24 h each from the start).
  const calendar = nonstop
    ? Math.max(1, Math.ceil((lastDayAt - 1e-9) / 24))
    : full + (rest > 1 + 1e-9 || full === 0 ? 1 : 0);
  const extraDays = booked > calendar ? booked - calendar : 0;
  // More than extraFullDayAfter hours left over: one more full day instead of the hours.
  const roundUp = leftover > (rules.extraFullDayAfter ?? 24);
  const fullDays = extraDays > 0 ? booked : full + (roundUp ? 1 : 0);
  const extraHours = extraDays > 0 || roundUp ? 0 : leftover;

  // The way home (the allowance): getting to the station, then the typical hours home.
  const dropAt = lastDayAt + (nonstop ? 0 : extraDays * 24);
  const leaveAt = dropAt + rules.stationHours;
  const homeAt = leaveAt + (way.hours || oneWay / rules.busKmh);
  return {
    ...base,
    minDays: calendar,
    days: calendar + extraDays,
    fullDays,
    extraHours,
    driveHours: hours,
    nonstop,
    returnHours: Math.max(0, Math.ceil(homeAt - dropAt - 1e-9)),
    dropAt,
    leaveAt,
    homeAt,
    homeBasis: 'allowance',
  };
}

/**
 * The plan with a train from the lookup instead of the allowance: `leaveAt`
 * and `homeAt` in hours after the start (the train's departure and its
 * arrival home). The way home is then whole hours from the drop to homeAt.
 */
export function withReturn(plan: TripPlan, leaveAt: number, homeAt: number): TripPlan {
  if (plan.kind !== 'one-way' || plan.dropAt === undefined || !(homeAt > plan.dropAt)) return plan;
  return {
    ...plan,
    leaveAt,
    homeAt,
    returnHours: Math.max(0, Math.ceil(homeAt - plan.dropAt - 1e-9)),
    homeBasis: 'train',
  };
}

/**
 * The way home's charge in words: "2 days × ₹1,200 (1 day + 14 h; more than
 * 6 h left over = a full day)", "1 day × ₹1,200 + 5 h × ₹120", "6 h × ₹120".
 * `money` formats rupees (passed in: this file has no formatting).
 */
export function returnWords(
  hours: number,
  rate: number,
  maxPerDay: number,
  fullDayAfter: number,
  money: (n: number) => string,
): string {
  const h = Math.max(0, Math.round(Number.isFinite(hours) ? hours : 0));
  const days = Math.floor(h / 24);
  const left = h - days * 24;
  const day = Math.min(24 * rate, maxPerDay);
  const d = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
  if (left > fullDayAfter)
    return `${d(days + 1)} × ${money(day)} (${days ? `${d(days)} + ` : ''}${left} h; more than ${fullDayAfter} h left over = a full day)`;
  const parts = [days ? `${d(days)} × ${money(day)}` : null, left ? `${left} h × ${money(rate)}` : null].filter(Boolean);
  return parts.join(' + ') || 'no charge';
}

/**
 * What `hours` of the way home cost: each full 24 hours is a day
 * (`maxPerDay`); the hours left over are `rate` each up to `fullDayAfter`,
 * and more than that count as one more day (never more than a day).
 *   6 → 6 × ₹120 = ₹720;  8 → ₹1,200;  32 → ₹1,200 + ₹1,200;  56 → ₹3,600.
 */
export function returnCost(hours: number, rate: number, maxPerDay: number, fullDayAfter = 24): number {
  const h = Math.max(0, Math.round(Number.isFinite(hours) ? hours : 0));
  const fullDays = Math.floor(h / 24);
  const left = h - 24 * fullDays;
  const day = Math.min(24 * rate, maxPerDay);
  return fullDays * day + (left > fullDayAfter ? day : Math.min(left * rate, maxPerDay));
}

/* ----------------------------------------------------------- estimate ---- */

type Money = { from: number; to: number };
export type Estimate = {
  from: number;
  to: number;
  /** The full days at dayRate, plus the extra driving hours. */
  driving: Money;
  /** The extra driving hours alone (a drive shorter than a day: its whole charge, the low end). */
  extraCharge: number;
  /** The way home (one-way). */
  returnCharge: number;
};

/** What the customer sees: a range, from the per-day price range for the distance, plus the extra hours and the way home. */
export function estimate(
  rules: TripRules,
  plan: Pick<TripPlan, 'fullDays' | 'extraHours' | 'returnHours'> & Partial<Pick<TripPlan, 'km'>>,
): Estimate {
  const rate = dayRateFor(rules, plan.km);
  // A one-way drive shorter than a day: the 3-hour package, then by the hour, then a local day.
  const short = plan.fullDays === 0 ? shortDriveCharge(rules, plan.extraHours) : undefined;
  const extraCharge = short ? short.from : plan.extraHours * rules.extraHour;
  const driving = short
    ? short
    : { from: plan.fullDays * rate.from + extraCharge, to: plan.fullDays * rate.to + extraCharge };
  const returnCharge = returnCost(plan.returnHours, rules.returnHour, rules.returnMaxPerDay, rules.returnFullDayAfter);
  return { from: driving.from + returnCharge, to: driving.to + returnCharge, driving, extraCharge, returnCharge };
}

/* -------------------------------------------------------------- quote ---- */

export type QuoteInput = {
  /** What this driver charges for one outstation day. */
  driverDayCost: number;
  /** What the driver gets per hour of his way home (at most 10 of them in any 24 hours). */
  driverReturnHourPay: number;
  /** Full days at the day rate. */
  days: number;
  /** One-way: hours from the drop until he is home. */
  returnHours: number;
  /** Driving hours beyond the full days (and any overtime), summed over the trip. */
  extraHours: number;
  /** Bus/train ticket home — passed straight through, no profit on it. */
  ticket: number;
  /** % of the booking paid to a partner who sent the customer (0 if none). */
  partnerPercent: number;
  /** The lowest acceptable profit, % of what the customer pays. */
  minProfitPercent: number;
  /** One-way road km to the place, for the day price customers were shown (dayRateFor). */
  km?: number;
};

export type Quote = {
  dayRate: number;
  /** The full days charged (0 for a drive shorter than a day). */
  days: number;
  /** Customer price per hour of the way home: the driver's pay plus the profit, never below returnHour. */
  returnHourRate: number;
  /** The extra driving hours: hours × extraHourRate, but a drive shorter than a day never below the short-drive price. */
  extraCharge: number;
  /** The way home, to the customer, with the daily maximum. */
  returnCharge: number;
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
  /** The day or return-hour rate is above what customers were shown. */
  aboveShownRange: boolean;
};

const roundUpTo = (n: number, step: number) => Math.ceil(n / step - 1e-9) * step;
const whole = (n: number) => Math.max(0, Math.round(Number.isFinite(n) ? n : 0));

/**
 * The exact price for the call: the driver's real day cost plus the minimum
 * profit, rounded up to the next ₹50 a day (₹10 an hour for extra driving
 * hours and the way home). The way home keeps the same daily maximum in hours
 * as customers were shown (returnMaxPerDay ÷ returnHour, 10), for the driver
 * and the customer alike.
 */
export function quote(rules: TripRules, input: QuoteInput): Quote {
  const back = whole(input.returnHours);
  const typedHours = whole(input.extraHours);
  // More than extraFullDayAfter driving hours left over are one more full day.
  const roundUp = typedHours > (rules.extraFullDayAfter ?? 24);
  const hours = roundUp ? 0 : typedHours;
  // 0 full days is a drive shorter than a day, priced by the hour; nothing at all is one day.
  const days = Math.min(60, whole(input.days) + (roundUp ? 1 : 0) || (hours > 0 ? 0 : 1));
  const cost = whole(input.driverDayCost);
  const backPay = whole(input.driverReturnHourPay);
  const margin = Math.min(90, Math.max(0, input.minProfitPercent)) / 100;
  const partner = Math.min(50, Math.max(0, input.partnerPercent)) / 100;

  // Price so that what is left after the driver AND the partner is still the margin.
  const keep = 1 - margin - partner;
  const dayRate = roundUpTo(cost / keep, 50);
  const hourCost = cost / rules.hoursPerDay;
  const extraHourRate = Math.max(rules.extraHour, roundUpTo(hourCost / keep, 10));
  const returnHourRate = Math.max(rules.returnHour, roundUpTo(backPay / keep, 10));
  const capHours = rules.returnMaxPerDay / rules.returnHour;
  const returnCharge = returnCost(back, returnHourRate, returnHourRate * capHours, rules.returnFullDayAfter);

  // A drive shorter than a day never costs less than customers were shown (₹600 for 3 h, …).
  const short = days === 0 && hours > 0 ? shortDriveCharge(rules, hours) : undefined;
  const extraCharge = Math.max(hours * extraHourRate, short?.from ?? 0);
  const charges = days * dayRate + returnCharge + extraCharge;
  const driverPay = Math.round(
    days * cost + returnCost(back, backPay, backPay * capHours, rules.returnFullDayAfter) + hours * hourCost,
  );
  const partnerPay = Math.round(charges * partner);
  const profit = charges - driverPay - partnerPay;
  const profitPercent = charges > 0 ? Math.round((profit / charges) * 1000) / 10 : 0;
  return {
    dayRate,
    days,
    returnHourRate,
    returnCharge,
    extraHourRate,
    extraCharge,
    charges,
    total: charges + whole(input.ticket),
    driverPay,
    partnerPay,
    profit,
    profitPercent,
    ok: profitPercent + 1e-9 >= input.minProfitPercent,
    aboveShownRange:
      (days > 0 && dayRate > dayRateFor(rules, input.km).to) ||
      (short !== undefined && extraCharge > short.to) ||
      (back > 0 && returnHourRate > rules.returnHour),
  };
}

/* --------------------------------------------------------- final bill ---- */

/**
 * Whole hours to charge for `minutes`: the first `graceMinutes` of an hour are
 * free, a minute more and the hour counts (grace 15: 4 h 15 m → 4 h,
 * 4 h 16 m → 5 h).
 */
export function chargeHours(minutes: number, graceMinutes: number): number {
  const m = Math.max(0, Math.floor(Number.isFinite(minutes) ? minutes : 0));
  const h = Math.floor(m / 60);
  return m - h * 60 > Math.max(0, graceMinutes) ? h + 1 : h;
}

/**
 * A stretch on the road from the real times → full days and the hours left
 * over. Day and night (`nonstop`): every hoursPerDay is a day. Otherwise he
 * rests at night, so each 24 hours from the start is one day (12 driving + 12
 * rest), and what is left after the last full 24 is driving: hoursPerDay of
 * it is one more day, the rest by the hour.
 */
export function billDays(
  rules: Pick<TripRules, 'hoursPerDay'> & Partial<Pick<TripRules, 'extraFullDayAfter'>>,
  minutes: number,
  nonstop: boolean,
  graceMinutes: number,
): { days: number; hours: number } {
  const m = Math.max(0, Math.floor(Number.isFinite(minutes) ? minutes : 0));
  const day = rules.hoursPerDay * 60;
  // More than extraFullDayAfter hours left over: one more full day instead.
  const after = rules.extraFullDayAfter ?? 24;
  const round = (days: number, hours: number) => (hours > after ? { days: days + 1, hours: 0 } : { days, hours });
  if (nonstop) {
    const days = Math.floor(m / day);
    return round(days, chargeHours(m - days * day, graceMinutes));
  }
  const cycles = Math.floor(m / 1440);
  const rest = m - cycles * 1440;
  const more = Math.floor(rest / day);
  return round(cycles + more, chargeHours(rest - more * day, graceMinutes));
}

/** The real times of a trip, epoch milliseconds. */
export type TripTimes = {
  /** He left with the car. */
  startAt: number;
  /** One-way: he handed over the car. */
  dropAt?: number;
  /** One-way: he is home. Round trip: the trip is over (he is back). */
  homeAt: number;
};

export type BillInput = TripTimes & {
  kind: TripKind;
  /** Driven day and night at the customer's request. */
  nonstop: boolean;
  dayRate: number;
  extraHourRate: number;
  returnHourRate: number;
  /** Ticket home, if we bought it (passed on at cost). */
  ticket: number;
  /** Minutes of an hour not charged (site-settings.ts outstation.graceMinutes). */
  graceMinutes: number;
};

export type Bill = {
  /** One-way: start → drop. Round trip: start → back. */
  driveMinutes: number;
  days: number;
  extraHours: number;
  /** extraHours × extraHourRate, never more than one day. */
  extraCharge: number;
  /** One-way: drop → home (0 on a round trip). */
  returnMinutes: number;
  returnHours: number;
  /** The way home with the daily maximum. */
  returnCharge: number;
  dayRate: number;
  extraHourRate: number;
  returnHourRate: number;
  ticket: number;
  amount: number;
};

const minutesBetween = (a: number | undefined, b: number | undefined) =>
  a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b) ? 0 : Math.max(0, Math.floor((b - a) / 60000));

/**
 * The FINAL bill from the real times, with the agreed rates. The same rules
 * as the estimate, on the clock instead of the prediction:
 *   - Driving (one-way: start → drop; round trip: start → back): billDays.
 *     A round trip is at least one day.
 *   - The extra hours never cost more than one more day.
 *   - The way home (one-way: drop → home), by the hour with the daily maximum
 *     (returnMaxPerDay ÷ returnHour hours, as in the quote).
 */
export function finalBill(rules: TripRules, input: BillInput): Bill {
  const oneWay = input.kind === 'one-way';
  const driveEnd = oneWay ? (input.dropAt ?? input.homeAt) : input.homeAt;
  const driveMinutes = minutesBetween(input.startAt, driveEnd);
  const returnMinutes = oneWay ? minutesBetween(driveEnd, input.homeAt) : 0;

  let { days, hours } = billDays(rules, driveMinutes, input.nonstop, input.graceMinutes);
  if (!oneWay && days === 0) {
    days = 1;
    hours = 0;
  }
  const dayRate = whole(input.dayRate);
  const extraHourRate = whole(input.extraHourRate);
  const returnHourRate = whole(input.returnHourRate);
  const ticket = whole(input.ticket);
  // One-way, shorter than a day: the short-drive steps (₹600 for 3 h, …) at the agreed hourly rate.
  const extraCharge =
    oneWay && days === 0 && hours > 0
      ? Math.min(shortDriveCharge(rules, hours, extraHourRate).from, dayRate)
      : Math.min(hours * extraHourRate, dayRate);
  const returnHours = oneWay ? chargeHours(returnMinutes, input.graceMinutes) : 0;
  const capHours = rules.returnMaxPerDay / rules.returnHour;
  const returnCharge = returnCost(returnHours, returnHourRate, returnHourRate * capHours, rules.returnFullDayAfter);
  return {
    driveMinutes,
    days,
    extraHours: hours,
    extraCharge,
    returnMinutes,
    returnHours,
    returnCharge,
    dayRate,
    extraHourRate,
    returnHourRate,
    ticket,
    amount: days * dayRate + extraCharge + returnCharge + ticket,
  };
}

/* ------------------------------------------------------- app publishing -- */

/**
 * Everything the mobile app needs for its estimate, worked out here once so
 * the app and the website can never disagree: for each destination its
 * railway stations (for the train lookup), and from each pickup city the
 * km, the hours of driving, the average way home (`homeHours`), and — for a 7 AM start on an
 * unknown day — the calendar days and the hours of the way home; plus the
 * fewest days for a round trip. The app repeats planTrip for the customer's
 * own start (lib/outstation.ts is the reference).
 */
export function destinationTable(rules: TripRules) {
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return destinations.map((d) => ({
    id: d.id,
    name: d.name,
    nameHi: d.nameHi,
    region: d.region,
    ...(d.rail && { rail: { stations: [...d.rail.stations], hubs: [...(d.rail.hubs ?? [])] } }),
    from: Object.fromEntries(
      pickupCities.map((city) => {
        const km = roadKm(city, d);
        const way = homeWay(d, city);
        const one = planTrip(rules, km, 'one-way', 0, way);
        const round = planTrip(rules, km, 'round');
        return [
          city,
          {
            km,
            oneWay: {
              days: one.minDays,
              returnHours: one.returnHours,
              driveHours: r3(one.driveHours),
              // The hours planTrip used (a place without a figure: by bus at busKmh).
              homeHours: r3(
                one.homeAt !== undefined && one.leaveAt !== undefined ? one.homeAt - one.leaveAt : (way.hours ?? 0),
              ),
            },
            roundDays: round.minDays,
          },
        ];
      }),
    ) as Record<
      PickupCity,
      {
        km: number;
        oneWay: { days: number; returnHours: number; driveHours: number; homeHours: number };
        roundDays: number;
      }
    >,
  }));
}
