/**
 * Local search pages — the "driver in <place>" and "<service> in <city>" pages.
 *
 * People search the way they talk: "driver service in Arang", "driver in Shankar
 * Nagar", "monthly driver in Bhilai", "acting driver near me". Each of those
 * searches gets one page here that answers it, so Google has a page to rank for
 * the exact place and service instead of guessing from the city page.
 *
 * Rules that keep these pages on the right side of Google's doorway-page policy:
 *  - Only places the owner confirmed we actually serve (8 Oct 2026: the four
 *    cities, Arang, Naya Raipur, Abhanpur, Kumhari and Tilda-Neora). Do not add a
 *    town here until a driver can really be sent there.
 *  - Every page carries something true and specific to the place (distance, the
 *    road it sits on, the landmarks, the areas next to it), not just a swapped name.
 *  - Towns outside the four cities never claim the 30-minute arrival: the driver
 *    travels from the city pool, so the time is given on the call.
 */

import { cities, services, type City, type Service } from './content';

/* ------------------------------------------------------------------ helpers */

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** First candidate that fits Google's title space once the layout adds " · DriveBuddy". */
export function fitTitle(first: string, ...rest: string[]): string {
  const all = [first, ...rest];
  return all.find((t) => t.length <= 52) ?? all[all.length - 1] ?? first;
}

/** First candidate inside the 70–160 character band Google shows in results. */
export function fitDescription(first: string, ...rest: string[]): string {
  const all = [first, ...rest];
  return all.find((d) => d.length >= 70 && d.length <= 160) ?? `${(all[all.length - 1] ?? first).slice(0, 157)}…`;
}

/* -------------------------------------------------------------------- towns */

export type Town = {
  slug: string;
  name: string;
  /** The city whose driver pool serves this town. */
  servedFrom: City['slug'];
  /** Roughly how far from the city centre, by road. */
  km: number;
  /** One true sentence about where the town sits and how we reach it. */
  where: string;
  landmarks: string[];
  /** What people here usually book us for. */
  popular: string;
  /** Other names people type for the town. */
  alsoCalled?: string;
};

/** Confirmed by the owner on 8 Oct 2026. */
export const towns: Town[] = [
  {
    slug: 'naya-raipur',
    name: 'Naya Raipur',
    alsoCalled: 'Atal Nagar (Nava Raipur)',
    servedFrom: 'raipur',
    km: 20,
    where:
      'Naya Raipur (Atal Nagar) is the new capital area beyond the airport at Mana, joined to Raipur by the expressway, so drivers from our Raipur pool reach it directly.',
    landmarks: [
      'Mantralaya (Mahanadi Bhawan)',
      'Shaheed Veer Narayan Singh International Cricket Stadium',
      'Nandan Van Jungle Safari',
      'IIIT Naya Raipur',
      'Swami Vivekananda Airport, Mana',
    ],
    popular: 'Office commutes to the Mantralaya and airport transfers',
  },
  {
    slug: 'arang',
    name: 'Arang',
    servedFrom: 'raipur',
    km: 35,
    where:
      'Arang sits on the highway east of Raipur towards Mahasamund, so a driver from our Raipur pool comes out along NH-53.',
    landmarks: ['Bhand Deval temple', 'Arang bus stand', 'Mahanadi river bank', 'NH-53 towards Mahasamund'],
    popular: 'Trips into Raipur for hospital visits, shopping and the airport',
  },
  {
    slug: 'abhanpur',
    name: 'Abhanpur',
    servedFrom: 'raipur',
    km: 25,
    where:
      'Abhanpur is on the Raipur–Dhamtari road south-east of the city, close to Naya Raipur, and is served by our Raipur pool.',
    landmarks: ['Abhanpur bus stand', 'Raipur–Dhamtari road (NH-30)', 'Naya Raipur side road'],
    popular: 'Rides into Raipur and longer drives towards Dhamtari',
  },
  {
    slug: 'kumhari',
    name: 'Kumhari',
    servedFrom: 'raipur',
    km: 20,
    where:
      'Kumhari lies on the Raipur–Bhilai highway, halfway between the two cities, so we send whichever of the Raipur or Bhilai drivers is closer.',
    landmarks: ['Raipur–Bhilai highway (NH-53)', 'Kumhari market', 'Road to Bhilai and Durg'],
    popular: 'Daily trips to Raipur, Bhilai and Durg',
  },
  {
    slug: 'tilda-neora',
    name: 'Tilda-Neora',
    alsoCalled: 'Tilda',
    servedFrom: 'raipur',
    km: 45,
    where:
      'Tilda-Neora is north of Raipur on the Raipur–Bilaspur railway line, and a driver from our Raipur pool comes out to you.',
    landmarks: ['Tilda-Neora railway station', 'Tilda market', 'Road to Raipur'],
    popular: 'Long drives into Raipur for the airport, hospitals and family visits',
  },
];

