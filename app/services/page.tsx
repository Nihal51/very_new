import type { Metadata } from 'next';

import { JsonLd } from '@/components/JsonLd';
import { ClosingCTA } from '@/components/sections/ClosingCTA';
import { PageHero } from '@/components/sections/PageHero';
import { Pillars } from '@/components/sections/Pillars';
import { PricingCards } from '@/components/sections/PricingCards';
import { ServicesGrid } from '@/components/sections/ServicesGrid';
import { ButtonAnchor, ButtonLink } from '@/components/ui/Button';
import { Section } from '@/components/ui/Section';
import { PhoneIcon } from '@/components/icons';
import { breadcrumbSchema, servicesSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';
import { formatPhone, site, telHref } from '@/lib/site';

const trail = [{ name: 'Services', path: '/services/' }];

export const metadata: Metadata = pageMeta({
  title: 'Personal, Medical, Night & Airport Drivers',
  description:
    'Hire a driver by the hour or full day — personal, hospital, night-safety (8 PM–6 AM), airport and outstation trips. Verified, sober, trained.',
  path: '/services/',
});

export default function ServicesPage() {
  return (
    <>
      <PageHero
        eyebrow="Services"
        title="Driver services for every journey"
        lede="One standard of driver — police verified, breath tested and trained — across four kinds of booking. You keep your own car; we supply someone you can trust to drive it."
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

      <Section id="all-services" title="What each service includes" headingLevel={2}>
        <ServicesGrid detailed />
      </Section>

      <Section
        tone="subtle"
        id="standard"
        eyebrow="The same standard, every time"
        title="Whichever service you book"
        lede="The verification behind every booking does not change with the price."
      >
        <Pillars />
      </Section>

      <Section
        id="rates"
        eyebrow="Pricing"
        title="What these services cost"
        lede="Rates are fixed when you book. The driver only — you provide the vehicle and fuel."
      >
        <PricingCards />
        <div className="mt-8">
          <ButtonLink href="/pricing/" variant="outline">
            Full price list and extras
          </ButtonLink>
        </div>
      </Section>

      <ClosingCTA />

      <JsonLd data={servicesSchema()} />
      <JsonLd data={breadcrumbSchema(trail)} />
    </>
  );
}
