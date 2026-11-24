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
 * How a trip is priced (decided with the owner on 8 Nov 2026 — one rule for
 * the driver's TIME, in place of the earlier day/hour/route prices):
 *   - One-way distance from the pickup city decides the price for each 24
 *     hours of his time (dayRateFor): it rises with the distance — about
 *     ₹1,050 close by to ₹1,350 at 160 km, then ₹1,450 rising to ₹1,750 at
 *     300 km and farther.
 *   - One-way drops (timePrice): he is paid for the time from when he leaves
 *     until he is home — the drive, waiting for his train and the ride home.
 *     Up to 160 km he is home the same day: one price for the trip. Farther:
 *     the price for each 24 hours; the hours past those 24-hour blocks
 *     extraHour (₹130) each, never more than one more day. If he arrives in
 *     8 hours, the rest of the 24 is his waiting and his ride home — no extra.
 *   - The waiting and the ride home: the route's AVERAGE from the timetables
 *     (every hour of every day of the week, Destination.home.wait and the
 *     hours home) until the customer picks a date; then the real train for
 *     that date (lib/rail.ts, withReturn); the FINAL bill uses the real times.
 *   - Timings: from the start date and time. Normally he drives 12 hours and
 *     rests 12 (up to an hour more finishes that evening); or, if the customer
 *     wants it, day and night without the rest (same price).
 *   - Round trips: the days of the trip at the day price for the distance,
 *     driving beyond hoursPerDay a day extraHour each.
 *   - The customer books and pays for the driver's ticket home and gives his
 *     meals. The team confirms the exact price on the call (/admin works it
 *     out from what the driver costs, inside the profit band).
 *   - One-way drops FARTHER than the first tier (decided 24 Nov 2026,
 *     longOneWayPrice): each day of driving at oneWayLong.drivingDay (a day
 *     is hoursPerDay hours, the last one up to drivingGraceHours longer),
 *     then his way home — waiting for the train he takes plus the ride — each
 *     full 24 hours at returnDay and the hours left over (after a 15-minute
 *     grace) at returnHour, never more than returnDay for them. The customer
 *     books and pays his ticket.
 *   - Final bill (finalBill): the driver taps Start, Drop and Home on his trip
 *     link; one-way: start → home, the same 24-hour blocks; round trips:
 *     start → back, each 24 h a day. The first 15 minutes of an hour are free.
 *     Quotes and bills from before 8 Nov 2026 (by the hours, or a route price)
 *     are still billed the way they were agreed.
 */

/* ------------------------------------------------------------- rules ---- */

/** The trip rules from site-settings.ts (`outstation`), plus the per-day price range. */
export type TripRules = {
  /** Customer price per 24 hours of the driver's time for places farther than the last nearRates tier (rising with the distance, see dayRateFor). */
  dayRate: { from: number; to: number };
  /**
   * Cheaper days for places closer by, nearest first: up to `upToKm` (one
   * way, by road, from the pickup city) a day is from–to. The first tier is
   * also the same-day drop: up to its upToKm (160 km) he is home the same
   * day, one price for the trip. Left out: dayRate everywhere. See dayRateFor.
   */
  nearRates?: readonly NearRate[];
  /**
   * The day price rises with the distance (decided 8 Nov 2026): the first
   * tier's `from` up to nearFromKm, rising to its `to` at its upToKm; past the
   * last tier, dayRate.from rising to dayRate.to at dayTopFromKm. Left out:
   * each tier's from–to as a range (older settings).
   */
  nearFromKm?: number;
  dayTopFromKm?: number;
  /** Quotes and bills from before 8 Nov 2026 only: customer price per hour of his way home. */
  returnHour: number;
  /** Quotes and bills from before 8 Nov 2026 only: the most the way home costs in any 24 hours. */
  returnMaxPerDay: number;
  /**
   * The way home's hours left over after its full days (24 h each, at
   * returnMaxPerDay): up to this many are charged by the hour, more count as
   * a full day (decided 29 Oct 2026: 6).
   */
  returnFullDayAfter: number;
  /**
   * Round trips and older bills: driving hours left over after the full days
   * — up to this many at extraHour, more count as one more full day at
   * dayRate (decided 29 Oct 2026: 7).
   */
  extraFullDayAfter: number;
  /**
   * Customer price per hour past the 24-hour blocks of a one-way drop (never
   * more than one more day, 8 Nov 2026), and per driving hour beyond
   * hoursPerDay a day on a round trip.
   */
  extraHour: number;
  /** Driving hours in one outstation day (also a long one-way drop's driving day). */
  hoursPerDay: number;
  /**
   * One-way drops farther than the first nearRates tier (24 Nov 2026): the
   * customer's price for each driving day, each full 24 hours of his way
   * home, and each hour of it left over. Left out: the driver's time as below.
   */
  oneWayLong?: { drivingDay: number; returnDay: number; returnHour: number };
  /** Long one-way drops: the last day of driving may run this many hours longer without being one more day (1). */
  drivingGraceHours?: number;
  /** Minutes of an hour not charged on the way home and on the final bill (15). */
  graceMinutes?: number;
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
   * The driver's way home after a one-way drop: how he usually travels, and
   * the AVERAGE hours on board to Raipur, to Durg (also used for Bhilai) and
   * to Bilaspur — from the timetables over every hour of every day of the
   * week (8 Nov 2026; bus routes: the usual time). The estimate uses them
   * until the customer picks a date and a train (then the real train), never
   * shown as a train or a timetable.
   */
  home: {
    by: 'train' | 'bus' | 'bus + train';
    raipur: number;
    durg: number;
    bilaspur: number;
    /**
     * The average hours from the drop until he boards (getting to the station
     * and any change of train included), over every hour of every day of the
     * week, from the timetables (8 Nov 2026); bus routes 1.5 h. Left out:
     * stationHours.
     */
    wait?: number;
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
  { id: 'mahasamund', name: 'Mahasamund', nameHi: 'महासमुंद', region: 'cg', lat: 21.1074, lng: 82.0948, fromRaipur: { road: 55, air: 51.1 }, home: { by: 'bus', raipur: 1.5, durg: 2.5, bilaspur: 3.5, wait: 1.5 } },
  { id: 'dhamtari', name: 'Dhamtari', nameHi: 'धमतरी', region: 'cg', lat: 20.7076, lng: 81.5494, fromRaipur: { road: 67, air: 61.6 }, home: { by: 'bus', raipur: 2, durg: 2.25, bilaspur: 4, wait: 1.5 } },
  { id: 'rajnandgaon', name: 'Rajnandgaon', nameHi: 'राजनांदगांव', region: 'cg', lat: 21.0974, lng: 81.0337, fromRaipur: { road: 74, air: 64.5 }, home: { by: 'train', raipur: 1.5, durg: 0.75, bilaspur: 3 }, rail: { stations: ['RJN'] } },
  { id: 'dongargarh', name: 'Dongargarh', nameHi: 'डोंगरगढ़', region: 'cg', lat: 21.1891, lng: 80.755, fromRaipur: { road: 108, air: 90.5 }, home: { by: 'train', raipur: 2, durg: 1.25, bilaspur: 3.75 }, rail: { stations: ['DGG'] } },
  { id: 'bilaspur', name: 'Bilaspur', nameHi: 'बिलासपुर', region: 'cg', lat: 22.0797, lng: 82.1409, fromRaipur: { road: 113, air: 106.1 }, home: { by: 'train', raipur: 1.5, durg: 2.5, bilaspur: 0, wait: 2 }, rail: { stations: ['BSP'] } },
  { id: 'kawardha', name: 'Kawardha', nameHi: 'कवर्धा', region: 'cg', lat: 22.0086, lng: 81.2318, fromRaipur: { road: 116, air: 94.1 }, home: { by: 'bus', raipur: 3, durg: 2.75, bilaspur: 3.25, wait: 1.5 } },
  { id: 'kanker', name: 'Kanker', nameHi: 'कांकेर', region: 'cg', lat: 20.2719, lng: 81.492, fromRaipur: { road: 127, air: 109.8 }, home: { by: 'bus', raipur: 3.5, durg: 3.75, bilaspur: 5.5, wait: 1.5 } },
  { id: 'janjgir', name: 'Janjgir', nameHi: 'जांजगीर', region: 'cg', lat: 22.009, lng: 82.5772, fromRaipur: { road: 160, air: 128.9 }, home: { by: 'train', raipur: 3, durg: 3.5, bilaspur: 1, wait: 3.25 }, rail: { stations: ['NIA'] } },
  { id: 'amarkantak', name: 'Amarkantak', nameHi: 'अमरकंटक', region: 'cg', lat: 22.673, lng: 81.7536, fromRaipur: { road: 209, air: 159.7 }, home: { by: 'bus + train', raipur: 5.5, durg: 6.5, bilaspur: 3, wait: 1.5 } },
  { id: 'korba', name: 'Korba', nameHi: 'कोरबा', region: 'cg', lat: 22.3595, lng: 82.7501, fromRaipur: { road: 216, air: 169 }, home: { by: 'train', raipur: 4, durg: 4.75, bilaspur: 2, wait: 4.75 }, rail: { stations: ['KRBA'] } },
  { id: 'raigarh', name: 'Raigarh', nameHi: 'रायगढ़', region: 'cg', lat: 21.8974, lng: 83.395, fromRaipur: { road: 258, air: 196.2 }, home: { by: 'train', raipur: 4.25, durg: 4.75, bilaspur: 2.5, wait: 3 }, rail: { stations: ['RIG'] } },
  { id: 'jagdalpur', name: 'Jagdalpur', nameHi: 'जगदलपुर', region: 'cg', lat: 19.0748, lng: 82.008, fromRaipur: { road: 287, air: 245.3 }, home: { by: 'bus', raipur: 7, durg: 8, bilaspur: 9, wait: 1.5 } },
  { id: 'ambikapur', name: 'Ambikapur', nameHi: 'अंबिकापुर', region: 'cg', lat: 23.1355, lng: 83.182, fromRaipur: { road: 334, air: 263.6 }, home: { by: 'bus', raipur: 7.5, durg: 8.5, bilaspur: 5.25, wait: 1.5 } },
  // Other states
  { id: 'gondia', name: 'Gondia', nameHi: 'गोंदिया', region: 'india', lat: 21.4624, lng: 80.192, fromRaipur: { road: 201, air: 147.9 }, home: { by: 'train', raipur: 3.25, durg: 2.5, bilaspur: 4.75, wait: 2 }, rail: { stations: ['G'] } },
  { id: 'sambalpur', name: 'Sambalpur', nameHi: 'संबलपुर', region: 'india', lat: 21.4669, lng: 83.9812, fromRaipur: { road: 275, air: 244.8 }, home: { by: 'bus', raipur: 6, durg: 6.5, bilaspur: 4.5, wait: 1.5 } },
  { id: 'nagpur', name: 'Nagpur', nameHi: 'नागपुर', region: 'india', lat: 21.1458, lng: 79.0882, fromRaipur: { road: 284, air: 263.8 }, home: { by: 'train', raipur: 4.75, durg: 4, bilaspur: 6.25, wait: 2.5 }, rail: { stations: ['NGP'] } },
  { id: 'jharsuguda', name: 'Jharsuguda', nameHi: 'झारसुगुड़ा', region: 'india', lat: 21.8554, lng: 84.0062, fromRaipur: { road: 320, air: 254.9 }, home: { by: 'train', raipur: 5.25, durg: 6.25, bilaspur: 3.5, wait: 3 }, rail: { stations: ['JSG'] } },
  { id: 'jabalpur', name: 'Jabalpur', nameHi: 'जबलपुर', region: 'india', lat: 23.1815, lng: 79.9864, fromRaipur: { road: 383, air: 273.5 }, home: { by: 'train', raipur: 8.75, durg: 8.25, bilaspur: 8.25, wait: 7.25 }, rail: { stations: ['JBP'], hubs: ['NGP', 'G'] } },
  { id: 'visakhapatnam', name: 'Visakhapatnam', nameHi: 'विशाखापत्तनम', region: 'india', lat: 17.6868, lng: 83.2185, fromRaipur: { road: 546, air: 430 }, home: { by: 'train', raipur: 9.5, durg: 10.5, bilaspur: 11.5, wait: 4.75 }, rail: { stations: ['VSKP'] } },
  { id: 'bhubaneswar', name: 'Bhubaneswar', nameHi: 'भुवनेश्वर', region: 'india', lat: 20.2961, lng: 85.8245, fromRaipur: { road: 547, air: 449 }, home: { by: 'train', raipur: 13, durg: 13.75, bilaspur: 15, wait: 8.5 }, rail: { stations: ['BBS'] } },
  { id: 'puri', name: 'Puri', nameHi: 'पुरी', region: 'india', lat: 19.8135, lng: 85.8312, fromRaipur: { road: 577, air: 465.9 }, home: { by: 'train', raipur: 14.75, durg: 15.5, bilaspur: 16.75, wait: 8.5 }, rail: { stations: ['PURI'] } },
  { id: 'prayagraj', name: 'Prayagraj', nameHi: 'प्रयागराज', region: 'india', lat: 25.4358, lng: 81.8463, fromRaipur: { road: 578, air: 465.9 }, home: { by: 'train', raipur: 13.75, durg: 14.75, bilaspur: 11.75, wait: 6.5 }, rail: { stations: ['PRYJ', 'PCOI'], hubs: ['NGP'] } },
  { id: 'ranchi', name: 'Ranchi', nameHi: 'रांची', region: 'india', lat: 23.3441, lng: 85.3096, fromRaipur: { road: 616, air: 444 }, home: { by: 'train', raipur: 10, durg: 10.5, bilaspur: 8, wait: 10.75 }, rail: { stations: ['RNC', 'HTE'] } },
  { id: 'bhopal', name: 'Bhopal', nameHi: 'भोपाल', region: 'india', lat: 23.2599, lng: 77.4126, fromRaipur: { road: 628, air: 488 }, home: { by: 'train', raipur: 12.5, durg: 12.75, bilaspur: 13.75, wait: 8 }, rail: { stations: ['BPL', 'RKMP'], hubs: ['NGP'] } },
  { id: 'varanasi', name: 'Varanasi', nameHi: 'वाराणसी', region: 'india', lat: 25.3176, lng: 82.9739, fromRaipur: { road: 644, air: 472.7 }, home: { by: 'train', raipur: 17, durg: 18, bilaspur: 15, wait: 7 }, rail: { stations: ['BSB'], hubs: ['NGP', 'G'] } },
  { id: 'indore', name: 'Indore', nameHi: 'इंदौर', region: 'india', lat: 22.7196, lng: 75.8577, fromRaipur: { road: 727, air: 617.2 }, home: { by: 'bus', raipur: 16.5, durg: 17.25, bilaspur: 18.5, wait: 1.5 } },
  { id: 'patna', name: 'Patna', nameHi: 'पटना', region: 'india', lat: 25.5941, lng: 85.1376, fromRaipur: { road: 739, air: 601 }, home: { by: 'bus', raipur: 19, durg: 19.75, bilaspur: 21, wait: 1.5 } },
  { id: 'lucknow', name: 'Lucknow', nameHi: 'लखनऊ', region: 'india', lat: 26.8467, lng: 80.9462, fromRaipur: { road: 779, air: 626.2 }, home: { by: 'train', raipur: 19.5, durg: 20.5, bilaspur: 17.5, wait: 20.75 }, rail: { stations: ['LKO', 'LJN'], hubs: ['NGP'] } },
  { id: 'hyderabad', name: 'Hyderabad', nameHi: 'हैदराबाद', region: 'india', lat: 17.385, lng: 78.4867, fromRaipur: { road: 780, air: 542 }, home: { by: 'train', raipur: 13.5, durg: 13.5, bilaspur: 15, wait: 9.5 }, rail: { stations: ['SC', 'HYB', 'KCG'], hubs: ['NGP'] } },
  { id: 'kolkata', name: 'Kolkata', nameHi: 'कोलकाता', region: 'india', lat: 22.5726, lng: 88.3639, fromRaipur: { road: 831, air: 710 }, home: { by: 'train', raipur: 13, durg: 14, bilaspur: 11, wait: 4 }, rail: { stations: ['HWH', 'SHM'] } },
  { id: 'pune', name: 'Pune', nameHi: 'पुणे', region: 'india', lat: 18.5204, lng: 73.8567, fromRaipur: { road: 1007, air: 867 }, home: { by: 'train', raipur: 19.5, durg: 19, bilaspur: 21.5, wait: 10 }, rail: { stations: ['PUNE'], hubs: ['NGP'] } },
  { id: 'mumbai', name: 'Mumbai', nameHi: 'मुंबई', region: 'india', lat: 19.076, lng: 72.8777, fromRaipur: { road: 1118, air: 945 }, home: { by: 'train', raipur: 17, durg: 16.25, bilaspur: 19.5, wait: 4.75 }, rail: { stations: ['CSMT', 'LTT'], hubs: ['NGP'] } },
  { id: 'delhi', name: 'Delhi', nameHi: 'दिल्ली', region: 'india', lat: 28.6139, lng: 77.209, fromRaipur: { road: 1214, air: 946 }, home: { by: 'train', raipur: 22, durg: 21.5, bilaspur: 20.5, wait: 7.25 }, rail: { stations: ['NDLS', 'NZM'], hubs: ['NGP'] } },
  { id: 'bengaluru', name: 'Bengaluru', nameHi: 'बेंगलुरु', region: 'india', lat: 12.9716, lng: 77.5946, fromRaipur: { road: 1370, air: 1015.7 }, home: { by: 'train', raipur: 26, durg: 25.25, bilaspur: 28, wait: 8.75 }, rail: { stations: ['SMVB', 'SBC', 'YPR'], hubs: ['NGP'] } },
  { id: 'chennai', name: 'Chennai', nameHi: 'चेन्नई', region: 'india', lat: 13.0827, lng: 80.2707, fromRaipur: { road: 1405, air: 920 }, home: { by: 'train', raipur: 22.25, durg: 21.5, bilaspur: 24.25, wait: 9.25 }, rail: { stations: ['MAS'], hubs: ['NGP'] } },
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
  /** One-way: hours of waiting for his train (at the drop and at a change), from the lookup. */
  waitHours?: number;
};

/** When nothing better is known, the estimate assumes the driver leaves at 7 AM. */
export const DEFAULT_START_HOUR = 7;

/** When the driver leaves: the hour of the day and, if the date is known, the weekday (0 = Sunday). */
export type TripStart = { hour: number; weekday?: number };

/** A day price for places up to `upToKm` away (one way, by road). */
export type NearRate = { upToKm: number; from: number; to: number };

/**
 * The day price for a place `km` away (one way, by road, from the pickup
 * city), decided with the owner on 8 Nov 2026: it rises with the distance —
 * the first tier's `from` up to nearFromKm, its `to` at its upToKm; farther,
 * dayRate.from rising to dayRate.to at dayTopFromKm — to the nearest ₹50. A
 * place not in the list (km 0, unknown): the whole span, as a range — the
 * team quotes it on the call. Without nearFromKm (older settings): the tier's
 * from–to as a range.
 *   Bilaspur 113 km → ₹1,200; Janjgir 160 km → ₹1,350; Korba 216 km → ₹1,550;
 *   Nagpur 284 km → ₹1,700; 300 km and farther → ₹1,750.
 */
export function dayRateFor(
  rules: Pick<TripRules, 'dayRate' | 'nearRates' | 'nearFromKm' | 'dayTopFromKm'>,
  km: number | undefined,
): { from: number; to: number } {
  const d = Math.round(Number(km) || 0);
  const tiers = rules.nearRates ?? [];
  if (d <= 0) {
    const all = [...tiers, rules.dayRate];
    return { from: Math.min(...all.map((t) => t.from)), to: Math.max(...all.map((t) => t.to)) };
  }
  const tier = tiers.find((t) => d <= t.upToKm);
  if (rules.nearFromKm === undefined) return tier ? { from: tier.from, to: tier.to } : { ...rules.dayRate };
  const round50 = (n: number) => Math.round(n / 50) * 50;
  const along = (from: number, to: number, lo: number, hi: number) =>
    round50(hi <= lo ? to : from + ((to - from) * Math.min(1, Math.max(0, (d - lo) / (hi - lo)))));
  let low = rules.nearFromKm;
  for (const t of tiers) {
    if (d <= t.upToKm) {
      const v = along(t.from, t.to, low, t.upToKm);
      return { from: v, to: v };
    }
    low = t.upToKm;
  }
  const v = along(rules.dayRate.from, rules.dayRate.to, low, rules.dayTopFromKm ?? low);
  return { from: v, to: v };
}

/**
 * A one-way drop's price for the driver's time (decided with the owner on
 * 8 Nov 2026). He is paid by his time away — the drive, waiting for his train
 * and the ride home — and the customer pays for that time:
 *   - The day price for the distance (dayRateFor) for each 24 hours he is
 *     away (leaves → home); up to the first tier's upToKm (160 km) he is home
 *     the same day, so that is one price for the trip.
 *   - Past the 24-hour blocks, extraHour an hour — never more than one more
 *     day (then it is one more day).
 * `hours`: from the start until he is home — the average wait and ride for
 * the route until a train is picked, then the train's (withReturn), and on
 * the final bill the real times. `rates`: the agreed rates on a quote or a
 * bill. Undefined for an unknown place (km 0).
 *   Bilaspur 113 km, 6 h → ₹1,200. Visakhapatnam 546 km, 26 h → ₹1,750 + 2 h × ₹130.
 *   Delhi 1,214 km, 66 h → 2 × ₹1,750 + 18 h — more than a day: 3 × ₹1,750 = ₹5,250.
 */
export type TimePrice = {
  price: number;
  /** Up to the first tier's upToKm (160 km): home the same day, one price for the trip. */
  short: boolean;
  /** The price for each 24 h of his time. */
  dayRate: number;
  /** The 24-hour blocks (at least 1). */
  days: number;
  /** Whole hours from the start until he is home. */
  hours: number;
  /** Hours past the blocks, and what they cost (extraHour each, less than a day). */
  extraHours: number;
  extraHourRate: number;
  extraCharge: number;
  km: number;
};

/** The 24-hour blocks for `hours` of his time, and the hours past them (never more than one more day). */
export function timeBlocks(hours: number, dayRate: number, hourRate: number): { days: number; extraHours: number } {
  const h = Math.max(0, Math.ceil((Number.isFinite(hours) ? hours : 0) - 1e-9));
  const days = h <= 24 ? 1 : Math.floor(h / 24);
  const extraHours = Math.max(0, h - days * 24);
  // The hours past the blocks never cost more than one more day.
  return extraHours > 0 && extraHours * hourRate >= dayRate ? { days: days + 1, extraHours: 0 } : { days, extraHours };
}

export function timePrice(
  rules: Pick<TripRules, 'dayRate' | 'nearRates' | 'nearFromKm' | 'dayTopFromKm' | 'extraHour'>,
  km: number,
  hours: number,
  rates: { dayRate?: number; extraHour?: number } = {},
): TimePrice | undefined {
  const d = Math.round(Number(km) || 0);
  if (d <= 0) return undefined;
  const dayRate = Math.round(rates.dayRate ?? dayRateFor(rules, d).from);
  const extraHourRate = Math.round(rates.extraHour ?? rules.extraHour);
  const h = Math.max(0, Math.ceil((Number.isFinite(hours) ? hours : 0) - 1e-9));
  const { days, extraHours } = timeBlocks(h, dayRate, extraHourRate);
  const extraCharge = extraHours * extraHourRate;
  return {
    price: days * dayRate + extraCharge,
    short: d <= (rules.nearRates?.[0]?.upToKm ?? 0),
    dayRate,
    days,
    hours: h,
    extraHours,
    extraHourRate,
    extraCharge,
    km: d,
  };
}

/**
 * The time price in words: "One price for the trip — he is home the same day",
 * "2 × 24 h of the driver’s time × ₹1,750", plus "3 h past them × ₹130".
 * `money` formats rupees (passed in: this file has no formatting).
 */
export function timeWords(t: Pick<TimePrice, 'short' | 'days' | 'dayRate' | 'extraHours' | 'extraHourRate'>, money: (n: number) => string): string[] {
  const days =
    t.short && t.days === 1
      ? `One price for the trip (he is home the same day)`
      : `${t.days} × 24 h of the driver’s time × ${money(t.dayRate)}`;
  return t.extraHours > 0 ? [days, `${t.extraHours} h past ${t.days === 1 ? 'the 24 h' : 'them'} × ${money(t.extraHourRate)}`] : [days];
}

/* ----------------------------------------------- long one-way drops ---- */

/** Beyond this many km (one way) a one-way drop is a long one (the first nearRates tier: same-day drops up to it). */
export const longOneWayFromKm = (rules: Pick<TripRules, 'nearRates'>) => rules.nearRates?.[0]?.upToKm ?? 0;

/** Is a one-way drop of `km` priced by driving days and the way home (24 Nov 2026)? */
export const isLongOneWay = (rules: Pick<TripRules, 'nearRates' | 'oneWayLong'>, km: number | undefined) =>
  Boolean(rules.oneWayLong) && Math.round(Number(km) || 0) > longOneWayFromKm(rules);

/** Driving days: one per hoursPerDay of driving, the last up to drivingGraceHours longer — at least 1. 12.3 h → 1; 24 h → 2. */
export function longDrivingDays(rules: Pick<TripRules, 'hoursPerDay' | 'drivingGraceHours'>, drivingHours: number): number {
  const h = Math.max(0, Number.isFinite(drivingHours) ? drivingHours : 0);
  return Math.max(1, Math.ceil((h - (rules.drivingGraceHours ?? 1)) / rules.hoursPerDay - 1e-9));
}

/**
 * His way home's charge: each full 24 hours at `returnDay`, the hours left
 * over — whole hours, rounding up after `graceMinutes` (0 h 15 m → 0,
 * 0 h 16 m → 1) — at `returnHour`, never more than returnDay for them.
 *   10 h 41 m → 11 h × ₹160, at most ₹1,600 → ₹1,600;  27 h → ₹1,600 + 3 × ₹160.
 */
export function longReturn(
  rates: { returnDay: number; returnHour: number },
  minutes: number,
  graceMinutes = 15,
): { fullDays: number; leftoverHours: number; hours: number; charge: number } {
  const m = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0));
  const fullDays = Math.floor(m / 1440);
  const leftoverHours = chargeHours(m - fullDays * 1440, graceMinutes);
  const charge = fullDays * rates.returnDay + Math.min(rates.returnDay, leftoverHours * rates.returnHour);
  return { fullDays, leftoverHours, hours: fullDays * 24 + leftoverHours, charge };
}

