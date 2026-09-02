/**
 * Single source of truth for company details, navigation and SEO basics.
 *
 * The canonical origin comes from `NEXT_PUBLIC_SITE_URL` if it is set at build
 * time (every host below supports build env vars), otherwise from the fallback
 * literal — so you can point the site at the real domain either by setting one
 * variable on the host or by editing one line here. Canonical tags, the sitemap,
 * robots.txt, Open Graph and every JSON-LD `@id` all derive from it.
 */

/* Trailing slashes are stripped so `${site.url}/book/` can never double up.
   `||` rather than `??` on purpose: hosts and CI commonly pass an unset
   variable through as an empty string, which must fall back too.
   The fallback matches the domain in the repo-root CNAME file — change both. */
const canonicalOrigin = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://thedrivebuddy.in'
).replace(/\/+$/, '');

export const site = {
  name: 'DriveBuddy',
  legalName: 'DriveBuddy Driver Services',
  url: canonicalOrigin,
  tagline: 'Premium Driver Services',
  description:
    'Driver service in Chhattisgarh: verified, sober, professional drivers at your doorstep in 30 minutes. DriveBuddy serves Raipur, Bhilai, Durg and Bilaspur, 24/7.',
  locale: 'en_IN',
  region: 'Chhattisgarh',
  country: 'IN',
  phone: '9111473929',
  phoneAlt: '9893302783',
  whatsapp: '919111473929',
  email: 'drivebuddyind@gmail.com',
  priceRange: '₹300–₹1500',
  /* No `rating` field. One used to live here — `{ value: 4.9, count: 187 }` — and fed
     a line in the home hero reading "4.9 from 187 reviews". The owner confirmed on
     2 Sep 2026 that the figure was invented, so both are gone. Deleting the field
     rather than zeroing it is deliberate: there is now nothing to wire back up by
     accident, and `scripts/audit.mjs` fails the build if a rating, review count or
     customer total reappears in the rendered text. Real ratings live on the Google
     Business Profile, where real customers put them. */
  foundingYear: '2024',
  /** The other spellings people type, and the one the Google Business Profile is
      registered under ("The Drive Buddy"). Fed into JSON-LD so every spelling of
      the name resolves to this one official site. */
  alternateName: ['Drive Buddy', 'The Drive Buddy'],
} as const;

/**
 * Public profiles for this business. Paste your real profile URLs here — Instagram,
 * Facebook, YouTube, and especially your Google Business Profile "share" link — and
 * they flow automatically into the JSON-LD `sameAs` on every page. This is one of the
 * strongest brand signals you can give Google: it ties all of your official pages to a
 * single entity and helps a "DriveBuddy" knowledge panel show up on the right.
 * Uncomment and replace the examples once the accounts exist.
 */
export const socialProfiles: string[] = [
  'https://www.instagram.com/the_drivebuddy/',
  /* The Google Business Profile, via the share link Maps generates. This is the
     strongest entry in this list: it is what ties the website to the map listing
     so Google treats them as one business instead of two. */
  'https://maps.app.goo.gl/5yJuHkFUZXmYgVhJ6',
  // 'https://www.facebook.com/your_page',
];

/**
 * Prefix for files served straight out of `public/`. Empty on a normal domain;
 * on a GitHub Pages project site it is `/<repo>`, and without it the logo and
 * favicon 404. `next/image` does not apply basePath when images are unoptimized,
 * so raw `public/` paths must go through here.
 */
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
export const asset = (path: string) => `${basePath}${path}`;

/** `tel:` href for the primary number, in E.164. */export const telHref = `tel:+91${site.phone}`;
export const telHrefAlt = `tel:+91${site.phoneAlt}`;
export const mailHref = `mailto:${site.email}`;

/** Pretty-print an Indian mobile number as `+91 91114 73929`. */
export function formatPhone(raw: string): string {
  return `+91 ${raw.slice(0, 5)} ${raw.slice(5)}`;
}

/** Build a wa.me link with a pre-filled message. */
export function waHref(message?: string): string {
  const base = `https://wa.me/${site.whatsapp}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

export const nav = [
  { href: '/services/', label: 'Services' },
  { href: '/pricing/', label: 'Pricing' },
  { href: '/cities/', label: 'Cities' },
  { href: '/drivers/', label: 'Join as Driver' },
  { href: '/faq/', label: 'FAQ' },
  { href: '/contact/', label: 'Contact' },
] as const;
