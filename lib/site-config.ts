/**
 * siteConfig — the single source of truth for every business / contact fact.
 *
 * Business name, phone numbers, email, WhatsApp, the registered address, the
 * working hours and the list of cities we serve all live here and nowhere
 * else. Edit a detail once, in this file, and it propagates everywhere:
 *
 *   - lib/site.ts        derives the `site` object (and tel:/mailto:/wa.me
 *                        helpers) from here, so every page and component that
 *                        already imports from '@/lib/site' updates for free.
 *   - lib/schema.ts      reads the address, hours and service areas for the
 *                        JSON-LD LocalBusiness / per-city structured data.
 *   - lib/content.ts     builds the city pages' slug + name from `serviceAreas`
 *                        and interpolates the phone number into FAQ answers.
 *
 * Nothing in here is a secret — these are the details we publish on the site.
 */

/*
 * Canonical origin. Comes from `NEXT_PUBLIC_SITE_URL` at build time if set,
 * otherwise the fallback literal below. Trailing slashes are stripped so
 * `${siteConfig.url}/book/` can never double up. `||` (not `??`) on purpose:
 * CI and hosts commonly pass an unset variable through as an empty string,
 * which must fall back too. The fallback matches the domain in the repo-root
 * CNAME file — change both together.
 */
const canonicalOrigin = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://thedrivebuddy.in'
).replace(/\/+$/, '');

export const siteConfig = {
  /* -------------------------------------------------------------- identity */
  name: 'DriveBuddy',
  legalName: 'DriveBuddy Driver Services',
  tagline: 'Premium Driver Services',
  slogan: 'Your car. Our driver.',
  description:
    "Verified, sober, professional drivers at your doorstep in 30 minutes. DriveBuddy serves Raipur, Bhilai, Durg and Bilaspur, 24 hours a day.",
  foundingYear: '2024',
  url: canonicalOrigin,

  /* --------------------------------------------------------------- contact */
  /** Primary number, plain 10-digit form. Formatting / `tel:` live in site.ts. */
  phone: '9111473929',
  /** Secondary number for overflow / backup dispatch. */
  phoneAlt: '9893302783',
  /** WhatsApp number in wa.me form: country code + number, no `+` or spaces. */
  whatsapp: '919111473929',
  email: 'drivebuddyind@gmail.com',

  /* ---------------------------------------------------------- locale / geo */
  locale: 'en_IN',
  region: 'Chhattisgarh',
  country: 'IN',

  /** Registered / head-office address used for the LocalBusiness schema. */
  address: {
    locality: 'Raipur',
    region: 'Chhattisgarh',
    country: 'IN',
  },

  /* ------------------------------------------------------- service areas -- */
  /**
   * Canonical list of cities we serve. `slug` drives the /cities/[city] routes
   * and `name` is the display label. The rich per-city marketing copy hangs off
   * these slugs in lib/content.ts — this stays the authoritative list, so add
   * or reorder a city here and the pages, nav and schema follow.
   */
  serviceAreas: [
    { slug: 'raipur', name: 'Raipur' },
    { slug: 'bhilai', name: 'Bhilai' },
    { slug: 'durg', name: 'Durg' },
    { slug: 'bilaspur', name: 'Bilaspur' },
  ],

  /* --------------------------------------------------------- working hours */
  /** Open 24/7. `days` + `opens`/`closes` feed the OpeningHoursSpecification. */
  hours: {
    label: '24 hours a day, 7 days a week',
    days: [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ],
    opens: '00:00',
    closes: '23:59',
  },

  /* ------------------------------------------------------------ commercial */
  priceRange: '₹300–₹1500',
  rating: { value: 4.9, count: 187 },
} as const;

export type SiteConfig = typeof siteConfig;