export type LongOneWayPrice = {
  /** drivingDays × drivingDay + returnCharge (the ticket is the customer's, apart). */
  price: number;
  km: number;
  drivingHours: number;
  drivingDays: number;
  drivingDay: number;
  /** His way home: minutes, whole hours charged (full days × 24 + left over), and its charge. */
  returnMinutes: number;
  returnHours: number;
  returnFullDays: number;
  returnLeftoverHours: number;
  returnDay: number;
  returnHourRate: number;
  returnCharge: number;
};

/**
 * A long one-way drop's price (24 Nov 2026): driving days × drivingDay +
 * his way home (longReturn). `drivingHours`: the route's driving time (the
 * estimate) or start → drop (the bill); `returnMinutes`: waiting for his
 * train plus the ride (the estimate) or drop → home (the bill). `rates`: the
 * agreed ones on a quote or bill (default the settings'); `days`: at least
 * this many driving days (days the customer booked on top).
 *   616 km, 12.3 h, 10 h 41 m → 1 × ₹1,600 + ₹1,600 = ₹3,200.
 *   1,200 km, 24 h, 27 h → 2 × ₹1,600 + ₹1,600 + 3 × ₹160 = ₹5,280.
 */
export function longOneWayPrice(
  rules: Pick<TripRules, 'hoursPerDay' | 'drivingGraceHours' | 'graceMinutes' | 'oneWayLong'>,
  km: number,
  drivingHours: number,
  returnMinutes: number,
  rates: { drivingDay?: number; returnDay?: number; returnHour?: number } = {},
  days = 0,
): LongOneWayPrice | undefined {
  const set = rules.oneWayLong;
  if (!set) return undefined;
  const drivingDay = Math.round(rates.drivingDay ?? set.drivingDay);
  const returnHourRate = Math.round(rates.returnHour ?? set.returnHour);
  const returnDay = Math.round(rates.returnDay ?? set.returnDay);
  const drivingDays = Math.max(longDrivingDays(rules, drivingHours), Math.floor(days) || 0);
  const back = longReturn({ returnDay, returnHour: returnHourRate }, returnMinutes, rules.graceMinutes ?? 15);
  return {
    price: drivingDays * drivingDay + back.charge,
    km: Math.round(km),
    drivingHours,
    drivingDays,
    drivingDay,
    returnMinutes: Math.max(0, Math.round(returnMinutes)),
    returnHours: back.hours,
    returnFullDays: back.fullDays,
    returnLeftoverHours: back.leftoverHours,
    returnDay,
    returnHourRate,
    returnCharge: back.charge,
  };
}

