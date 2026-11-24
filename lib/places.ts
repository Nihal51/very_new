/**
 * Every place in India for "Drop the car in" / "Where to?" — not only our
 * curated destinations (lib/outstation.ts).
 *
 * The list is public/data/india-places.json (3,502 places, all 36 states and
 * union territories, by population), fetched by the browser only when a trip
 * form's place box is used (never in the JS bundle). Built by
 * scripts/places/build-places.js from GeoNames (CC BY 4.0, credited under the
 * box and on /about) and the railway stations of datameet/railways (CC0).
 *
 * Pure, no @/ imports: Node tests (scripts/places.test.mjs) run it as it is.
 *
 * A curated destination keeps its measured km, average way home and stations.
 * Any other place: km ≈ the straight line from the pickup city ×
 * outstation.roadFactor (the team confirms on the call); his way home — the
 * train from the place's nearest station when the lookup finds one, else the
 * bus/train average (busKmh, stationHours).
 */

import { airKm, type Destination } from './outstation.ts';

/** One place: [name, state, lat, lng, population, station, altName] in the JSON. */
export type Place = {
  name: string;
  state: string;
  lat: number;
  lng: number;
  population: number;
  /** The nearest railway station's code (datameet), '' if none close by. */
  station: string;
  /** Old or other names, comma-separated ("Allahabad, …" for Prayagraj). */
  altName: string;
};

/** Where the list is served (prefix it with the site's basePath). */
export const PLACES_PATH = '/data/india-places.json';

/** No road to these: a car cannot be driven there, so they are not offered. */
export const NO_ROAD_STATES: readonly string[] = ['Andaman and Nicobar Islands', 'Lakshadweep'];

/** The longest "Name, State" a booking can save (firestore.rules isTrip: to, 2–60 characters). */
export const LABEL_MAX = 60;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/**
 * The JSON → places, every row checked (a name, a state, a point in India, a
 * station code of capital letters or none); odd rows and places without a
 * road are left out. [] for anything that is not the list.
 */
export function parsePlaces(json: unknown): Place[] {
  const rows = json && typeof json === 'object' && Array.isArray((json as { places?: unknown }).places) ? (json as { places: unknown[] }).places : [];
  const out: Place[] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 7) continue;
    const [name, state, lat, lng, population, station, altName] = r;
    if (!isStr(name) || !isStr(state) || !isNum(lat) || !isNum(lng) || !isStr(station) || !isStr(altName)) continue;
    if (name.trim().length < 2 || !state || NO_ROAD_STATES.includes(state)) continue;
    if (lat < 6 || lat > 37 || lng < 68 || lng > 98) continue;
    if (station && !/^[A-Z]{1,5}$/.test(station)) continue;
    out.push({ name: name.trim(), state, lat, lng, population: isNum(population) ? population : 0, station, altName });
  }
  return out;
}

/** "Prayāgrāj" / "PRAYAGRAJ" / "prayag-raj" → "prayagraj" / "prayag raj": no accents or case, words by single spaces. */
export function plainText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "Prayagraj, Uttar Pradesh" — what the booking saves as trip.to (at most LABEL_MAX characters). */
export function placeLabel(p: Pick<Place, 'name' | 'state'>): string {
  const full = `${p.name}, ${p.state}`;
  return full.length <= LABEL_MAX ? full : p.name.slice(0, LABEL_MAX);
}

/** A result in the place box: one of our destinations, or a place from the list. */
export type PlaceEntry = {
  /** Ours (lib/outstation.ts destinations): its exact km, way home and stations. */
  dest?: Destination;
  /** From the list: km from the map. */
  place?: Place;
  name: string;
  state: string;
  lat: number;
  lng: number;
  population: number;
  /** Searchable: the name, the other names and the state, plain. */
  keys: { name: string; alt: string[]; state: string };
};

const altNames = (alt: string) =>
  alt
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);

/**
 * The search index: our destinations first (each with the state and other
 * names of the same place in the list, within 40 km), then every other place.
 * A place that is one of ours appears once, as ours.
 */
