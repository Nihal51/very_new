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
 * How a trip is priced (decided with the owner, 19 Oct 2026; return day and
 * start-time rules 28 Oct 2026):
 *   - One-way distance from the pickup city decides everything. Most trips are
 *     one-way drops: the driver delivers the car and comes home by bus/train.
 *   - Driving days: at least one-way km ÷ kmPerDay (600 km, about 12 hours at
 *     averageKmh; up to a tenth of a day over doesn't add a day), or the days
 *     the customer books if more (resting, sightseeing). Each driving day is
 *     the driver's 24 hours from the start time. A round trip he finishes
 *     within the 24 hours (up to sameDayMaxHours of driving there and back —
 *     Raipur → Jharsuguda → Raipur) is ONE day; longer ones drive it twice.
 *   - The start time matters (one-way): it decides when he drops the car, and
 *     so which regular train or bus home he can catch (`home.trains`) and when
 *     he is home. If he is home before the last driving day ends: nothing more.
 *   - Return day: otherwise ONE return day is added (returnMaxPerDay) — a
 *     driving day is a driving day, the trip home is its own day (Mumbai: 2
 *     driving days + 1 return day).
 *   - Late hours: if he is still not home when the return day ends (a missed
 *     train, no seat), returnHour for each hour after it, at most
 *     returnMaxPerDay in any 24 hours. The FINAL bill uses the time he really
 *     reaches home; the estimate predicts it from the timetable.
 *   - The customer books and pays for the driver's ticket home.
 *   - The customer sees an estimate; the team quotes the exact price on the
 *     call, from the driver's real cost plus at least the minimum profit.
 */

/* ------------------------------------------------------------- rules ---- */

/** The trip rules from site-settings.ts (`outstation`), plus the per-day price range. */
export type TripRules = {
  /** Customer price per day (24 h from the start, up to hoursPerDay driving) — the range customers are shown. */
  dayRate: { from: number; to: number };
  /** Customer price per late hour: the driver still travelling home after the return day. */
  returnHour: number;
  /** The return day (one-way, if he is not home when the driving days end) — and the most late hours cost in any 24 hours. */
  returnMaxPerDay: number;
  /** Customer price per hour beyond hoursPerDay of driving in a day. */
  extraHour: number;
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
   * The driver's way home after a one-way drop: how he usually travels, and
   * hours on board to Raipur, to Durg (also used for Bhilai) and to Bilaspur —
   * the regular daily trains or buses a driver can get on short notice (not
   * weekly premium trains), from erail.in, redBus and AbhiBus timetables.
   * Getting to the station (stationHours) is added on top.
   *
   * `trains`: the regular daily (or nearly daily) trains home, where waiting
   * for one matters — long routes with only a few a day. With them the
   * estimate takes the first one he can catch after the drop; without them
   * (buses and short routes, with a service every hour or two) he leaves
   * stationHours after the drop. Their `hours` are to Raipur; Durg and
   * Bilaspur add the difference in the averages above.
   */
  home: {
    by: 'train' | 'bus' | 'bus + train';
    raipur: number;
    durg: number;
    bilaspur: number;
    trains?: readonly HomeTrain[];
  };
};

/** A regular train home: number and name, departure time (IST, "HH:MM") and hours on board to Raipur. */
export type HomeTrain = { no: string; name: string; dep: string; hours: number };

/**
 * Popular destinations. Road distances from Raipur: distancebetween2.com,
 * checked 19 Oct 2026 — check a few against Google Maps once a year. Train and
 * bus times home: erail.in, redBus, AbhiBus, ixigo, checked 20 Oct 2026 — check
 * them once a year too (new trains, new Vande Bharats). The `trains` lists
 * (ixigo, checked 28 Oct 2026) keep only trains that run daily or nearly
 * daily — weekly ones can't be counted on (Hyderabad has no daily train: its
 * line stands for the night trains that leave around 10:40 PM most days). Add a place by copying
 * a line; the other pickup cities' distances are worked out from these.
 */
export const destinations: readonly Destination[] = [
  // Chhattisgarh and just across the border
  { id: 'raipur', name: 'Raipur', nameHi: 'रायपुर', region: 'cg', lat: 21.2514, lng: 81.6296, fromRaipur: { road: 0, air: 0 }, home: { by: 'train', raipur: 0, durg: 0.75, bilaspur: 1.5 } },
  { id: 'bhilai', name: 'Bhilai', nameHi: 'भिलाई', region: 'cg', lat: 21.1938, lng: 81.3509, fromRaipur: { road: 33, air: 29.6 }, home: { by: 'train', raipur: 0.75, durg: 0.3, bilaspur: 2.75 } },
  { id: 'durg', name: 'Durg', nameHi: 'दुर्ग', region: 'cg', lat: 21.1904, lng: 81.2849, fromRaipur: { road: 40, air: 36.4 }, home: { by: 'train', raipur: 0.75, durg: 0, bilaspur: 2.75 } },
  { id: 'mahasamund', name: 'Mahasamund', nameHi: 'महासमुंद', region: 'cg', lat: 21.1074, lng: 82.0948, fromRaipur: { road: 55, air: 51.1 }, home: { by: 'bus', raipur: 1.5, durg: 2.5, bilaspur: 3.5 } },
  { id: 'dhamtari', name: 'Dhamtari', nameHi: 'धमतरी', region: 'cg', lat: 20.7076, lng: 81.5494, fromRaipur: { road: 67, air: 61.6 }, home: { by: 'bus', raipur: 2, durg: 2.25, bilaspur: 4 } },
  { id: 'rajnandgaon', name: 'Rajnandgaon', nameHi: 'राजनांदगांव', region: 'cg', lat: 21.0974, lng: 81.0337, fromRaipur: { road: 74, air: 64.5 }, home: { by: 'train', raipur: 1.5, durg: 0.75, bilaspur: 3 } },
  { id: 'dongargarh', name: 'Dongargarh', nameHi: 'डोंगरगढ़', region: 'cg', lat: 21.1891, lng: 80.755, fromRaipur: { road: 108, air: 90.5 }, home: { by: 'train', raipur: 2, durg: 1.25, bilaspur: 3.75 } },
  { id: 'bilaspur', name: 'Bilaspur', nameHi: 'बिलासपुर', region: 'cg', lat: 22.0797, lng: 82.1409, fromRaipur: { road: 113, air: 106.1 }, home: { by: 'train', raipur: 1.5, durg: 2.5, bilaspur: 0 } },
  { id: 'kawardha', name: 'Kawardha', nameHi: 'कवर्धा', region: 'cg', lat: 22.0086, lng: 81.2318, fromRaipur: { road: 116, air: 94.1 }, home: { by: 'bus', raipur: 3, durg: 2.75, bilaspur: 3.25 } },
  { id: 'kanker', name: 'Kanker', nameHi: 'कांकेर', region: 'cg', lat: 20.2719, lng: 81.492, fromRaipur: { road: 127, air: 109.8 }, home: { by: 'bus', raipur: 3.5, durg: 3.75, bilaspur: 5.5 } },
  { id: 'janjgir', name: 'Janjgir', nameHi: 'जांजगीर', region: 'cg', lat: 22.009, lng: 82.5772, fromRaipur: { road: 160, air: 128.9 }, home: { by: 'train', raipur: 3, durg: 3.5, bilaspur: 1 } },
  { id: 'amarkantak', name: 'Amarkantak', nameHi: 'अमरकंटक', region: 'cg', lat: 22.673, lng: 81.7536, fromRaipur: { road: 209, air: 159.7 }, home: { by: 'bus + train', raipur: 5.5, durg: 6.5, bilaspur: 3 } },
  { id: 'korba', name: 'Korba', nameHi: 'कोरबा', region: 'cg', lat: 22.3595, lng: 82.7501, fromRaipur: { road: 216, air: 169 }, home: { by: 'train', raipur: 4, durg: 4.75, bilaspur: 2 } },
  { id: 'raigarh', name: 'Raigarh', nameHi: 'रायगढ़', region: 'cg', lat: 21.8974, lng: 83.395, fromRaipur: { road: 258, air: 196.2 }, home: { by: 'train', raipur: 4, durg: 4.5, bilaspur: 2.25 } },
  { id: 'jagdalpur', name: 'Jagdalpur', nameHi: 'जगदलपुर', region: 'cg', lat: 19.0748, lng: 82.008, fromRaipur: { road: 287, air: 245.3 }, home: { by: 'bus', raipur: 7, durg: 8, bilaspur: 9 } },
  { id: 'ambikapur', name: 'Ambikapur', nameHi: 'अंबिकापुर', region: 'cg', lat: 23.1355, lng: 83.182, fromRaipur: { road: 334, air: 263.6 }, home: { by: 'bus', raipur: 7.5, durg: 8.5, bilaspur: 5.25 } },
  // Other states
  { id: 'gondia', name: 'Gondia', nameHi: 'गोंदिया', region: 'india', lat: 21.4624, lng: 80.192, fromRaipur: { road: 201, air: 147.9 }, home: { by: 'train', raipur: 3, durg: 2.25, bilaspur: 4.5 } },
  { id: 'sambalpur', name: 'Sambalpur', nameHi: 'संबलपुर', region: 'india', lat: 21.4669, lng: 83.9812, fromRaipur: { road: 275, air: 244.8 }, home: { by: 'bus', raipur: 6, durg: 6.5, bilaspur: 4.5 } },
  { id: 'nagpur', name: 'Nagpur', nameHi: 'नागपुर', region: 'india', lat: 21.1458, lng: 79.0882, fromRaipur: { road: 284, air: 263.8 }, home: { by: 'train', raipur: 5, durg: 4.25, bilaspur: 6.5 } },
  { id: 'jharsuguda', name: 'Jharsuguda', nameHi: 'झारसुगुड़ा', region: 'india', lat: 21.8554, lng: 84.0062, fromRaipur: { road: 320, air: 254.9 }, home: { by: 'train', raipur: 5, durg: 6, bilaspur: 3.25 } },
  { id: 'jabalpur', name: 'Jabalpur', nameHi: 'जबलपुर', region: 'india', lat: 23.1815, lng: 79.9864, fromRaipur: { road: 383, air: 273.5 }, home: { by: 'train', raipur: 9, durg: 8.5, bilaspur: 8.5, trains: [{ no: '11702', name: 'Mook Mati Exp', dep: '06:00', hours: 7.8 }, { no: '12854', name: 'Amarkantak Exp', dep: '21:35', hours: 9.3 }] } },
  { id: 'visakhapatnam', name: 'Visakhapatnam', nameHi: 'विशाखापत्तनम', region: 'india', lat: 17.6868, lng: 83.2185, fromRaipur: { road: 546, air: 430 }, home: { by: 'train', raipur: 10, durg: 11, bilaspur: 12, trains: [{ no: '12807', name: 'Samta Exp', dep: '09:20', hours: 9.7 }, { no: '20830', name: 'Vande Bharat', dep: '14:50', hours: 7.2 }, { no: '18530', name: 'VSKP–Durg Exp', dep: '16:50', hours: 11.7 }, { no: '18518', name: 'VSKP–Korba Exp', dep: '21:00', hours: 10 }] } },
  { id: 'bhubaneswar', name: 'Bhubaneswar', nameHi: 'भुवनेश्वर', region: 'india', lat: 20.2961, lng: 85.8245, fromRaipur: { road: 547, air: 449 }, home: { by: 'bus', raipur: 11.5, durg: 12.25, bilaspur: 13.5 } },
  { id: 'puri', name: 'Puri', nameHi: 'पुरी', region: 'india', lat: 19.8135, lng: 85.8312, fromRaipur: { road: 577, air: 465.9 }, home: { by: 'bus', raipur: 13, durg: 13.75, bilaspur: 15 } },
  { id: 'prayagraj', name: 'Prayagraj', nameHi: 'प्रयागराज', region: 'india', lat: 25.4358, lng: 81.8463, fromRaipur: { road: 578, air: 465.9 }, home: { by: 'train', raipur: 13.5, durg: 14.5, bilaspur: 11.5 } },
  { id: 'ranchi', name: 'Ranchi', nameHi: 'रांची', region: 'india', lat: 23.3441, lng: 85.3096, fromRaipur: { road: 616, air: 444 }, home: { by: 'bus', raipur: 12, durg: 12.5, bilaspur: 10 } },
  { id: 'bhopal', name: 'Bhopal', nameHi: 'भोपाल', region: 'india', lat: 23.2599, lng: 77.4126, fromRaipur: { road: 628, air: 488 }, home: { by: 'bus', raipur: 11.75, durg: 12, bilaspur: 13 } },
  { id: 'varanasi', name: 'Varanasi', nameHi: 'वाराणसी', region: 'india', lat: 25.3176, lng: 82.9739, fromRaipur: { road: 644, air: 472.7 }, home: { by: 'train', raipur: 17, durg: 18, bilaspur: 15, trains: [{ no: '15159', name: 'Sarnath Exp', dep: '12:30', hours: 17.25 }, { no: '15231', name: 'Barauni–Gondia Exp', dep: '21:35', hours: 16.75 }] } },
  { id: 'indore', name: 'Indore', nameHi: 'इंदौर', region: 'india', lat: 22.7196, lng: 75.8577, fromRaipur: { road: 727, air: 617.2 }, home: { by: 'bus', raipur: 16.5, durg: 17.25, bilaspur: 18.5 } },
  { id: 'patna', name: 'Patna', nameHi: 'पटना', region: 'india', lat: 25.5941, lng: 85.1376, fromRaipur: { road: 739, air: 601 }, home: { by: 'bus', raipur: 19, durg: 19.75, bilaspur: 21 } },
  { id: 'lucknow', name: 'Lucknow', nameHi: 'लखनऊ', region: 'india', lat: 26.8467, lng: 80.9462, fromRaipur: { road: 779, air: 626.2 }, home: { by: 'train', raipur: 20, durg: 21, bilaspur: 18 } },
  { id: 'hyderabad', name: 'Hyderabad', nameHi: 'हैदराबाद', region: 'india', lat: 17.385, lng: 78.4867, fromRaipur: { road: 780, air: 542 }, home: { by: 'train', raipur: 15, durg: 15, bilaspur: 16.5, trains: [{ no: '12771', name: 'Secunderabad–Raipur Exp', dep: '22:40', hours: 14.7 }] } },
  { id: 'kolkata', name: 'Kolkata', nameHi: 'कोलकाता', region: 'india', lat: 22.5726, lng: 88.3639, fromRaipur: { road: 831, air: 710 }, home: { by: 'train', raipur: 13.25, durg: 14.25, bilaspur: 11.25, trains: [{ no: '12860', name: 'Gitanjali Exp', dep: '13:40', hours: 13 }, { no: '18030', name: 'Shalimar–LTT Exp', dep: '15:00', hours: 15.4 }, { no: '12810', name: 'Howrah–Mumbai Mail', dep: '19:30', hours: 13.2 }, { no: '12130', name: 'Azad Hind Exp', dep: '21:40', hours: 13.2 }, { no: '12834', name: 'Howrah–Ahmedabad Exp', dep: '23:05', hours: 14.4 }] } },
  { id: 'pune', name: 'Pune', nameHi: 'पुणे', region: 'india', lat: 18.5204, lng: 73.8567, fromRaipur: { road: 1007, air: 867 }, home: { by: 'train', raipur: 20, durg: 19.5, bilaspur: 22, trains: [{ no: '12129', name: 'Azad Hind Exp', dep: '18:35', hours: 20 }] } },
  { id: 'mumbai', name: 'Mumbai', nameHi: 'मुंबई', region: 'india', lat: 19.076, lng: 72.8777, fromRaipur: { road: 1118, air: 945 }, home: { by: 'train', raipur: 18, durg: 17.25, bilaspur: 20.5, trains: [{ no: '12859', name: 'Gitanjali Exp', dep: '06:00', hours: 17.5 }, { no: '12809', name: 'Mumbai–Howrah Mail', dep: '21:10', hours: 18.9 }, { no: '18029', name: 'LTT–Shalimar Exp', dep: '22:00', hours: 21.7 }] } },
  { id: 'delhi', name: 'Delhi', nameHi: 'दिल्ली', region: 'india', lat: 28.6139, lng: 77.209, fromRaipur: { road: 1214, air: 946 }, home: { by: 'train', raipur: 22.5, durg: 22, bilaspur: 21, trains: [{ no: '18238', name: 'Chhattisgarh Exp', dep: '04:25', hours: 28 }, { no: '12808', name: 'Samta Exp', dep: '07:00', hours: 22.8 }, { no: '12410', name: 'Gondwana Exp', dep: '15:05', hours: 22.4 }] } },
  { id: 'bengaluru', name: 'Bengaluru', nameHi: 'बेंगलुरु', region: 'india', lat: 12.9716, lng: 77.5946, fromRaipur: { road: 1370, air: 1015.7 }, home: { by: 'train', raipur: 28, durg: 27.25, bilaspur: 30 } },
  { id: 'chennai', name: 'Chennai', nameHi: 'चेन्नई', region: 'india', lat: 13.0827, lng: 80.2707, fromRaipur: { road: 1405, air: 920 }, home: { by: 'train', raipur: 23, durg: 22.25, bilaspur: 25 } },
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
  /** The fewest days the distance allows. */
  minDays: number;
  /** Days charged: minDays, or more if the customer booked more. */
  days: number;
  /** One-way: whole hours after the driving days end until he is home (0 = home in time). */
  returnHours: number;
  /** One-way: he is not home when the driving days end, so a return day is charged. */
  returnDay: boolean;
  /** One-way: hours he is still travelling after the return day ends (charged per hour). */
  lateHours: number;
  /** The start time used, as an hour of the day (7.5 = 7:30 AM). */
  startHour: number;
  /** One-way: hours after the start when he drops the car, leaves by train/bus and is home. */
  dropAt?: number;
  leaveAt?: number;
  homeAt?: number;
  /** One-way: the regular train he catches, on routes with a timetable. */
  train?: HomeTrain;
};

/** When nothing better is known, the estimate assumes the driver leaves at 7 AM. */
export const DEFAULT_START_HOUR = 7;

/**
 * Driving days for a distance: one per kmPerDay, but a little over a full
 * day's drive (up to a tenth of a day, 60 km at 600 km a day) does not add
 * another day — Raipur → Delhi, 1,214 km, is 2 days, not 3.
 */
export function drivingDays(rules: Pick<TripRules, 'kmPerDay'>, km: number): number {
  return Math.max(1, Math.ceil(km / rules.kmPerDay - 0.1));
}

/** Hours of driving for a distance, at averageKmh. */
export const driveHours = (rules: Pick<TripRules, 'averageKmh'>, km: number) => km / rules.averageKmh;

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

/** How the driver gets home from `dest` to `city`, for planTrip. */
export type HomeWay = {
  /** Average hours on board (homeTravelHours). Left out: the distance at busKmh. */
  hours?: number;
  /** Regular trains home (hours to Raipur). */
  trains?: readonly HomeTrain[];
  /** Added to each train's hours: the pickup city's average minus Raipur's. */
  offset?: number;
};

/** The way home from a destination to a pickup city: average hours and the regular trains. */
export function homeWay(dest: Destination, city: PickupCity): HomeWay {
  const hours = homeTravelHours(dest, city) ?? 0;
  return { hours, trains: dest.home.trains, offset: hours - dest.home.raipur };
}

/** "21:35" → 21.583… (hour of the day). */
const clock = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) + (m || 0) / 60;
};