/**
 * The way-home day rate for a saved quote or bill's hourly rate: the
 * settings' returnDay in the same proportion, never more than 10 hours'
 * worth (firestore.rules isQuote / isBill).
 */
export function longReturnDayFor(rules: Pick<TripRules, 'oneWayLong'>, returnHourRate: number): number {
  const set = rules.oneWayLong;
  const rate = Math.max(0, Math.round(returnHourRate));
  if (!set || !set.returnHour) return 10 * rate;
  return Math.min(10 * rate, Math.round((set.returnDay * rate) / set.returnHour));
}

/** A saved quote or bill priced as a long one-way drop: km past the first tier, a way-home rate and no route hours. */
export const pricedLong = (
  rules: Pick<TripRules, 'nearRates' | 'oneWayLong'>,
  q: { km?: number; awayHours?: number; returnHourRate: number },
): boolean => isLongOneWay(rules, q.km) && !q.awayHours && q.returnHourRate > 0;

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
  /** The average wait from the drop until he boards. Left out: stationHours. */
  wait?: number;
};

/** The allowance for the way home from a destination to a pickup city: the average wait and ride. */
export function homeWay(dest: Destination, city: PickupCity): HomeWay {
  return { hours: homeTravelHours(dest, city) ?? 0, ...(dest.home.wait !== undefined && { wait: dest.home.wait }) };
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

  // The way home (the allowance): the average wait for his train (or getting to the station), then the ride home.
  const dropAt = lastDayAt + (nonstop ? 0 : extraDays * 24);
  const leaveAt = dropAt + (way.wait ?? rules.stationHours);
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
export function withReturn(plan: TripPlan, leaveAt: number, homeAt: number, waitHours?: number): TripPlan {
  if (plan.kind !== 'one-way' || plan.dropAt === undefined || !(homeAt > plan.dropAt)) return plan;
  return {
    ...plan,
    leaveAt,
    homeAt,
    returnHours: Math.max(0, Math.ceil(homeAt - plan.dropAt - 1e-9)),
    // The waiting for his train: from the drop to boarding, and any change (lib/rail.ts).
    waitHours: waitHours ?? Math.max(0, leaveAt - plan.dropAt),
    homeBasis: 'train',
  };
}

/**
 * Quotes and bills from before 8 Nov 2026 (by the hours): the way home's charge in words: "2 days × ₹1,200 (1 day + 14 h; more than
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
 * Quotes and bills from before 8 Nov 2026 (by the hours): what `hours` of the way home cost: each full 24 hours is a day
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

export type Estimate = {
  /** What the customer sees: one number for a place in the list, a range for a place not in it. */
  from: number;
  to: number;
  /** The days charged and the price for each (one-way: the 24-hour blocks of his time; long one-way: driving days). */
  days: number;
  dayRate: { from: number; to: number };
  /** One-way to a place in the list up to the first tier (8 Nov 2026): the price for the driver's time. */
  time?: TimePrice;
  /** One-way to a place in the list farther than that (24 Nov 2026): driving days and his way home. */
  long?: LongOneWayPrice;
};

