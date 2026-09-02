/**
 * JSON-LD builders. Kept out of the components so the shape of the structured
 * data is reviewable in one place, and every page emits a consistent graph.
 */

import { site, socialProfiles } from './site';
import { cities, faqs, plans, services, testimonials } from './content';

/* Concatenated rather than `new URL(path, site.url)`: an absolute pathname
   resets the base's own path, so on a sub-path deployment the "/" in "/og.png"
   would silently drop the prefix and every @id would point at a 404. */
const abs = (path = '/') => `${site.url}${path}`;

const ORG_ID = `${site.url}/#business`;

/** Registered business location = the HQ city (Raipur, first in the list). */
const HQ_GEO = cities[0]?.geo ?? { lat: 21.2514, lng: 81.6296 };

/**
 * The whole state, as a schema.org place. Listed alongside the individual cities
 * in `areaServed` so a state-level query ("driver service in Chhattisgarh") has
 * something to match: four City nodes do not, on their own, tell Google the
 * business serves the administrative area that contains them.
 */
const STATE_AREA = {
  '@type': 'State',
  name: site.region,
  containedInPlace: { '@type': 'Country', name: 'India' },
} as const;

/** Cities plus the state that contains them — the full service area. */
const SERVICE_AREA = [
  STATE_AREA,
  ...cities.map((c) => ({
    '@type': 'City' as const,
    name: c.name,
    geo: {
      '@type': 'GeoCoordinates' as const,
      latitude: String(c.geo.lat),
      longitude: String(c.geo.lng),
    },
    containedInPlace: STATE_AREA,
  })),
];

/** LocalBusiness — the anchor entity every other node points at. */
export function localBusinessSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': ['LocalBusiness', 'ProfessionalService'],
    '@id': ORG_ID,
    name: site.name,
    legalName: site.legalName,
    alternateName: site.alternateName,
    description: site.description,
    url: abs('/'),
    image: abs('/og.png'),
    logo: abs('/assets/logo.png'),
    telephone: `+91${site.phone}`,
    email: site.email,
    contactPoint: [
      {
        '@type': 'ContactPoint',
        telephone: `+91${site.phone}`,
        contactType: 'customer service',
        areaServed: site.country,
        availableLanguage: ['en', 'hi'],
      },
      {
        '@type': 'ContactPoint',
        telephone: `+91${site.phoneAlt}`,
        contactType: 'customer service',
        availableLanguage: ['en', 'hi'],
      },
    ],
    knowsLanguage: ['en', 'hi'],
    priceRange: site.priceRange,
    currenciesAccepted: 'INR',
    paymentAccepted: 'Cash, UPI, Bank transfer',
    foundingDate: site.foundingYear,
    slogan: 'Your car. Our driver.',
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Raipur',
      addressRegion: site.region,
      addressCountry: site.country,
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: String(HQ_GEO.lat),
      longitude: String(HQ_GEO.lng),
    },
    areaServed: SERVICE_AREA,
    openingHoursSpecification: [
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: [
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
    ],
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: String(site.rating.value),
      reviewCount: String(site.rating.count),
      bestRating: '5',
      worstRating: '1',
    },
    review: testimonials.map((t) => ({
      '@type': 'Review',
      reviewRating: { '@type': 'Rating', ratingValue: '5', bestRating: '5' },
      author: { '@type': 'Person', name: t.name },
      reviewBody: t.quote,
    })),
    makesOffer: services.map((s) => ({
      '@type': 'Offer',
      itemOffered: { '@type': 'Service', name: s.title, description: s.short },
    })),
    sameAs: [`https://wa.me/${site.whatsapp}`, ...socialProfiles],
  };
}

/**
 * WebSite entity. Ties the brand name — and its two-word spelling — to this one
 * official domain, so a search for "DriveBuddy" or "Drive Buddy" resolves here and
 * Google can treat the site as the brand's home. No SearchAction is declared: this
 * is a static brochure site with no internal search endpoint to point a query at.
 */
export function websiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${site.url}/#website`,
    name: site.name,
    alternateName: site.alternateName,
    url: abs('/'),
    inLanguage: 'en-IN',
    publisher: { '@id': ORG_ID },
  };
}

/**
 * The offering itself, as one entity: "driver service, provided in Chhattisgarh".
 *
 * The LocalBusiness node says who we are and where we are; this says what we
 * sell and where we sell it. Search engines resolve a query like "driver service
 * in Chhattisgarh" against the *service* — its serviceType and its areaServed —
 * so without this node the site only ever answers "driver in <city>". Emitted on
 * the home page, which is the page that targets the state-level query.
 */
