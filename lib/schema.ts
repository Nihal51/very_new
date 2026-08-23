/**
 * JSON-LD builders. Kept out of the components so the shape of the structured
 * data is reviewable in one place, and every page emits a consistent graph.
 */

import { site } from './site';
import { siteConfig } from './site-config';
import { cities, faqs, plans, services, testimonials } from './content';

const abs = (path = '/') => new URL(path, site.url).toString();

const ORG_ID = `${site.url}/#business`;

/** Opening hours, from the single 24/7 definition in site-config. */
const openingHoursSpecification = [
  {
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: [...siteConfig.hours.days],
    opens: siteConfig.hours.opens,
    closes: siteConfig.hours.closes,
  },
];

/** LocalBusiness — the anchor entity every other node points at. */
export function localBusinessSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': ORG_ID,
    name: site.name,
    legalName: site.legalName,
    description: site.description,
    url: abs('/'),
    image: abs('/og.png'),
    logo: abs('/assets/logo.png'),
    telephone: `+91${site.phone}`,
    email: site.email,
    priceRange: site.priceRange,
    currenciesAccepted: 'INR',
    paymentAccepted: 'Cash, UPI, Bank transfer',
    foundingDate: site.foundingYear,
    slogan: 'Your car. Our driver.',
    address: {
      '@type': 'PostalAddress',
      addressLocality: siteConfig.address.locality,
      addressRegion: siteConfig.address.region,
      addressCountry: siteConfig.address.country,
    },
    areaServed: cities.map((c) => ({
      '@type': 'City',
      name: c.name,
      containedInPlace: { '@type': 'AdministrativeArea', name: site.region },
    })),
    openingHoursSpecification,
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
    sameAs: [`https://wa.me/${site.whatsapp}`],
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
      areaServed: cities.map((c) => ({ '@type': 'City', name: c.name })),
      audience: { '@type': 'Audience', audienceType: 'Car owners' },
    })),
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
      areaServed: cities.map((c) => ({ '@type': 'City', name: c.name })),
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
    '@type': 'LocalBusiness',
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
      addressRegion: siteConfig.address.region,
      addressCountry: siteConfig.address.country,
    },
    areaServed: {
      '@type': 'City',
      name: city.name,
      containedInPlace: { '@type': 'AdministrativeArea', name: site.region },
    },
    openingHoursSpecification,
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