/**
 * What the customer sees. One-way to a place in the list: the price for the
 * driver's time (timePrice) from the start until he is home (plan.homeAt).
 * Round trips: the days at the day price for the distance. A place not in
 * the list: the days at the whole span of day prices, as a range.
 */
export function estimate(
  rules: TripRules,
  plan: Pick<TripPlan, 'fullDays'> & Partial<Pick<TripPlan, 'km' | 'kind' | 'homeAt' | 'dropAt' | 'driveHours' | 'days'>>,
): Estimate {
  // A long one-way drop: driving days, then his way home (the drop → home of the plan: the wait and the ride).
  if (plan.kind !== 'round' && plan.homeAt !== undefined && plan.dropAt !== undefined && isLongOneWay(rules, plan.km)) {
    const long = longOneWayPrice(rules, plan.km ?? 0, plan.driveHours ?? 0, (plan.homeAt - plan.dropAt) * 60, {}, plan.days ?? 0);
    if (long) return { from: long.price, to: long.price, days: long.drivingDays, dayRate: { from: long.drivingDay, to: long.drivingDay }, long };
  }
  const time = plan.kind !== 'round' && plan.homeAt !== undefined ? timePrice(rules, plan.km ?? 0, plan.homeAt) : undefined;
  if (time) return { from: time.price, to: time.price, days: time.days, dayRate: { from: time.dayRate, to: time.dayRate }, time };
  const dayRate = dayRateFor(rules, plan.km);
  const days = Math.max(1, Math.floor(plan.fullDays) || 0);
  return { from: days * dayRate.from, to: days * dayRate.to, days, dayRate };
}

