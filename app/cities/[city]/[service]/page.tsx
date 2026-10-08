import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { JsonLd } from '@/components/JsonLd';
import { ClosingCTA } from '@/components/sections/ClosingCTA';
import { LocalBooking, PlaceLinks, ServiceLinks } from '@/components/sections/LocalBlocks';
import { MonthlyPlans } from '@/components/sections/MonthlyPlans';
import { PageHero } from '@/components/sections/PageHero';
import { PricingCards } from '@/components/sections/PricingCards';
import { Accordion } from '@/components/ui/Accordion';
import { ButtonAnchor, ButtonLink } from '@/components/ui/Button';
import { Section } from '@/components/ui/Section';
import { CheckIcon, PhoneIcon, WhatsappIcon } from '@/components/icons';
import { cities, faqs, getCity, services } from '@/lib/content';
import {
  cityServicePairs,
  cityServicePath,
  fitDescription,
  fitTitle,
  localitiesOf,
  serviceSearchTerms,
  townsNear,
} from '@/lib/local-seo';
import { breadcrumbSchema, cityServiceSchema, faqSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';
import { formatPhone, site, telHref, waHref } from '@/lib/site';

export function generateStaticParams() {
  return cityServicePairs.map(({ city, service }) => ({ city: city.slug, service: service.slug }));
}

export const dynamicParams = false;

type Props = { params: Promise<{ city: string; service: string }> };

async function resolve(params: Props['params']) {
  const { city: c, service: s } = await params;
  const city = getCity(c);
  const service = services.find((x) => x.slug === s);
  return city && service ? { city, service } : null;
}

function describe(cityName: string, service: (typeof services)[number]) {
  return fitDescription(
    `${service.title} in ${cityName}: ${service.short} Police-verified, sober drivers, 24/7 — call or book online.`,
    `${service.title} in ${cityName}: ${service.short}`,
    `Book a ${service.title.toLowerCase()} in ${cityName} — police-verified, sober drivers for your own car, 24/7. Call or book online.`,
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await resolve(params);
  if (!r) return {};
  const { city, service } = r;
  return pageMeta({
    title: fitTitle(`${service.title} in ${city.name} — Book 24/7`, `${service.title} in ${city.name}`),
    description: describe(city.name, service),
    path: cityServicePath(city, service),
    ogImageAlt: `${site.name} — ${service.title.toLowerCase()} in ${city.name}`,
  });
}

/** General questions that fit each service, matched on the question text. */
const FAQ_NEEDLES: Record<string, string[]> = {
  'personal-driver': ['provide the car', 'extend my booking', 'payment methods'],
  'medical-transport': ['hospital emergency', 'drivers verified', 'provide the car'],
  'night-safety-driver': ['available at night', 'drivers verified', 'payment methods'],
  'airport-outstation': ['Local and Outstation', 'extend my booking', 'provide the car'],
  'monthly-driver': ['drivers verified', 'provide the car', 'payment methods'],
  'wedding-event-driver': ['drivers verified', 'available at night', 'payment methods'],
  'one-way-car-drop': ['drivers verified', 'provide the car', 'payment methods'],
};

export default async function CityServicePage({ params }: Props) {
  const r = await resolve(params);
  if (!r) notFound();
  const { city, service } = r;
  const path = cityServicePath(city, service);
  const name = `${service.title} in ${city.name}`;
  const terms = serviceSearchTerms[service.slug] ?? [];
  const { quote, tiers } = service;

  const localFaqs = [
    {
      q: `How do I book a ${service.title.toLowerCase()} in ${city.name}?`,
      a: `Call ${formatPhone(site.phone)}, message us on WhatsApp or use the form on this page. Tell us your address in ${city.name} and what you need — we call back within minutes and confirm the driver${quote ? ' and a fixed price' : ''}.`,
    },
    ...(service.faqs ?? []),
    ...faqs.filter((f) => (FAQ_NEEDLES[service.slug] ?? []).some((n) => f.q.includes(n))),
  ];

  const trail = [
    { name: 'Cities', path: '/cities/' },
    { name: city.name, path: `/cities/${city.slug}/` },
    { name: service.title, path },
  ];

  const areas = [...localitiesOf(city.slug), ...townsNear(city.slug)];

  return (
    <>
      <PageHero
        eyebrow={`${city.name} · Verified drivers, 24/7`}
        title={name}
        lede={`${service.body} In ${city.name} we are booked most for ${city.popular.toLowerCase()}.`}
        trail={trail}
        actions={
          <>
            <ButtonAnchor href={telHref} size="lg">
              <PhoneIcon className="size-5" />
              <span className="tabular">{formatPhone(site.phone)}</span>
            </ButtonAnchor>
            <ButtonLink href="#book" variant="outline" size="lg">
              {quote ? 'Ask for a quote' : `Book in ${city.name}`}
            </ButtonLink>
          </>
        }
      >
        {terms.length > 0 && (
          <p className="text-fg-subtle mt-5 text-sm">
            Also called: {terms.map((t) => `${t} in ${city.name}`).join(' · ')}
          </p>
        )}
      </PageHero>

      <Section id="included" eyebrow="Included" title={`What you get in ${city.name}`} lede={city.coverage}>
        <ul className="grid gap-3 sm:grid-cols-2">
          {service.includes.map((item) => (
            <li key={item} className="flex gap-3 text-[0.9375rem]">
              <CheckIcon className="text-success mt-0.5 size-5 shrink-0" />
              <span className="text-fg-muted">{item}</span>
            </li>
          ))}
        </ul>
      </Section>

      {tiers ? (
        <Section tone="subtle" id="plans" eyebrow="Plans" title={`Monthly driver plans in ${city.name}`}>
          <MonthlyPlans />
        </Section>
      ) : quote ? (
        <Section tone="subtle" id="pricing" eyebrow="Pricing" title={quote.title} lede={quote.body}>
          <h3 className="font-display text-lg font-semibold">What the price depends on</h3>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {quote.factors.map((factor) => (
              <li key={factor} className="flex gap-3 text-[0.9375rem]">
                <CheckIcon className="text-success mt-0.5 size-5 shrink-0" />
                <span className="text-fg-muted">{factor}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8">
            <ButtonAnchor href={waHref(quote.whatsapp)} target="_blank" rel="noopener noreferrer" variant="outline">
              <WhatsappIcon className="size-5" />
              Get a quote on WhatsApp
            </ButtonAnchor>
          </div>
        </Section>
      ) : (
        <Section
          tone="subtle"
          id="pricing"
          eyebrow="Pricing"
          title={`${service.title} charges in ${city.name}`}
          lede="The driver's charge only, fixed when you book. You provide the vehicle and fuel."
        >
          <PricingCards compact />
        </Section>
      )}

      <LocalBooking where={city.name} />

      <Section id="areas" eyebrow="Areas" title={`${service.title} anywhere in ${city.name}`}>
        <PlaceLinks places={areas} />
        <p className="text-fg-subtle mt-6 text-sm">
          The same service in{' '}
          {cities
            .filter((c) => c.slug !== city.slug)
            .map((c, i, all) => (
              <span key={c.slug}>
                <Link href={cityServicePath(c, service)} className="text-accent-text font-semibold underline underline-offset-4">
                  {c.name}
                </Link>
                {i < all.length - 2 ? ', ' : i === all.length - 2 ? ' and ' : '.'}
              </span>
            ))}
        </p>
      </Section>

      <Section tone="subtle" id="faq" eyebrow="Questions" title={`${service.title} in ${city.name}: good to know`}>
        <Accordion items={localFaqs} name="city-service-faq" defaultOpenFirst />
      </Section>

      <Section id="more" eyebrow="More in this city" title={`Other driver services in ${city.name}`}>
        <ServiceLinks city={city} where={city.name} skip={service.slug} />
      </Section>

      <ClosingCTA
        title={`Need a ${service.title.toLowerCase()} in ${city.name}?`}
        lede={`Call or WhatsApp us — a police-verified, sober driver for your own car, anywhere in ${city.name}.`}
      />

      <JsonLd data={cityServiceSchema(city.slug, service.slug, path, describe(city.name, service))} />
      <JsonLd data={faqSchema(localFaqs)} />
      <JsonLd data={breadcrumbSchema(trail)} />
    </>
  );
}
