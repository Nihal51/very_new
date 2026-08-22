import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BookingForm } from '@/components/BookingForm';
import { JsonLd } from '@/components/JsonLd';
import { ClosingCTA } from '@/components/sections/ClosingCTA';
import { PageHero } from '@/components/sections/PageHero';
import { PricingCards } from '@/components/sections/PricingCards';
import { ServicesGrid } from '@/components/sections/ServicesGrid';
import { Accordion } from '@/components/ui/Accordion';
import { Badge } from '@/components/ui/Badge';
import { ButtonAnchor, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Container, Section } from '@/components/ui/Section';
import { BuildingIcon, ClockIcon, PhoneIcon, RouteIcon } from '@/components/icons';
import { cities, faqs, getCity } from '@/lib/content';
import { breadcrumbSchema, citySchema, faqSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';
import { formatPhone, site, telHref } from '@/lib/site';

/** Only these four slugs exist. Anything else 404s rather than rendering a shell. */
export function generateStaticParams() {
  return cities.map((city) => ({ city: city.slug }));
}

export const dynamicParams = false;

type Props = { params: Promise<{ city: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city: slug } = await params;
  const city = getCity(slug);
  if (!city) return {};

  return pageMeta({
    title: `Driver on Call in ${city.name} — 30-Min Arrival`,
    description: `Hire a police-verified driver for your own car in ${city.name} — 30-minute arrival, 24/7, from ₹300. Covering ${city.areas.slice(0, 2).join(' and ')}.`,
    path: `/cities/${city.slug}/`,
    ogImageAlt: `${site.name} — verified drivers in ${city.name}`,
  });
}

/** The four questions most relevant to someone landing on a city page. */
const cityFaqs = faqs.filter((f) =>
  ['How quickly', 'available at night', 'drivers verified', 'provide the car'].some((needle) =>
    f.q.includes(needle),
  ),
);

export default async function CityPage({ params }: Props) {
  const { city: slug } = await params;
  const city = getCity(slug);
  if (!city) notFound();

  const trail = [
    { name: 'Cities', path: '/cities/' },
    { name: city.name, path: `/cities/${city.slug}/` },
  ];

  return (
    <>
      <PageHero
        eyebrow={`${city.name} · ${city.badge}`}
        title={`Drivers on call in ${city.name}`}
        lede={city.intro}
        trail={trail}
        actions={
          <>
            <ButtonAnchor href={telHref} size="lg">
              <PhoneIcon className="size-5" />
              <span className="tabular">{formatPhone(site.phone)}</span>
            </ButtonAnchor>
            <ButtonLink href="#book" variant="outline" size="lg">
              Book a driver in {city.name}
            </ButtonLink>
          </>
        }
      />

      <Section
        id="coverage"
        eyebrow="Coverage"
        title={`How we cover ${city.name}`}
        lede={city.coverage}
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <div className="flex items-center gap-3">
              <span className="bg-accent-subtle text-accent-text flex size-10 items-center justify-center rounded-xl">
                <RouteIcon className="size-5" />
              </span>
              <h3 className="font-display text-lg font-semibold">Areas we serve</h3>
            </div>
            <ul className="mt-5 flex flex-wrap gap-2">
              {city.areas.map((area) => (
                <li key={area}>
                  <Badge tone="outline">{area}</Badge>
                </li>
              ))}
            </ul>
            <p className="text-fg-subtle mt-5 text-sm">
              Not on the list? We still come — these are simply the areas we are booked in most
              often.
            </p>
          </Card>

          <Card>
            <div className="flex items-center gap-3">
              <span className="bg-accent-subtle text-accent-text flex size-10 items-center justify-center rounded-xl">
                <BuildingIcon className="size-5" />
              </span>
              <h3 className="font-display text-lg font-semibold">
                Landmarks our drivers know well
              </h3>
            </div>
            <ul className="mt-5 flex flex-col gap-3">
              {city.landmarks.map((landmark) => (
                <li key={landmark} className="text-fg-muted flex gap-3 text-[0.9375rem]">
                  <span aria-hidden="true" className="bg-accent mt-2 size-1.5 shrink-0 rounded-full" />
                  {landmark}
                </li>
              ))}
            </ul>
            <p className="text-fg-subtle mt-5 flex items-start gap-2 text-sm">
              <ClockIcon className="mt-0.5 size-4 shrink-0" />
              Booked most in {city.name}: {city.popular.toLowerCase()}.
            </p>
          </Card>
        </div>
      </Section>

      {/* Booking form on every city page — a local visitor should not need a second click. */}
      <section
        id="book"
        aria-labelledby="city-book-heading"
        className="border-border bg-bg-subtle scroll-mt-20 border-y py-16 sm:py-20"
      >
        <Container>
          <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:items-start lg:gap-14">
            <div className="reveal lg:sticky lg:top-24">
              <p className="text-eyebrow text-accent-text uppercase">Book now</p>
              <h2 id="city-book-heading" className="text-display-md mt-3">
                Get a driver in {city.name}
              </h2>
              <p className="text-lede text-fg-muted mt-4">
                Send your pickup details and we call you back within minutes. For a hospital run or
                anything urgent, call{' '}
                <a href={telHref} className="text-accent-text tabular font-semibold underline underline-offset-4">
                  {formatPhone(site.phone)}
                </a>{' '}
                instead — it is faster than any form.
              </p>
            </div>

            <BookingForm
              id="city-booking-form"
              headingLevel="h3"
              title={`Book a driver in ${city.name}`}
              lede="We only ask for what dispatch needs to reach you."
            />
          </div>
        </Container>
      </section>

      <Section
        id="services"
        eyebrow="Services"
        title={`Every service available in ${city.name}`}
        lede="The same four bookings, the same verified drivers, at the same rates as everywhere else we operate."
      >
        <ServicesGrid />
      </Section>

      <Section tone="subtle" id="pricing" eyebrow="Pricing" title={`Driver charges in ${city.name}`}>
        <PricingCards compact />
        <div className="mt-8">
          <ButtonLink href="/pricing/" variant="outline">
            Full price list
          </ButtonLink>
        </div>
      </Section>

      <Section id="faq" eyebrow="Questions" title={`Booking a driver in ${city.name}`}>
        <Accordion items={cityFaqs} name="city-faq" defaultOpenFirst />
        <div className="mt-8">
          <ButtonLink href="/faq/" variant="outline">
            All questions answered
          </ButtonLink>
        </div>
      </Section>

      <ClosingCTA
        title={`Need a driver in ${city.name} right now?`}
        lede={`Call us and a police-verified, sober driver reaches you in about 30 minutes, anywhere in ${city.name}.`}
      />

      <JsonLd data={citySchema(city.slug)} />
      <JsonLd data={faqSchema(cityFaqs)} />
      <JsonLd data={breadcrumbSchema(trail)} />
    </>
  );
}