/* -------------------------------------------------------------- quote ---- */

const whole = (n: number) => Math.max(0, Math.round(Number.isFinite(n) ? n : 0));
const nearest = (n: number, step: number) => Math.round(n / step) * step;

/** The profit band the team keeps (site-settings.ts outstation): the % the price is worked out with, and the least and the most. */
export type ProfitBand = {
  /** What the price is worked out with. */
  targetProfitPercent: number;
  minProfitPercent: number;
  maxProfitPercent: number;
};

export type TimeQuoteInput = ProfitBand & {
  /** One-way road km to the place. */
  km: number;
  /** Hours from the start until he is home: the plan's (the average wait and ride, or the train's). */
  hours: number;
  /** What this driver asked for each 24 hours of his time (up to 160 km: for the trip). */
  driverDayCost: number;
  /** What he gets for each hour past the 24-hour blocks. */
  driverHourPay: number;
  /** The customer's price for each 24 h, if the team types one (0 or left out: from the driver's cost). */
  dayRate?: number;
  /** Bus/train ticket home if we bought it — passed straight through, no profit on it. */
  ticket: number;
  /** % of the booking paid to a partner who sent the customer (0 if none). */
  partnerPercent: number;
};

export type TimeQuote = {
  /** What the customer pays for the driver's time (the 24-hour blocks and the hours past them). */
  time: TimePrice;
  /** time.price + ticket — the number to tell the customer. */
  total: number;
  /** The driver's pay: his cost for each block, his hourly pay for the hours past them. Admin-only. */
  driverPay: number;
  partnerPay: number;
  profit: number;
  /** profit as % of time.price, one decimal. */
  profitPercent: number;
  /** Below minProfitPercent or above maxProfitPercent. */
  low: boolean;
  high: boolean;
  ok: boolean;
  /** The price customers were shown for the same hours (the estimate). */
  shown: TimePrice;
};

