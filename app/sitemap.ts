import type { MetadataRoute } from 'next';

import { cities } from '@/lib/content';
import { site } from '@/lib/site';

/**
 * Static sitemap. Priorities are deliberately conservative: the home page and
 * the four city pages are the ones we actually want ranking; the legal pages
 * are listed only so they are discoverable.
 */
export const dynamic = 'force-static';

type Entry = MetadataRoute.Sitemap[number];

const LAST_MODIFIED = new Date('2026-08-22T00:00:00.000Z');

const CORE: ReadonlyArray<Pick<Entry, 'url' | 'changeFrequency' | 'priority'>> = [
  { url: '/', changeFrequency: 'weekly', priority: 1 },
  { url: '/services/', changeFrequency: 'monthly', priority: 0.9 },
  { url: '/pricing/', changeFrequency: 'monthly', priority: 0.9 },
  { url: '/book/', changeFrequency: 'monthly', priority: 0.9 },
  { url: '/cities/', changeFrequency: 'monthly', priority: 0.8 },
  { url: '/drivers/', changeFrequency: 'monthly', priority: 0.7 },
  { url: '/faq/', changeFrequency: 'monthly', priority: 0.7 },
  { url: '/contact/', changeFrequency: 'yearly', priority: 0.6 },
  { url: '/privacy/', changeFrequency: 'yearly', priority: 0.3 },
  { url: '/terms/', changeFrequency: 'yearly', priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const core: Entry[] = CORE.map((entry) => ({
    ...entry,
    url: `${site.url}${entry.url}`,
    lastModified: LAST_MODIFIED,
  }));

  const cityPages: Entry[] = cities.map((city) => ({
    url: `${site.url}/cities/${city.slug}/`,
    lastModified: LAST_MODIFIED,
    changeFrequency: 'weekly',
    priority: 0.9,
  }));

  return [...core, ...cityPages];
}
