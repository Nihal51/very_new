import type { Metadata } from 'next';

import { DriverForm } from '@/components/DriverForm';
import { JsonLd } from '@/components/JsonLd';
import { PageHero } from '@/components/sections/PageHero';
import { ButtonAnchor } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Container, Section } from '@/components/ui/Section';
import { StatBlock } from '@/components/ui/StatBlock';
import { CheckIcon, Icon, PhoneIcon } from '@/components/icons';
import { cityNames, driverPerks, driverRequirements } from '@/lib/content';
import { breadcrumbSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';
import { formatPhone, site, telHref } from '@/lib/site';

const trail = [{ name: 'Join as Driver', path: '/drivers/' }];

export const metadata: Metadata = pageMeta({
  title: 'Driver Jobs in Chhattisgarh — Join DriveBuddy',
  description:
    'Driver jobs in Raipur, Bhilai, Durg and Bilaspur. Weekly payouts, shifts you choose, work near home, free training. 5+ years experience needed.',
  path: '/drivers/',
});

const driverStats = [
  { value: 'Weekly', label: 'Payout cycle' },
  { value: 'You pick', label: 'Your shifts' },
  { value: 'Free', label: 'Training & certification' },
  { value: '4 cities', label: 'Work near home' },
];

export default function DriversPage() {
  return (
    <>
      <PageHero
        eyebrow="Driver jobs"
        title="Drive with DriveBuddy"
        lede={`Steady bookings, weekly payouts and shifts that fit around your life — in ${cityNames.slice(0, -1).join(', ')} and ${cityNames.at(-1)}. You drive the customer's car; we bring you the work.`}
        trail={trail}
        actions={
          <>
            <ButtonAnchor href="#driver-form" size="lg">
              Apply now
            </ButtonAnchor>
            <ButtonAnchor href={telHref} variant="outline" size="lg">
              <PhoneIcon className="size-5" />
              <span className="tabular">{formatPhone(site.phone)}</span>
            </ButtonAnchor>
          </>
        }
      />

      <Section id="perks" title="What you get" headingLevel={2}>
        <StatBlock stats={driverStats} className="mb-14" />

        <div className="grid gap-5 sm:grid-cols-2">
          {driverPerks.map((perk) => (
            <Card key={perk.title} className="reveal">
              <span className="bg-accent-subtle text-accent-text flex size-11 items-center justify-center rounded-xl">
                <Icon name={perk.icon} className="size-5.5" />
              </span>
              <h3 className="font-display mt-5 text-lg font-semibold">{perk.title}</h3>
              <p className="text-fg-muted mt-2 text-[0.9375rem]">{perk.body}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section
        tone="subtle"
        id="requirements"
        eyebrow="Before you apply"
        title="What we need from you"
        lede="Our standards are strict on purpose — they are the reason customers trust the drivers on this platform."
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <h3 className="font-display text-lg font-semibold">Requirements</h3>
            <ul className="mt-5 flex flex-col gap-3">
              {driverRequirements.map((item) => (
                <li key={item} className="flex gap-3 text-[0.9375rem]">
                  <CheckIcon className="text-success mt-0.5 size-5 shrink-0" />
                  <span className="text-fg-muted">{item}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card tone="ink">
            <h3 className="font-display text-lg font-semibold">The one rule with no exceptions</h3>
            <p className="mt-3 text-[0.9375rem] text-white/70">
              Every driver takes a breathalyser test before every shift. A single failed test is a
              permanent ban — no warning, no second chance, no appeal.
            </p>
            <p className="mt-4 text-[0.9375rem] text-white/70">
              We tell customers this is how it works, so it has to be true. If that standard suits
              you, you will fit here well.
            </p>
          </Card>
        </div>
      </Section>

      <div className="py-14 sm:py-16 lg:py-20">
        <Container>
          <div className="mx-auto max-w-2xl">
            <DriverForm id="driver-form" />
          </div>
        </Container>
      </div>

      <section aria-labelledby="drivers-cta" className="bg-ink text-fg-inverse">
        <Container className="py-16 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 id="drivers-cta" className="text-display-md">
              Prefer to talk it through first?
            </h2>
            <p className="text-lede mt-4 text-white/70">
              Call us and ask anything about shifts, payouts or the verification process. No
              application needed to have the conversation.
            </p>
            <div className="mt-8 flex justify-center">
              <ButtonAnchor href={telHref} size="lg">
                <PhoneIcon className="size-5" />
                <span className="tabular">{formatPhone(site.phone)}</span>
              </ButtonAnchor>
            </div>
          </div>
        </Container>
      </section>

      <JsonLd data={breadcrumbSchema(trail)} />
    </>
  );
}