/**
 * The /admin price for a one-way drop (8 Nov 2026): the driver's cost for
 * each 24 hours of his time and his pay an hour past them, and on top the
 * profit (targetProfitPercent, and a partner's commission if a partner sent
 * the customer) — to the nearest ₹50 a day and ₹10 an hour, so the profit stays
 * between minProfitPercent and maxProfitPercent. Or the day price the team
 * types. The blocks are counted at the customer's rates and paid the same to
 * the driver. Undefined without the km or a price.
 */
export function timeQuote(rules: TripRules, input: TimeQuoteInput): TimeQuote | undefined {
  const cost = whole(input.driverDayCost);
  const hourPay = whole(input.driverHourPay);
  const margin = Math.min(60, Math.max(0, input.targetProfitPercent)) / 100;
  const partner = Math.min(30, Math.max(0, input.partnerPercent)) / 100;
  const keep = 1 - margin - partner;
  const dayRate = whole(input.dayRate ?? 0) || nearest(cost / keep, 50);
  const extraHour = hourPay > 0 ? nearest(hourPay / keep, 10) : rules.extraHour;
  if (!(dayRate > 0)) return undefined;
  const time = timePrice(rules, input.km, input.hours, { dayRate, extraHour });
  const shown = timePrice(rules, input.km, input.hours);
  if (!time || !shown) return undefined;
  const driverPay = time.days * cost + time.extraHours * hourPay;
  const partnerPay = Math.round(time.price * partner);
  const profit = time.price - driverPay - partnerPay;
  const profitPercent = time.price > 0 ? Math.round((profit / time.price) * 1000) / 10 : 0;
  const low = profitPercent + 1e-9 < input.minProfitPercent;
  const high = profitPercent - 1e-9 > input.maxProfitPercent;
  return {
    time,
    total: time.price + whole(input.ticket),
    driverPay,
    partnerPay,
    profit,
    profitPercent,
    low,
    high,
    ok: !low && !high,
    shown,
  };
}