export function placeIndex(places: readonly Place[], curated: readonly Destination[]): PlaceEntry[] {
  const taken = new Set<Place>();
  // Names without spaces, so "Raj-Nandgaon" is our Rajnandgaon.
  const squash = (x: string) => plainText(x).replace(/ /g, '');
  const plainNames = new Map(places.map((p) => [p, [squash(p.name), ...altNames(p.altName).map(squash)]]));
  const ours: PlaceEntry[] = curated.map((d) => {
    const n = squash(d.name);
    let match: Place | undefined;
    let best = 40;
    for (const p of places) {
      if (taken.has(p) || !plainNames.get(p)!.includes(n)) continue;
      const km = airKm(d, p);
      if (km < best) {
        best = km;
        match = p;
      }
    }
    if (match) taken.add(match);
    return {
      dest: d,
      name: d.name,
      state: match?.state ?? (d.region === 'cg' ? 'Chhattisgarh' : ''),
      lat: d.lat,
      lng: d.lng,
      population: match?.population ?? 0,
      keys: {
        name: plainText(d.name),
        alt: match ? [plainText(match.name), ...altNames(match.altName).map(plainText)].filter((a) => a !== plainText(d.name)) : [],
        state: plainText(match?.state ?? (d.region === 'cg' ? 'Chhattisgarh' : '')),
      },
    };
  });
  const rest: PlaceEntry[] = places
    .filter((p) => !taken.has(p))
    .map((p) => ({
      place: p,
      name: p.name,
      state: p.state,
      lat: p.lat,
      lng: p.lng,
      population: p.population,
      keys: { name: plainText(p.name), alt: altNames(p.altName).map(plainText), state: plainText(p.state) },
    }));
  return [...ours, ...rest];
}

/** "navi mumbai east" → ["mumbai east", "east"]: the name from each word after the first. */
const laterWords = (n: string) => {
  const w = n.split(' ');
  return w.slice(1).map((_, i) => w.slice(i + 1).join(' '));
};

/**
 * How well `e` matches the plain query `q`: 0 its name (or another name)
 * begins with it, 1 a word of it does, 2 its state begins with it (typing a
 * state lists its places), 3 the query is inside a name; undefined: no match.
 */
function tier(e: PlaceEntry, q: string): number | undefined {
  const names = [e.keys.name, ...e.keys.alt];
  if (names.some((n) => n.startsWith(q))) return 0;
  if (names.some((n) => laterWords(n).some((rest) => rest.startsWith(q)))) return 1;
  if (q.length >= 3 && e.keys.state.startsWith(q)) return 2;
  if (q.length >= 3 && names.some((n) => n.includes(q))) return 3;
  return undefined;
}

/**
 * The places matching `query` (2 letters or more), best first: names that
 * begin with it, then a word that does, then the state's places, then the
 * names it is inside; within each, ours first, then the biggest. At most
 * `limit`.
 *   "allahabad" → Prayagraj; "kochi" → Kochi; "kerala" → Kerala's places.
 */
export function searchPlaces(index: readonly PlaceEntry[], query: string, limit = 20): PlaceEntry[] {
  const q = plainText(query);
  if (q.length < 2) return [];
  const hits: { e: PlaceEntry; t: number; i: number }[] = [];
  index.forEach((e, i) => {
    const t = tier(e, q);
    if (t !== undefined) hits.push({ e, t, i });
  });
  hits.sort((a, b) => a.t - b.t || (a.e.dest ? 0 : 1) - (b.e.dest ? 0 : 1) || b.e.population - a.e.population || a.i - b.i);
  return hits.slice(0, limit).map((h) => h.e);
}

/**
 * One-way road km to a place not in our list: the straight line from the
 * pickup city × roadFactor (roads wind), to the km. Raipur → Ambikapur:
 * 266 km × 1.3 ≈ 346 km (measured: 334).
 */
export function placeKm(from: { lat: number; lng: number }, place: { lat: number; lng: number }, roadFactor: number): number {
  return Math.round(airKm(from, place) * roadFactor);
}

/**
 * Station codes the timetables have renamed since the station list was made
 * (the train lookup asks with today's code).
 */
export const RENAMED_STATIONS: Readonly<Record<string, string>> = {
  ALD: 'PRYJ', //  Allahabad Jn → Prayagraj Jn
  ALY: 'PRRB', //  Allahabad City → Prayagraj Rambagh
  MGS: 'DDU', //   Mughal Sarai → Pt. Deen Dayal Upadhyaya Jn
  FD: 'AYC', //    Faizabad → Ayodhya Cantt
  HBJ: 'RKMP', //  Habibganj → Rani Kamlapati
  JHS: 'VGLB', //  Jhansi → Virangana Lakshmibai
  MUV: 'BSBS', //  Manduadih → Banaras
};

/** The place's station for the train lookup (today's code), or '' when it has none. */
export const placeStation = (p: Pick<Place, 'station'>) => (p.station ? (RENAMED_STATIONS[p.station] ?? p.station) : '');