/* ---------------------------------------------------------------- localities */

export type Locality = {
  slug: string;
  name: string;
  city: City;
};

/** The neighbourhoods each city page already lists, one page each. "Sector 1 to Sector 10" is a range, not a place, so it is skipped. */
export const localities: Locality[] = cities.flatMap((city) =>
  city.areas
    .filter((a) => !/\bto\b/i.test(a))
    .map((name) => ({ slug: `${slugify(name)}-${city.slug}`, name, city })),
);

/* --------------------------------------------------------------------- places */

/** One entry per /driver-in/<slug>/ page. */
export type Place =
  | { kind: 'town'; slug: string; name: string; label: string; town: Town; city: City }
  | { kind: 'locality'; slug: string; name: string; label: string; city: City };

export const places: Place[] = [
  ...towns.map((town): Place => {
    const city = cities.find((c) => c.slug === town.servedFrom)!;
    return { kind: 'town', slug: town.slug, name: town.name, label: town.name, town, city };
  }),
  ...localities.map(
    (l): Place => ({ kind: 'locality', slug: l.slug, name: l.name, label: `${l.name}, ${l.city.name}`, city: l.city }),
  ),
];

export const getPlace = (slug: string) => places.find((p) => p.slug === slug);

export const placePath = (p: Pick<Place, 'slug'>) => `/driver-in/${p.slug}/`;

/** Localities of a city, for linking from the city page. */
export const localitiesOf = (citySlug: string) =>
  places.filter((p) => p.kind === 'locality' && p.city.slug === citySlug);

/** Towns served from a city's pool. */
export const townsNear = (citySlug: string) => places.filter((p) => p.kind === 'town' && p.city.slug === citySlug);

/** A few other pages in the same city, so every page links onward. */
export function nearbyPlaces(place: Place, n = 8) {
  const same = places.filter((p) => p.slug !== place.slug && p.city.slug === place.city.slug);
  // Start just after this place so neighbouring pages don't all link to the same few.
  const i = places.findIndex((p) => p.slug === place.slug);
  return [...same.filter((p) => places.indexOf(p) > i), ...same.filter((p) => places.indexOf(p) < i)].slice(0, n);
}

/* ------------------------------------------------------- city × service pages */

/**
 * The words people actually type for each service, used in the page copy so the
 * page answers every phrasing — not as a hidden keyword list.
 */
export const serviceSearchTerms: Record<string, string[]> = {
  'personal-driver': ['driver on call', 'acting driver', 'driver for hire', 'car driver for a day'],
  'medical-transport': ['driver for hospital visits', 'driver for a patient', 'hospital drop driver'],
  'night-safety-driver': ['night driver', 'late-night driver', 'driver for a night out'],
  'airport-outstation': ['airport drop driver', 'outstation driver', 'driver for a long trip'],
  'monthly-driver': ['permanent driver', 'full-time car driver', 'monthly car driver'],
  'wedding-event-driver': ['wedding driver', 'driver for a function', 'driver for guest pickups'],
  'one-way-car-drop': ['one-way driver', 'car drop driver', 'driver to deliver my car'],
};

export const cityServicePath = (city: Pick<City, 'slug'>, service: Pick<Service, 'slug'>) =>
  `/cities/${city.slug}/${service.slug}/`;

export const cityServicePairs = cities.flatMap((city) => services.map((service) => ({ city, service })));