export type LongQuoteInput = ProfitBand & {
  km: number;
  /** Hours of driving (the route's, or what the team expects). */
  drivingHours: number;
  /** Minutes of his way home: waiting for his train plus the ride. */
  returnMinutes: number;
  /** What this driver asked for each day (each driving day, and each full 24 h of his way home). */
  driverDayCost: number;
  /** What he gets for each hour of his way home left over (never more than his day). */
  driverHourPay: number;
  /** The customer's price for each driving day, if the team types one (0 or left out: the settings'). */
  dayRate?: number;
  ticket: number;
  partnerPercent: number;
};

export type LongQuote = Omit<TimeQuote, 'time' | 'shown'> & { long: LongOneWayPrice; shown: LongOneWayPrice };

/**
 * The /admin price for a long one-way drop (24 Nov 2026): the customer's
 * price by the settings (longOneWayPrice; the team may type another price
 * for a driving day), the driver's pay the same way at his own day and hour,
 * and the profit with its band. Undefined without the settings.
 */
export function longQuote(rules: TripRules, input: LongQuoteInput): LongQuote | undefined {
  const typed = whole(input.dayRate ?? 0);
  const long = longOneWayPrice(rules, input.km, input.drivingHours, input.returnMinutes, typed ? { drivingDay: typed } : {});
  const shown = longOneWayPrice(rules, input.km, input.drivingHours, input.returnMinutes);
  if (!long || !shown) return undefined;
  const cost = whole(input.driverDayCost);
  const hourPay = whole(input.driverHourPay);
  const partner = Math.min(30, Math.max(0, input.partnerPercent)) / 100;
  const driverPay = (long.drivingDays + long.returnFullDays) * cost + Math.min(cost, long.returnLeftoverHours * hourPay);
  const partnerPay = Math.round(long.price * partner);
  const profit = long.price - driverPay - partnerPay;
  const profitPercent = long.price > 0 ? Math.round((profit / long.price) * 1000) / 10 : 0;
  const low = profitPercent + 1e-9 < input.minProfitPercent;
  const high = profitPercent - 1e-9 > input.maxProfitPercent;
  return { long, total: long.price + whole(input.ticket), driverPay, partnerPay, profit, profitPercent, low, high, ok: !low && !high, shown };
}

export type QuoteInput = Partial<ProfitBand> & {
  /** What this driver charges for one outstation day. */
  driverDayCost: number;
  /** Days of the trip. */
  days: number;
  /** Driving hours beyond hoursPerDay a day, summed over the trip. */
  extraHours: number;
  /** Bus/train ticket — passed straight through, no profit on it. */
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
  days: number;
  /** The extra driving hours charged (0 when more than extraFullDayAfter made them one more day). */
  extraHours: number;
  extraHourRate: number;
  /** The extra driving hours × extraHourRate, never more than a day. */
  extraCharge: number;
  /** Driver charges the customer pays, before the ticket. */
  charges: number;
  /** charges + ticket — the number to tell the customer. */
  total: number;
  driverPay: number;
  partnerPay: number;
  profit: number;
  /** profit as % of charges, one decimal. */
  profitPercent: number;
  /** Inside the profit band (minProfitPercent … maxProfitPercent). */
  ok: boolean;
  /** The day rate is above what customers were shown. */
  aboveShownRange: boolean;
};

/**
 * The exact price for a round trip on the call: the driver's real day cost
 * and the profit on top (targetProfitPercent; minProfitPercent if left out), to
 * the nearest ₹50 a day (₹10 an hour for driving beyond hoursPerDay a day,
 * never below extraHour). More than extraFullDayAfter extra hours are one
 * more day.
 */
export function quote(rules: TripRules, input: QuoteInput): Quote {
  const typedHours = whole(input.extraHours);
  const roundUp = typedHours > (rules.extraFullDayAfter ?? 24);
  const hours = roundUp ? 0 : typedHours;
  const days = Math.min(60, Math.max(1, whole(input.days) + (roundUp ? 1 : 0)));
  const cost = whole(input.driverDayCost);
  const margin = Math.min(60, Math.max(0, input.targetProfitPercent ?? input.minProfitPercent)) / 100;
  const partner = Math.min(30, Math.max(0, input.partnerPercent)) / 100;

  // Price so that what is left after the driver AND the partner is the margin.
  const keep = 1 - margin - partner;
  const dayRate = Math.max(50, nearest(cost / keep, 50));
  const hourCost = cost / rules.hoursPerDay;
  const extraHourRate = Math.max(rules.extraHour, nearest(hourCost / keep, 10));
  const extraCharge = Math.min(hours * extraHourRate, dayRate);
  const charges = days * dayRate + extraCharge;
  const driverPay = Math.round(days * cost + Math.min(hours * hourCost, cost));
  const partnerPay = Math.round(charges * partner);
  const profit = charges - driverPay - partnerPay;
  const profitPercent = charges > 0 ? Math.round((profit / charges) * 1000) / 10 : 0;
  return {
    dayRate,
    days,
    extraHours: hours,
    extraHourRate,
    extraCharge,
    charges,
    total: charges + whole(input.ticket),
    driverPay,
    partnerPay,
    profit,
    profitPercent,
    ok: profitPercent + 1e-9 >= input.minProfitPercent && profitPercent - 1e-9 <= (input.maxProfitPercent ?? 100),
    aboveShownRange: dayRate > dayRateFor(rules, input.km).to,
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
  /**
   * One-way, priced by the driver's time (quotes from 8 Nov 2026, and every
   * one-way drop to a known place without a quote): the km. The bill is then
   * his time from the start until he is home in 24-hour blocks at dayRate,
   * the hours past them at extraHourRate (timePrice). Left out: as below.
   */
  time?: { km: number };
  /**
   * One-way at a route price (the agreed price, or the estimate's): `price`
   * and the hours away it was planned for. The bill is then that price for
   * the days paid (awayHours, each started 24 h); the hours he was away past
   * them are returnHourRate each, at most returnMaxPerDay for each 24 h.
   * Left out: by the hours, as below.
   */
  route?: { price: number; awayHours: number; km: number };
  /**
   * A long one-way drop (24 Nov 2026): the km. The bill is then the driving
   * days from start → drop at dayRate, and his way home drop → home at
   * returnHourRate (longOneWayPrice). Left out: as above.
   */
  long?: { km: number };
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
  /** Priced by the driver's time: the km, the whole hours from the start until he was home, and whether he was home the same day (up to 160 km). */
  time?: { km: number; hours: number; short: boolean };
  /**
   * At a route price (before 8 Nov 2026): the planned and the real hours away, the km and the days paid. (Then days = 1 at
   * dayRate = the price; extraHours = the hours past the days paid, at extraHourRate = the way-home rate.)
   */
  route?: { awayHours: number; realAwayHours: number; km: number; paidDays?: number };
  /** A long one-way drop: the km, the way-home day rate and the hours left over (then days = driving days, returnHours = the hours charged). */
  long?: { km: number; returnDay: number; returnFullDays: number; returnLeftoverHours: number };
};

/** A saved quote or bill priced by the driver's time (from 8 Nov 2026): the km, and no route hours or way-home charge. */
export const pricedByTime = (q: { km?: number; awayHours?: number; returnHours: number; returnCharge: number }): boolean =>
  Boolean(q.km && q.km > 0 && !q.awayHours && !q.returnHours && !q.returnCharge);

const minutesBetween = (a: number | undefined, b: number | undefined) =>
  a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b) ? 0 : Math.max(0, Math.floor((b - a) / 60000));