/**
 * The plan for a trip. `startHour` is when the driver leaves (hour of the day,
 * 0–24; DEFAULT_START_HOUR if unknown): on a one-way drop it decides when he
 * drops the car — the last stretch on the last day, at averageKmh — and so
 * which train he can catch and when he is home.
 *
 *   Mumbai, start 7 AM: 2 days, drops ~6:30 PM day 2, 9:10 PM train (19 h)
 *   → home ~4 PM day 3, after day 2 ended at 7 AM: a return day.
 *   Nagpur: drops ~1 PM, home the same evening: no return day.
 */
export function planTrip(
  rules: TripRules,
  km: number,
  kind: TripKind,
  bookedDays = 0,
  home: HomeWay | number = {},
  startHour: number = DEFAULT_START_HOUR,
): TripPlan {
  const way: HomeWay = typeof home === 'number' ? { hours: home } : home;
  const start = Number.isFinite(startHour) ? ((startHour % 24) + 24) % 24 : DEFAULT_START_HOUR;
  const oneWay = Math.max(0, Math.round(km));
  const round = kind === 'round';
  const minDays = round ? roundTripDays(rules, oneWay) : drivingDays(rules, oneWay);
  const days = Math.min(60, Math.max(minDays, Math.floor(bookedDays) || 0));
  const base = { km: oneWay, kind, local: oneWay < rules.localWithinKm, minDays, days, startHour: start };
  if (round || oneWay <= 0) return { ...base, returnHours: 0, returnDay: false, lateHours: 0 };

  const lastDayKm = oneWay - (minDays - 1) * rules.kmPerDay;
  const dropAt = (days - 1) * 24 + driveHours(rules, lastDayKm);
  const ready = dropAt + rules.stationHours;
  let leaveAt = ready;
  let homeAt = ready + (way.hours ?? oneWay / rules.busKmh);
  let train: HomeTrain | undefined;
  for (const t of way.trains ?? []) {
    // The first time this train leaves at or after `ready` (hours after the start).
    const wait = (((clock(t.dep) - (start + ready)) % 24) + 24) % 24;
    const arrives = ready + wait + t.hours + (way.offset ?? 0);
    if (!train || arrives < homeAt) {
      train = t;
      leaveAt = ready + wait;
      homeAt = arrives;
    }
  }
  const returnHours = Math.max(0, Math.ceil(homeAt - days * 24 - 1e-9));
  return {
    ...base,
    returnHours,
    returnDay: returnHours > 0,
    lateHours: Math.max(0, returnHours - 24),
    dropAt,
    leaveAt,
    homeAt,
    ...(train && { train }),
  };
}

