/**
 * Company details, navigation and SEO basics, re-exported for convenience.
 *
 * The underlying business / contact facts now live in one place —
 * `lib/site-config.ts`. This module derives the `site` object from that config
 * and adds the link helpers (`tel:` / `mailto:` / `wa.me`, phone formatting) so
 * that everything already importing from '@/lib/site' keeps working unchanged.
 * To edit a phone number, the email, the address or the service-area list,
 * change `lib/site-config.ts`; do not hard-code values here.
 */

import { siteConfig } from './site-config';

export const site = {
  name: siteConfig.name,
  legalName: siteConfig.legalName,
  url: siteConfig.url,
  tagline: siteConfig.tagline,
  description: siteConfig.description,
  locale: siteConfig.locale,
  region: siteConfig.region,
  country: siteConfig.country,
  phone: siteConfig.phone,
  phoneAlt: siteConfig.phoneAlt,
  whatsapp: siteConfig.whatsapp,
  email: siteConfig.email,
  priceRange: siteConfig.priceRange,
  rating: siteConfig.rating,
  foundingYear: siteConfig.foundingYear,
} as const;

/**
 * Prefix for files served straight out of `public/`. Empty on a normal domain;
 * on a GitHub Pages project site it is `/<repo>`, and without it the logo and
 * favicon 404. `next/image` does not apply basePath when images are unoptimized,
 * so raw `public/` paths must go through here.
 */
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
export const asset = (path: string) => `${basePath}${path}`;

/** `tel:` href for the primary number, in E.164. */
export const telHref = `tel:+91${site.phone}`;
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
