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
    "Verified, sober, professional drivers at your doorstep in 30 minutes. DriveBuddy serves Raipur, Bhilai, Durg and Bilaspur, 24 hours a day.",
  locale: 'en_IN',
  region: 'Chhattisgarh',
  country: 'IN',
  phone: '9111473929',
  phoneAlt: '9893302783',
  whatsapp: '919111473929',
  email: 'drivebuddyind@gmail.com',
  priceRange: '₹300–₹1500',
  rating: { value: 4.9, count: 187 },
  foundingYear: '2024',
} as const;

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
