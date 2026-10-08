import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { JsonLd } from '@/components/JsonLd';
import { ClosingCTA } from '@/components/sections/ClosingCTA';
import { PageHero } from '@/components/sections/PageHero';
import { MonthlyPlans } from '@/components/sections/MonthlyPlans';
import { PricingCards } from '@/components/sections/PricingCards';
import { Accordion } from '@/components/ui/Accordion';
import { ButtonAnchor, ButtonLink } from '@/components/ui/Button';
import { Section } from '@/components/ui/Section';
import { CheckIcon, PhoneIcon, WhatsappIcon } from '@/components/icons';
import { cities, faqs, services } from '@/lib/content';
import { cityServicePath } from '@/lib/local-seo';
import { breadcrumbSchema, faqSchema, serviceSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';
import { formatPhone, site, telHref, waHref } from '@/lib/site';

/** Only real service slugs render; everything else 404s. */
export function generateStaticParams() {
  return services.map((service) => ({ service: service.slug }));
}

export const dynamicParams = false;

type Props = { params: Promise<{ service: string }> };

const getService = (slug: string) => services.find((s) => s.slug === slug);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { service: slug } = await params;
  const service = getService(slug);
  if (!service) return {};

  return pageMeta({
    title: service.metaTitle,
    description: service.metaDescription,
    path: `/services/${service.slug}/`,
    ogImageAlt: `${site.name} — ${service.title.toLowerCase()} in ${site.region}`,
  });
}

/** The FAQ subset most relevant to each service, matched by substring on the question. */
const FAQ_NEEDLES: Record<string, string[]> = {
  'personal-driver': ['provide the car', 'extend my booking', 'How quickly', 'payment methods'],
  'medical-transport': ['hospital emergency', 'How quickly', 'drivers verified', 'provide the car'],
  'night-safety-driver': ['available at night', 'drivers verified', 'How quickly', 'payment methods'],
  'airport-outstation': ['Local and Outstation', 'How quickly', 'extend my booking', 'provide the car'],
  'monthly-driver': ['drivers verified', 'provide the car', 'payment methods'],
  'wedding-event-driver': ['drivers verified', 'available at night', 'payment methods'],
  'one-way-car-drop': ['drivers verified', 'provide the car', 'payment methods'],
};

export default async function ServicePage({ params }: Props) {
  const { service: slug } = await params;
  const service = getService(slug);
  if (!service) notFound();

  const trail = [
    { name: 'Services', path: '/services/' },
    { name: service.title, path: `/services/${service.slug}/` },
  ];

  const needles = FAQ_NEEDLES[service.slug] ?? [];
  /* The service's own questions first — they are the ones a searcher on this page
     is actually asking — then the general ones that apply to it. */
  const serviceFaqs = [
    ...(service.faqs ?? []),
    ...faqs.filter((f) => needles.some((n) => f.q.includes(n))),
  ];
  const quote = service.quote;
  const tiers = service.tiers;

  return (
    <>
      <PageHero
        eyebrow="Service"
        title={service.heading}
        lede={service.body}
        trail={trail}
        actions={
          <>
            <ButtonAnchor href={telHref} size="lg">
              <PhoneIcon className="size-5" />
              <span className="tabular">{formatPhone(site.phone)}</span>
            </ButtonAnchor>
            {tiers ? (
              <ButtonLink href="#plans" variant="outline" size="lg">
                Compare plans
              </ButtonLink>
            ) : (
              <ButtonLink href="/book/" variant="outline" size="lg">
                {quote ? 'Ask for a quote' : 'Book this service'}
              </ButtonLink>
            )}
          </>
        }
      />

      <Section id="included" eyebrow="Included" title="What's included">
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
        <Section
          tone="subtle"
          id="plans"
          eyebrow="Plans"
          title="Choose your monthly plan"
          lede="Both plans give you the same verified driver. Premium adds cover for the days your driver is away: a free stand-in on leave days, and a new driver within a day if yours ever leaves."
        >
          <MonthlyPlans />
        </Section>
      ) : quote ? (
        /* Quote-priced services are not sold at the hourly rates, so showing the
           hourly cards here would quote the wrong product. */
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
          <p className="text-fg-muted mt-6 max-w-2xl text-[0.9375rem]">
            The driver&apos;s charge only — you provide the vehicle and fuel, as with every
            DriveBuddy booking. No surge and no hidden extras once the price is agreed.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonAnchor href={telHref}>
              <PhoneIcon className="size-5" />
              Call for a quote
            </ButtonAnchor>
            <ButtonAnchor
              href={waHref(quote.whatsapp)}
              target="_blank"
              rel="noopener noreferrer"
              variant="outline"
            >
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
          title="What it costs"
          lede="Fixed when you book — the driver's charge only, no surge and no hidden extras. You provide the vehicle and fuel."
        >
          <PricingCards compact />
          <div className="mt-8">
            <ButtonLink href="/pricing/" variant="outline">
              Full price list and extras
            </ButtonLink>
          </div>
        </Section>
      )}

      <Section
        id="cities"
        eyebrow="Where"
        title={`Available across ${site.region}`}
        lede="The same service and the same verified drivers in all four cities we operate in."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cities.map((c) => (
            <ButtonLink key={c.slug} href={cityServicePath(c, service)} variant="outline" fullWidth>
              {service.title} in {c.name}
            </ButtonLink>
          ))}
        </div>
      </Section>

      {serviceFaqs.length > 0 && (
        <Section tone="subtle" id="faq" eyebrow="Questions" title="Good to know">
          <Accordion items={serviceFaqs} name="service-faq" defaultOpenFirst />
          <div className="mt-8">
            <ButtonLink href="/faq/" variant="outline">
              All questions answered
            </ButtonLink>
          </div>
        </Section>
      )}

      {tiers ? (
        <ClosingCTA
          title="Start your monthly driver plan"
          lede="Call or WhatsApp with your city, daily timing and start date — we match a police-verified driver and confirm your plan."
        />
      ) : quote ? (
        <ClosingCTA
          title={`Get a fixed price for a ${service.title.toLowerCase()}`}
          lede="Call now or send your details — we come back with one fixed figure and a police-verified, sober driver."
        />
      ) : (
        <ClosingCTA
          title={`Book ${service.title.toLowerCase()} in about 30 minutes`}
          lede="Call now or send your pickup details — a police-verified, sober driver reaches you fast, any time of day or night."
        />
      )}

      <JsonLd data={serviceSchema(service.slug)} />
      <JsonLd data={breadcrumbSchema(trail)} />
      {serviceFaqs.length > 0 && <JsonLd data={faqSchema(serviceFaqs)} />}
    </>
  );
}
