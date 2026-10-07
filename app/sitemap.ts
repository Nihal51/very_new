import type { MetadataRoute } from 'next';

import { cities, services } from '@/lib/content';
import { site } from '@/lib/site';

/**
 * Static sitemap. Priorities are deliberately conservative: the home page and
 * the four city pages are the ones we actually want ranking; the legal pages
 * are listed only so they are discoverable.
 */
export const dynamic = 'force-static';

type Entry = MetadataRoute.Sitemap[number];

/* Build time, not a hardcoded date. `force-static` evaluates this once during
   `next build`, so every deploy stamps the day it actually shipped instead of
   slowly drifting into a lie about when the content last changed. */
const LAST_MODIFIED = new Date();

const CORE: ReadonlyArray<Pick<Entry, 'url' | 'changeFrequency' | 'priority'>> = [
  { url: '/', changeFrequency: 'weekly', priority: 1 },
  { url: '/services/', changeFrequency: 'monthly', priority: 0.9 },
  { url: '/pricing/', changeFrequency: 'monthly', priority: 0.9 },
  { url: '/book/', changeFrequency: 'monthly', priority: 0.9 },
  { url: '/cities/', changeFrequency: 'monthly', priority: 0.8 },
  { url: '/drivers/', changeFrequency: 'monthly', priority: 0.7 },
  { url: '/faq/', changeFrequency: 'monthly', priority: 0.7 },
  { url: '/about/', changeFrequency: 'yearly', priority: 0.6 },
  { url: '/contact/', changeFrequency: 'yearly', priority: 0.6 },
  { url: '/privacy/', changeFrequency: 'yearly', priority: 0.3 },
  { url: '/terms/', changeFrequency: 'yearly', priority: 0.3 },
];

/** hreflang for an English/Hindi pair — the same block on both entries. */
const pair = (en: string, hi: string): Entry['alternates'] => ({
  languages: { 'en-IN': `${site.url}${en}`, 'hi-IN': `${site.url}${hi}` },
});

export default function sitemap(): MetadataRoute.Sitemap {
  const core: Entry[] = CORE.map((entry) => ({
    ...entry,
    url: `${site.url}${entry.url}`,
    lastModified: LAST_MODIFIED,
    ...(entry.url === '/' && { alternates: pair('/', '/hi/') }),
  }));

  const cityPages: Entry[] = cities.map((city) => ({
    url: `${site.url}/cities/${city.slug}/`,
    lastModified: LAST_MODIFIED,
    changeFrequency: 'weekly',
    priority: 0.9,
    alternates: pair(`/cities/${city.slug}/`, `/hi/cities/${city.slug}/`),
  }));

  const servicePages: Entry[] = services.map((service) => ({
    url: `${site.url}/services/${service.slug}/`,
    lastModified: LAST_MODIFIED,
    changeFrequency: 'monthly',
    priority: 0.8,
  }));

  /* Hindi pages. Each pair carries the same hreflang block on both entries, as
     Google requires; the pages repeat it in their own <head>. */
  const hindiPages: Entry[] = [
    {
      url: `${site.url}/hi/`,
      lastModified: LAST_MODIFIED,
      changeFrequency: 'weekly',
      priority: 0.9,
      alternates: pair('/', '/hi/'),
    },
    ...cities.map(
      (city): Entry => ({
        url: `${site.url}/hi/cities/${city.slug}/`,
        lastModified: LAST_MODIFIED,
        changeFrequency: 'weekly',
        priority: 0.8,
        alternates: pair(`/cities/${city.slug}/`, `/hi/cities/${city.slug}/`),
      }),
    ),
  ];

  return [...core, ...cityPages, ...servicePages, ...hindiPages];
}
