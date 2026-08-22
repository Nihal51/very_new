import type { Metadata } from 'next';

import { BookingForm } from '@/components/BookingForm';
import { JsonLd } from '@/components/JsonLd';
import { PageHero } from '@/components/sections/PageHero';
import { Badge } from '@/components/ui/Badge';
import { ButtonAnchor } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Container } from '@/components/ui/Section';
import {
  ClockIcon,
  MailIcon,
  NoAlcoholIcon,
  PhoneIcon,
  ShieldIcon,
  WhatsappIcon,
} from '@/components/icons';
import { breadcrumbSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';
import { formatPhone, mailHref, site, telHref, telHrefAlt, waHref } from '@/lib/site';

const trail = [{ name: 'Book a driver', path: '/book/' }];

export const metadata: Metadata = pageMeta({
  title: 'Book a Verified Driver — 30-Minute Arrival',
  description:
    'Book a police-verified driver for your own car in Raipur, Bhilai, Durg or Bilaspur. We call you back within minutes. 24 hours, from ₹300.',
  path: '/book/',
});

const steps = [
  {
    title: 'You send the form',
    body: 'Five details — name, mobile, city, service and pickup address. Nothing else is needed.',
  },
  {
    title: 'We call you back',
    body: 'Usually within a few minutes, to confirm the driver, the arrival time and the rate.',
  },
  {
    title: 'Your driver arrives',
    body: 'Within about 30 minutes of confirmation. You get the driver’s name and number before they set off.',
  },
  {
    title: 'You pay after the trip',
    body: 'Cash, UPI or bank transfer at the agreed rate. Nothing up front, ever.',
  },
];

export default function BookPage() {
  return (
    <>
      <PageHero
        eyebrow="Booking"
        title="Book a driver"
        lede="Two minutes now, a verified driver at your door in about thirty. If it is urgent, call us instead — we answer 24 hours a day."
        trail={trail}
      />

      <div className="py-14 sm:py-16 lg:py-20">
        <Container>
          <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:items-start lg:gap-14">
            <BookingForm
              id="booking-form"
              title="Your booking details"
              lede="Required fields are marked with an asterisk. We only ask for what dispatch actually needs."
            />

            <div className="flex flex-col gap-6 lg:sticky lg:top-24">
              {/* Urgent path first — a form is the wrong tool for an emergency. */}
              <Card tone="subtle">
                <Badge tone="accent">Need a driver right now?</Badge>
                <h2 className="font-display mt-4 text-lg font-semibold">
                  Call us — it is faster
                </h2>
                <p className="text-fg-muted mt-2 text-sm">
                  For a hospital run or anything urgent, the phone beats the form. Both lines are
                  staffed around the clock.
                </p>
                <div className="mt-5 flex flex-col gap-2">
                  <ButtonAnchor href={telHref} fullWidth>
                    <PhoneIcon className="size-4" />
                    <span className="tabular">{formatPhone(site.phone)}</span>
                  </ButtonAnchor>
                  <ButtonAnchor href={telHrefAlt} variant="outline" fullWidth>
                    <PhoneIcon className="size-4" />
                    <span className="tabular">{formatPhone(site.phoneAlt)}</span>
                  </ButtonAnchor>
                  <ButtonAnchor
                    href={waHref(`Hi ${site.name}, I need a driver.`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="outline"
                    fullWidth
                  >
                    <WhatsappIcon className="size-4" />
                    WhatsApp
                  </ButtonAnchor>
                  <ButtonAnchor href={mailHref} variant="ghost" fullWidth>
                    <MailIcon className="size-4" />
                    Email us
                  </ButtonAnchor>
                </div>
              </Card>

              <Card>
                <h2 className="font-display text-lg font-semibold">What happens next</h2>
                <ol className="mt-5 flex flex-col gap-5">
                  {steps.map((step, i) => (
                    <li key={step.title} className="flex gap-4">
                      <span
                        aria-hidden="true"
                        className="bg-accent-subtle text-accent-text tabular font-display flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                      >
                        {i + 1}
                      </span>
                      <div>
                        <p className="font-semibold">{step.title}</p>
                        <p className="text-fg-muted mt-1 text-sm">{step.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </Card>

              <ul className="text-fg-muted grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-1">
                <li className="flex items-center gap-2.5">
                  <ShieldIcon className="text-accent-text size-5 shrink-0" />
                  Police-verified drivers only
                </li>
                <li className="flex items-center gap-2.5">
                  <NoAlcoholIcon className="text-accent-text size-5 shrink-0" />
                  Breathalyser before every shift
                </li>
                <li className="flex items-center gap-2.5">
                  <ClockIcon className="text-accent-text size-5 shrink-0" />
                  30-minute arrival, 24 hours a day
                </li>
              </ul>
            </div>
          </div>
        </Container>
      </div>

      <JsonLd data={breadcrumbSchema(trail)} />
    </>
  );
}
