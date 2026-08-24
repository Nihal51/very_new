import type { Metadata } from 'next';

import { JsonLd } from '@/components/JsonLd';
import { ClosingCTA } from '@/components/sections/ClosingCTA';
import { PageHero } from '@/components/sections/PageHero';
import { PricingCards } from '@/components/sections/PricingCards';
import { Accordion } from '@/components/ui/Accordion';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Section } from '@/components/ui/Section';
import { CheckIcon, CloseIcon } from '@/components/icons';
import { faqs } from '@/lib/content';
import { breadcrumbSchema, faqSchema, pricingSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';

const trail = [{ name: 'Pricing', path: '/pricing/' }];

export const metadata: Metadata = pageMeta({
  title: 'Driver Charges & Hourly Rates in Chhattisgarh',
  description:
    'Driver charges from ₹300 an hour, ₹600 for 3 hours, ₹1000–1200 a full day, ₹1200–1500 outstation, from ₹500 at night. No surge, no hidden fees.',
  path: '/pricing/',
});

const included = [
  'A police-verified, breath-tested driver',
  'Arrival within 30 minutes of confirmation',
  'The same driver for the whole booking',
  'Waiting time during the booked hours',
  'Driver break coverage on full-day bookings',
];

const notIncluded = [
  'The vehicle — you drive in your own car',
  'Fuel, tolls and parking charges',
  'Overnight stay costs on outstation trips',
];

/** The three pricing-specific questions, reused from the main FAQ set. */
const pricingFaqs = faqs.filter((f) =>
  ['Local and Outstation', 'extend my booking', 'payment methods'].some((needle) =>
    f.q.includes(needle),
  ),
);

export default function PricingPage() {
  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title="Simple, honest pricing"
        lede="Every rate below is the driver's charge, fixed at the time of booking. No surge pricing, no per-kilometre surprises and nothing added at the end of the trip."
        trail={trail}
      />

      <Section id="rates" title="Driver charges" headingLevel={2}>
        <PricingCards />
      </Section>

      <Section
        tone="subtle"
        id="included"
        eyebrow="Clear boundaries"
        title="What the rate covers"
        lede="So there is never a conversation about money at the end of a journey."
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <h3 className="font-display text-lg font-semibold">Included in every booking</h3>
            <ul className="mt-5 flex flex-col gap-3">
              {included.map((item) => (
                <li key={item} className="flex gap-3 text-[0.9375rem]">
                  <CheckIcon className="text-success mt-0.5 size-5 shrink-0" />
                  <span className="text-fg-muted">{item}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <h3 className="font-display text-lg font-semibold">Not included</h3>
            <ul className="mt-5 flex flex-col gap-3">
              {notIncluded.map((item) => (
                <li key={item} className="flex gap-3 text-[0.9375rem]">
                  <CloseIcon className="text-fg-subtle mt-0.5 size-5 shrink-0" />
                  <span className="text-fg-muted">{item}</span>
                </li>
              ))}
            </ul>
            <p className="text-fg-subtle mt-6 text-sm">
              For a long outstation trip, call us first — we will quote the whole journey
              including any halt, so you know the total before the driver leaves.
            </p>
          </Card>
        </div>
      </Section>

      <Section id="pricing-faq" eyebrow="Pricing questions" title="Before you book">
        <Accordion items={pricingFaqs} name="pricing-faq" defaultOpenFirst />
        <div className="mt-8">
          <ButtonLink href="/faq/" variant="outline">
            All frequently asked questions
          </ButtonLink>
        </div>
      </Section>

      <ClosingCTA
        title="Ready to book?"
        lede="Pick a package on the booking form, or just call — we will recommend the cheapest option that fits your day."
      />

      <JsonLd data={pricingSchema()} />
      <JsonLd data={faqSchema(pricingFaqs)} />
      <JsonLd data={breadcrumbSchema(trail)} />
    </>
  );
}
