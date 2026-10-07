import type { Metadata } from 'next';
import Link from 'next/link';

import { JsonLd } from '@/components/JsonLd';
import { ClosingCTA } from '@/components/sections/ClosingCTA';
import { PageHero } from '@/components/sections/PageHero';
import { Pillars } from '@/components/sections/Pillars';
import { ButtonAnchor, ButtonLink } from '@/components/ui/Button';
import { Section } from '@/components/ui/Section';
import { ArrowRightIcon, PhoneIcon } from '@/components/icons';
import { cities, services } from '@/lib/content';
import { aboutSchema, breadcrumbSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';
import { formatPhone, mailHref, site, telHref } from '@/lib/site';

const trail = [{ name: 'About', path: '/about/' }];

export const metadata: Metadata = pageMeta({
  title: `About ${site.name} — Driver Service from Raipur`,
  description: `${site.name} is a driver-on-demand service founded in ${site.foundingCity} in ${site.foundingYear} by ${site.founder}. Verified drivers for your own car across ${site.region}.`,
  path: '/about/',
});

const cityList = cities.map((c) => c.name);
const cityText = `${cityList.slice(0, -1).join(', ')} and ${cityList.at(-1)}`;

/**
 * The plain facts, in one place. Search engines and AI assistants answer "who runs
 * DriveBuddy?" or "is DriveBuddy in Durg?" from exactly this kind of list, so every
 * line is a fact the business stands behind — nothing here is marketing.
 */
const facts: { term: string; detail: React.ReactNode }[] = [
  { term: 'Name', detail: `${site.name} (also written “Drive Buddy”)` },
  { term: 'What we do', detail: 'Supply verified drivers to drive the customer’s own car' },
  { term: 'Founded', detail: `${site.foundingYear}, in ${site.foundingCity}, ${site.region}` },
  { term: 'Founder', detail: site.founder },
  { term: 'Cities served', detail: cityText },
  { term: 'Hours', detail: '24 hours a day, 7 days a week' },
  {
    term: 'Phone',
    detail: (
      <a href={telHref} className="text-accent-text tabular rounded-lg font-semibold">
        {formatPhone(site.phone)}
      </a>
    ),
  },
  {
    term: 'Email',
    detail: (
      <a href={mailHref} className="text-accent-text rounded-lg font-semibold break-all">
        {site.email}
      </a>
    ),
  },
];

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About us"
        title={`About ${site.name}`}
        lede={`${site.name} is a driver-on-demand service from ${site.foundingCity}, ${site.region}. We send verified, professional drivers to drive your own car — by the hour, the day or the month — across ${cityText}.`}
        trail={trail}
        actions={
          <>
            <ButtonAnchor href={telHref} size="lg">
              <PhoneIcon className="size-5" />
              <span className="tabular">{formatPhone(site.phone)}</span>
            </ButtonAnchor>
            <ButtonLink href="/book/" variant="outline" size="lg">
              Book a driver
            </ButtonLink>
          </>
        }
      />

      <Section id="story" eyebrow="Our story" title="A driver for the car you already have">
        <div className="text-fg-muted max-w-3xl space-y-4 text-[1.0625rem] leading-relaxed">
          <p>
            {site.name} was founded in {site.foundingCity} in {site.foundingYear} by{' '}
            <strong className="text-fg font-semibold">{site.founder}</strong>. Plenty of families
            in {site.region} own a car but do not always have someone to drive it — after a late
            night, for a parent&apos;s hospital visit, on a long highway trip or on a wedding day.
            A taxi means leaving your own car behind. We supply the missing piece instead: a
            trustworthy driver for the car you already have.
          </p>
          <p>
            Every booking gets the same standard of driver, whether it is one hour or a whole
            month. You keep your car, your insurance and your comfort; we take the wheel. And
            because we are a local team, the phone is answered by people who know the roads in{' '}
            {cityText}.
          </p>
        </div>
      </Section>

      <Section
        tone="subtle"
        id="drivers"
        eyebrow="Who drives your car"
        title="Four checks before anyone joins"
        lede="The standard does not change with the price of the booking."
      >
        <Pillars />
      </Section>

      <Section id="services" eyebrow="What we do" title="Our services">
        <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => (
            <li key={s.slug}>
              <Link
                href={`/services/${s.slug}/`}
                className="group flex min-h-11 items-start gap-2 rounded-lg py-1"
              >
                <ArrowRightIcon className="text-accent-text mt-1 size-4 shrink-0" />
                <span>
                  <span className="font-semibold group-hover:underline">{s.title}</span>
                  <span className="text-fg-muted block text-sm">{s.short}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section tone="subtle" id="facts" eyebrow="At a glance" title={`${site.name} in brief`}>
        <dl className="border-border bg-bg divide-border max-w-3xl divide-y rounded-2xl border">
          {facts.map((f) => (
            <div key={f.term} className="grid gap-1 px-5 py-4 sm:grid-cols-[11rem_1fr] sm:gap-6">
              <dt className="text-fg-subtle text-sm font-semibold">{f.term}</dt>
              <dd className="text-[0.9375rem]">{f.detail}</dd>
            </div>
          ))}
        </dl>
        <p className="text-fg-muted mt-6 text-sm">
          Driver service in your city:{' '}
          {cities.map((c, i) => (
            <span key={c.slug}>
              <Link href={`/cities/${c.slug}/`} className="text-accent-text rounded-lg font-semibold">
                {c.name}
              </Link>
              {i < cities.length - 1 ? ' · ' : ''}
            </span>
          ))}
        </p>
      </Section>

      <ClosingCTA />

      <JsonLd data={aboutSchema()} />
      <JsonLd data={breadcrumbSchema(trail)} />
    </>
  );
}