/** What `hours` cost at `rate` an hour, at most `maxPerDay` in any 24 hours. */
export function returnCost(hours: number, rate: number, maxPerDay: number): number {
  const h = Math.max(0, Math.round(hours));
  const fullDays = Math.floor(h / 24);
  return fullDays * Math.min(24 * rate, maxPerDay) + Math.min((h - 24 * fullDays) * rate, maxPerDay);
}

/**
 * The way home on a one-way drop, for `hours` after the driving days: nothing
 * if 0; else one return day (`dayPrice`) and, after its 24 hours, `rate` per
 * late hour, at most `dayPrice` in any 24 hours. Mumbai, 7 h after → ₹1,200;
 * 30 h after → ₹1,200 + 6 × ₹120.
 */
export function returnDayCost(hours: number, rate: number, dayPrice: number): number {
  const h = Math.max(0, Math.round(Number.isFinite(hours) ? hours : 0));
  return h > 0 ? dayPrice + returnCost(Math.max(0, h - 24), rate, dayPrice) : 0;
}

/* ----------------------------------------------------------- estimate ---- */

type Money = { from: number; to: number };
export type Estimate = {
  from: number;
  to: number;
  driving: Money;
  /** Return day + late hours. */
  returnCharge: number;
  /** The return day alone (0 if none). */
  returnDayCharge: number;
  /** Late hours after the return day. */
  lateCharge: number;
};