export function driverServiceSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${site.url}/#driver-service`,
    name: `Driver service in ${site.region}`,
    serviceType: 'Driver service',
    alternateName: [
      'Driver on call',
      'Driver on demand',
      'Call driver',
      'Acting driver',
      'Chauffeur service',
    ],
    description: site.description,
    url: abs('/'),
    image: abs('/og.png'),
    provider: { '@id': ORG_ID },
    areaServed: SERVICE_AREA,
    availableChannel: {
      '@type': 'ServiceChannel',
      serviceUrl: abs('/book/'),
      servicePhone: { '@type': 'ContactPoint', telephone: `+91${site.phone}` },
      availableLanguage: ['en', 'hi'],
    },
    audience: { '@type': 'Audience', audienceType: 'Car owners' },
    /* The individual offerings, so the one Service node covers every variant a
       searcher might name instead of the generic term. */
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: `${site.name} driver services`,
      itemListElement: services.map((s) => ({
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Service',
          '@id': `${abs('/services/')}#${s.slug}`,
          name: s.title,
          description: s.short,
        },
      })),
    },
    offers: {
      '@type': 'Offer',
      priceCurrency: 'INR',
      priceSpecification: {
        '@type': 'PriceSpecification',
        minPrice: '300',
        maxPrice: '1500',
        priceCurrency: 'INR',
      },
      availability: 'https://schema.org/InStock',
      areaServed: SERVICE_AREA,
    },
  };
}

/** One Service node per offering, on /services. */
export function servicesSchema() {
  return {
    '@context': 'https://schema.org',
    '@graph': services.map((s) => ({
      '@type': 'Service',
      '@id': `${abs('/services/')}#${s.slug}`,
      name: s.title,
      description: s.body,
      serviceType: s.title,
      provider: { '@id': ORG_ID },
      areaServed: SERVICE_AREA,
      audience: { '@type': 'Audience', audienceType: 'Car owners' },
    })),
  };
}

/** Single Service node for a dedicated /services/<slug>/ landing page. */
export function serviceSchema(slug: string) {
  const service = services.find((s) => s.slug === slug);
  if (!service) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${abs(`/services/${service.slug}/`)}#service`,
    name: service.title,
    description: service.body,
    serviceType: service.title,
    url: abs(`/services/${service.slug}/`),
    provider: { '@id': ORG_ID },
    areaServed: SERVICE_AREA,
    audience: { '@type': 'Audience', audienceType: 'Car owners' },
  };
}

/** Price list for /pricing. */
export function pricingSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'OfferCatalog',
    name: `${site.name} driver charges`,
    provider: { '@id': ORG_ID },
    itemListElement: plans.map((p, i) => ({
      '@type': 'Offer',
      position: i + 1,
      name: p.name,
      description: p.blurb,
      priceCurrency: 'INR',
      price: p.price.replace(/[₹,]/g, ''),
      availability: 'https://schema.org/InStock',
      areaServed: SERVICE_AREA,
    })),
  };
}

/** FAQPage — eligible for the FAQ rich result. */
export function faqSchema(items: readonly { q: string; a: string }[] = faqs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

/** Per-city LocalBusiness variant with a single areaServed, for /cities/[city]. */
export function citySchema(slug: string) {
  const city = cities.find((c) => c.slug === slug);
  if (!city) return null;
  return {
    '@context': 'https://schema.org',
    '@type': ['LocalBusiness', 'ProfessionalService'],
    '@id': `${abs(`/cities/${city.slug}/`)}#business`,
    parentOrganization: { '@id': ORG_ID },
    name: `${site.name} — Drivers in ${city.name}`,
    description: city.intro,
    url: abs(`/cities/${city.slug}/`),
    telephone: `+91${site.phone}`,
    priceRange: site.priceRange,
    image: abs('/og.png'),
    address: {
      '@type': 'PostalAddress',
      addressLocality: city.name,
      addressRegion: site.region,
      addressCountry: site.country,
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: String(city.geo.lat),
      longitude: String(city.geo.lng),
    },
    areaServed: {
      '@type': 'City',
      name: city.name,
      geo: {
        '@type': 'GeoCoordinates',
        latitude: String(city.geo.lat),
        longitude: String(city.geo.lng),
      },
      containedInPlace: STATE_AREA,
    },
    openingHoursSpecification: [
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: [
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
    ],
  };
}

/** BreadcrumbList for every page below the root. */
export function breadcrumbSchema(trail: readonly { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'Home', path: '/' }, ...trail].map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: abs(item.path),
    })),
  };
}