/**
 * The FINAL bill from the real times, with the agreed rates. The same rules
 * as the estimate, on the clock instead of the prediction:
 *   - One-way by the driver's time (`time`): start → home in 24-hour blocks,
 *     the hours past them by the hour, never more than one more day.
 *   - Otherwise (round trips, and quotes from before 8 Nov 2026):
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

  // A long one-way drop (24 Nov 2026): driving days (start → drop), then his way home (drop → home).
  if (oneWay && input.long && input.long.km > 0 && whole(input.dayRate) > 0 && rules.oneWayLong) {
    const returnHour = whole(input.returnHourRate) || rules.oneWayLong.returnHour;
    const returnDay = longReturnDayFor(rules, returnHour);
    const p = longOneWayPrice(
      { ...rules, graceMinutes: input.graceMinutes },
      input.long.km,
      driveMinutes / 60,
      returnMinutes,
      { drivingDay: whole(input.dayRate), returnHour, returnDay },
    )!;
    const ticket = whole(input.ticket);
    return {
      driveMinutes,
      days: p.drivingDays,
      extraHours: 0,
      extraCharge: 0,
      returnMinutes,
      returnHours: p.returnHours,
      returnCharge: p.returnCharge,
      dayRate: p.drivingDay,
      extraHourRate: whole(input.extraHourRate),
      returnHourRate: returnHour,
      ticket,
      amount: p.price + ticket,
      long: { km: p.km, returnDay, returnFullDays: p.returnFullDays, returnLeftoverHours: p.returnLeftoverHours },
    };
  }

  // The driver's time (8 Nov 2026): start → home, in 24-hour blocks at the agreed price.
  if (oneWay && input.time && input.time.km > 0 && whole(input.dayRate) > 0) {
    const hours = chargeHours(minutesBetween(input.startAt, input.homeAt), input.graceMinutes);
    const t = timePrice(rules, input.time.km, hours, { dayRate: whole(input.dayRate), extraHour: whole(input.extraHourRate) })!;
    const ticket = whole(input.ticket);
    return {
      driveMinutes,
      days: t.days,
      extraHours: t.extraHours,
      extraCharge: t.extraCharge,
      returnMinutes,
      returnHours: 0,
      returnCharge: 0,
      dayRate: t.dayRate,
      extraHourRate: t.extraHourRate,
      returnHourRate: 0,
      ticket,
      amount: t.price + ticket,
      time: { km: t.km, hours: t.hours, short: t.short },
    };
  }

  // A route price (before 8 Nov 2026): the price for the days paid; waiting or delays use the time left in them first,
  // and only the hours past them cost extra — the way-home rate, at most the price per day for each 24 h.
  if (oneWay && input.route && input.route.price > 0) {
    const realAwayHours = chargeHours(minutesBetween(input.startAt, input.homeAt), input.graceMinutes);
    const planned = whole(input.route.awayHours);
    const paidDays = Math.max(1, Math.ceil(planned / 24));
    const price = whole(input.route.price);
    const rate = whole(input.returnHourRate);
    const past = Math.max(0, realAwayHours - paidDays * 24);
    // At most returnMaxPerDay for each 24 h (in the agreed rate's hours), never more than the price per day.
    const pastMax = Math.min(Math.round(price / paidDays / 50) * 50, rate * (rules.returnMaxPerDay / rules.returnHour));
    const pastCharge = past > 0 ? returnCost(past, rate, pastMax, 24) : 0;
    const ticket = whole(input.ticket);
    return {
      driveMinutes,
      days: 1,
      extraHours: past,
      extraCharge: pastCharge,
      returnMinutes,
      returnHours: 0,
      returnCharge: 0,
      dayRate: price,
      extraHourRate: rate,
      returnHourRate: rate,
      ticket,
      amount: price + pastCharge + ticket,
      route: { awayHours: planned, realAwayHours, km: whole(input.route.km), paidDays },
    };
  }

  let { days, hours } = billDays(rules, driveMinutes, input.nonstop, input.graceMinutes);
  if (!oneWay && days === 0) {
    days = 1;
    hours = 0;
  }
  const dayRate = whole(input.dayRate);
  const extraHourRate = whole(input.extraHourRate);
  const returnHourRate = whole(input.returnHourRate);
  const ticket = whole(input.ticket);
  // The extra hours never cost more than one more day.
  const extraCharge = Math.min(hours * extraHourRate, dayRate);
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
 * km, the hours of driving, the average wait for his train (`wait`) and ride home (`homeHours`), and — for a 7 AM start on an
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
              // The average wait from the drop until he boards (getting to the station included).
              wait: r3(way.wait ?? rules.stationHours),
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
        oneWay: { days: number; returnHours: number; driveHours: number; wait: number; homeHours: number };
        roundDays: number;
      }
    >,
  }));
}