/** What the customer sees: a range, from the per-day price range, plus the return day and any late hours. */
export function estimate(rules: TripRules, plan: Pick<TripPlan, 'days' | 'returnHours'>): Estimate {
  const driving = { from: plan.days * rules.dayRate.from, to: plan.days * rules.dayRate.to };
  const returnCharge = returnDayCost(plan.returnHours, rules.returnHour, rules.returnMaxPerDay);
  const returnDayCharge = plan.returnHours > 0 ? rules.returnMaxPerDay : 0;
  return {
    from: driving.from + returnCharge,
    to: driving.to + returnCharge,
    driving,
    returnCharge,
    returnDayCharge,
    lateCharge: returnCharge - returnDayCharge,
  };
}

/* -------------------------------------------------------------- quote ---- */

export type QuoteInput = {
  /** What this driver charges for one outstation day. */
  driverDayCost: number;
  /** What the driver gets per late hour; his return day is 10 of them. */
  driverReturnHourPay: number;
  days: number;
  /** One-way: hours after the driving days until he is home — any at all means a return day; past 24, late hours. */
  returnHours: number;
  /** Hours beyond hoursPerDay of driving, summed over the trip. */
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
  /** Customer price per late hour: the driver's pay plus the profit, never below returnHour. The return day is 10 of them. */
  returnHourRate: number;
  /** The return day plus any late hours, to the customer. */
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
 * profit, rounded up to the next ₹50 a day (₹10 an hour for overtime and
 * late hours). The return day is the same number of hours as customers were
 * shown (returnMaxPerDay ÷ returnHour, 10), for the driver and the customer
 * alike.
 */
export function quote(rules: TripRules, input: QuoteInput): Quote {
  const days = Math.max(1, whole(input.days));
  const back = whole(input.returnHours);
  const hours = whole(input.extraHours);
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
  const returnCharge = returnDayCost(back, returnHourRate, returnHourRate * capHours);

  const charges = days * dayRate + returnCharge + hours * extraHourRate;
  const driverPay = Math.round(days * cost + returnDayCost(back, backPay, backPay * capHours) + hours * hourCost);
  const partnerPay = Math.round(charges * partner);
  const profit = charges - driverPay - partnerPay;
  const profitPercent = charges > 0 ? Math.round((profit / charges) * 1000) / 10 : 0;
  return {
    dayRate,
    returnHourRate,
    returnCharge,
    extraHourRate,
    charges,
    total: charges + whole(input.ticket),
    driverPay,
    partnerPay,
    profit,
    profitPercent,
    ok: profitPercent + 1e-9 >= input.minProfitPercent,
    aboveShownRange: dayRate > rules.dayRate.to || (back > 0 && returnHourRate > rules.returnHour),
  };
}

/* ------------------------------------------------------- app publishing -- */

/**
 * Everything the mobile app needs for its estimate, worked out here once so
 * the app and the website can never disagree: for each destination and each
 * pickup city, the km, the fewest days for a one-way drop (with the hours
 * after them until he is home, for a 7 AM start — any at all is a return day)
 * and for a round trip. For other start times the app repeats planTrip's
 * last step itself, from `lastDayHours` (driving on the last day), `homeHours`
 * (the average way home to that city) and the destination's regular `trains`
 * (hours to Raipur; the city adds homeHours minus Raipur's).
 */
export function destinationTable(rules: TripRules) {
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return destinations.map((d) => ({
    id: d.id,
    name: d.name,
    nameHi: d.nameHi,
    region: d.region,
    trains: (d.home.trains ?? []).map((t) => ({ ...t })),
    from: Object.fromEntries(
      pickupCities.map((city) => {
        const km = roadKm(city, d);
        const way = homeWay(d, city);
        const one = planTrip(rules, km, 'one-way', 0, way);
        const round = planTrip(rules, km, 'round');
        const lastDayKm = km > 0 ? km - (one.minDays - 1) * rules.kmPerDay : 0;
        return [
          city,
          {
            km,
            oneWay: {
              days: one.minDays,
              returnHours: one.returnHours,
              lastDayHours: r3(driveHours(rules, lastDayKm)),
              homeHours: r3(way.hours ?? 0),
            },
            roundDays: round.minDays,
          },
        ];
      }),
    ) as Record<
      PickupCity,
      {
        km: number;
        oneWay: { days: number; returnHours: number; lastDayHours: number; homeHours: number };
        roundDays: number;
      }
    >,
  }));
}
