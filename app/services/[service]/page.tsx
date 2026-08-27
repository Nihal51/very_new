import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { JsonLd } from '@/components/JsonLd';
import { ClosingCTA } from '@/components/sections/ClosingCTA';
import { PageHero } from '@/components/sections/PageHero';
import { PricingCards } from '@/components/sections/PricingCards';
import { Accordion } from '@/components/ui/Accordion';
import { ButtonAnchor, ButtonLink } from '@/components/ui/Button';
import { Section } from '@/components/ui/Section';
import { CheckIcon, PhoneIcon } from '@/components/icons';
import { cities, faqs, services } from '@/lib/content';
import { breadcrumbSchema, faqSchema, serviceSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';
import { formatPhone, site, telHref } from '@/lib/site';

/** Only the four real service slugs render; everything else 404s. */
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
  const serviceFaqs = faqs.filter((f) => needles.some((n) => f.q.includes(n)));

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
            <ButtonLink href="/book/" variant="outline" size="lg">
              Book this service
            </ButtonLink>
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

      <Section
        id="cities"
        eyebrow="Where"
        title={`Available across ${site.region}`}
        lede="The same service and the same verified drivers in all four cities we operate in."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cities.map((c) => (
            <ButtonLink key={c.slug} href={`/cities/${c.slug}/`} variant="outline" fullWidth>
              Drivers in {c.name}
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

      <ClosingCTA
        title={`Book ${service.title.toLowerCase()} in about 30 minutes`}
        lede="Call now or send your pickup details — a police-verified, sober driver reaches you fast, any time of day or night."
      />

      <JsonLd data={serviceSchema(service.slug)} />
      <JsonLd data={breadcrumbSchema(trail)} />
      {serviceFaqs.length > 0 && <JsonLd data={faqSchema(serviceFaqs)} />}
    </>
  );
}
