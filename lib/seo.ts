import type { Metadata } from 'next';
import { site } from './site';

/**
 * Per-page metadata in one call, so no page can forget its canonical or OG tags.
 * `path` must include the trailing slash to match `trailingSlash: true` output.
 */
export function pageMeta({
  title,
  description,
  path,
  ogImageAlt,
  noIndex = false,
}: {
  title: string;
  description: string;
  path: string;
  ogImageAlt?: string;
  noIndex?: boolean;
}): Metadata {
  /* Built by concatenation, not `new URL(path, site.url)`. An absolute pathname
     resets the base's own path, so on a sub-path deployment (GitHub Pages
     project sites) `new URL('/pricing/', 'https://x.io/repo')` silently yields
     'https://x.io/pricing/' — a canonical pointing at a 404. */
  const url = `${site.url}${path}`;
  const ogImage = `${site.url}/og.png`;

  // The root layout appends " · DriveBuddy" via the title template. A page whose
  // title already names the brand opts out, so it never reads "… DriveBuddy · DriveBuddy".
  const resolvedTitle = title.includes(site.name) ? { absolute: title } : title;

  return {
    title: resolvedTitle,
    description,
    alternates: { canonical: url },
    ...(noIndex && { robots: { index: false, follow: true } }),
    openGraph: {
      type: 'website',
      siteName: site.name,
      locale: site.locale,
      url,
      // `title` here is the full string, not the template — social cards have no
      // room for the suffix the browser tab uses.
      title,
      description,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: ogImageAlt ?? `${site.name} — verified drivers on demand in ${site.region}`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
  };
}
