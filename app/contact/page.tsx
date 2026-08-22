import type { Metadata } from 'next';
import Link from 'next/link';

import { JsonLd } from '@/components/JsonLd';
import { PageHero } from '@/components/sections/PageHero';
import { Badge } from '@/components/ui/Badge';
import { ButtonAnchor, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Container, Section } from '@/components/ui/Section';
import { ClockIcon, MailIcon, MapPinIcon, PhoneIcon, WhatsappIcon } from '@/components/icons';
import { cities } from '@/lib/content';
import { breadcrumbSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';
import { formatPhone, mailHref, site, telHref, telHrefAlt, waHref } from '@/lib/site';

const trail = [{ name: 'Contact', path: '/contact/' }];

export const metadata: Metadata = pageMeta({
  title: 'Contact DriveBuddy',
  description: `Call ${formatPhone(site.phone)} or message us on WhatsApp any hour of the day. Drivers across Raipur, Bhilai, Durg and Bilaspur.`,
  path: '/contact/',
});

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Talk to us"
        lede="Two phone lines, WhatsApp and email — all staffed around the clock. For anything urgent, the phone is always fastest."
        trail={trail}
      />

      <div className="py-14 sm:py-16 lg:py-20">
        <Container>
          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <Badge tone="accent">
                <span className="bg-success size-1.5 rounded-full" aria-hidden="true" />
                Answering now · 24/7
              </Badge>
              <h2 className="text-display-sm mt-4">Call for a driver</h2>
              <p className="text-fg-muted mt-2 text-[0.9375rem]">
                Our dispatch lines are open every hour of every day, including festivals. If the
                first number is busy, the second reaches the same team.
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <ButtonAnchor href={telHref} size="lg" fullWidth>
                  <PhoneIcon className="size-5" />
                  <span className="tabular">{formatPhone(site.phone)}</span>
                </ButtonAnchor>
                <ButtonAnchor href={telHrefAlt} variant="outline" size="lg" fullWidth>
                  <PhoneIcon className="size-5" />
                  <span className="tabular">{formatPhone(site.phoneAlt)}</span>
                </ButtonAnchor>
              </div>

              <div className="border-border mt-7 grid gap-6 border-t pt-7 sm:grid-cols-2">
                <div>
                  <h3 className="flex items-center gap-2 font-semibold">
                    <WhatsappIcon className="text-accent-text size-4" />
                    WhatsApp
                  </h3>
                  <p className="text-fg-muted mt-1.5 text-sm">
                    Send your pickup details and we reply with a driver and a time.
                  </p>
                  <a
                    href={waHref(`Hi ${site.name}, I need a driver.`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-text tabular mt-2 inline-block rounded-lg text-sm font-semibold underline underline-offset-4"
                  >
                    {formatPhone(site.phone)}
                  </a>
                </div>

                <div>
                  <h3 className="flex items-center gap-2 font-semibold">
                    <MailIcon className="text-accent-text size-4" />
                    Email
                  </h3>
                  <p className="text-fg-muted mt-1.5 text-sm">
                    Best for corporate accounts, invoices and long outstation quotes.
                  </p>
                  <a
                    href={mailHref}
                    className="text-accent-text mt-2 inline-block rounded-lg text-sm font-semibold break-all underline underline-offset-4"
                  >
                    {site.email}
                  </a>
                </div>
              </div>
            </Card>

            <div className="flex flex-col gap-5">
              <Card tone="subtle">
                <h2 className="flex items-center gap-2 font-semibold">
                  <ClockIcon className="text-accent-text size-5" />
                  Hours
                </h2>
                <p className="tabular text-display-sm font-display mt-3">24 / 7</p>
                <p className="text-fg-muted mt-2 text-sm">
                  Every day of the year. Night driver bookings run 8 PM to 6 AM at a flat ₹500.
                </p>
              </Card>

              <Card tone="subtle">
                <h2 className="flex items-center gap-2 font-semibold">
                  <MapPinIcon className="text-accent-text size-5" />
                  Where we operate
                </h2>
                <ul className="mt-4 flex flex-col gap-2">
                  {cities.map((city) => (
                    <li key={city.slug}>
                      <Link
                        href={`/cities/${city.slug}/`}
                        className="text-fg-muted hover:text-accent-text rounded-lg text-sm font-medium"
                      >
                        {city.name}
                        {city.isHq && (
                          <span className="text-fg-subtle font-normal"> — headquarters</span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="text-fg-subtle mt-4 text-sm">
                  Registered in Raipur, {site.region}, India.
                </p>
              </Card>
            </div>
          </div>
        </Container>
      </div>

      <Section
        tone="subtle"
        id="prefer-form"
        align="center"
        title="Would rather not call?"
        lede="Send the booking form and we will call you — usually within a few minutes."
      >
        <div className="flex flex-wrap justify-center gap-3">
          <ButtonLink href="/book/" size="lg">
            Book a driver online
          </ButtonLink>
          <ButtonLink href="/drivers/" variant="outline" size="lg">
            Apply to drive with us
          </ButtonLink>
        </div>
      </Section>

      <JsonLd data={breadcrumbSchema(trail)} />
    </>
  );
}
