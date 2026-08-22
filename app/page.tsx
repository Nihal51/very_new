import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';

import { BookingForm } from '@/components/BookingForm';
import { JsonLd } from '@/components/JsonLd';
import { CitiesGrid } from '@/components/sections/CitiesGrid';
import { ClosingCTA } from '@/components/sections/ClosingCTA';
import { HomeHero } from '@/components/sections/HomeHero';
import { Pillars } from '@/components/sections/Pillars';
import { PricingCards } from '@/components/sections/PricingCards';
import { ServicesGrid } from '@/components/sections/ServicesGrid';
import { Testimonials } from '@/components/sections/Testimonials';
import { Accordion } from '@/components/ui/Accordion';
import { ButtonLink } from '@/components/ui/Button';
import { Container, Section } from '@/components/ui/Section';
import { StatBlock } from '@/components/ui/StatBlock';
import { ArrowRightIcon } from '@/components/icons';
import { faqs, stats } from '@/lib/content';
import { faqSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';
import { site } from '@/lib/site';

export const metadata: Metadata = pageMeta({
  title: `${site.name} — Verified Drivers in Raipur, Bhilai & Durg`,
  description:
    'Hire a police-verified, sober, trained driver for your own car. 30-minute arrival, 24/7, from ₹300 — Raipur, Bhilai, Durg and Bilaspur.',
  path: '/',
});

/** Small text link with a trailing arrow — used to send readers to the full page. */
function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      /* min-h-11 with negative margins: a 44px touch target that occupies the
         same visual space as the 20px line of text it wraps. */
      className="text-accent-text ease-out-quart -my-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-semibold transition-[gap] duration-150 hover:gap-2.5"
    >
      {children}
      <ArrowRightIcon className="size-4" />
    </Link>
  );
}

export default function HomePage() {
  return (
    <>
      <HomeHero />

      {/* Booking form sits directly under the hero — the shortest path to a lead. */}
      <section
        id="book"
        aria-labelledby="book-heading"
        className="border-border bg-bg-subtle scroll-mt-20 border-b py-16 sm:py-20"
      >
        <Container>
          <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:items-start lg:gap-14">
            <div className="reveal lg:sticky lg:top-24">
              <p className="text-eyebrow text-accent-text uppercase">Book in 30 seconds</p>
              <h2 id="book-heading" className="text-display-md mt-3">
                Tell us where, we send a driver
              </h2>
              <p className="text-lede text-fg-muted mt-4">
                No app to install and no payment up front. Send the form and our dispatch team
                calls you back within minutes to confirm the driver and arrival time.
              </p>
              <StatBlock stats={stats.slice(0, 2)} className="mt-8 lg:grid-cols-2" />
            </div>

            <BookingForm id="booking-form" headingLevel="h3" />
          </div>
        </Container>
      </section>

      <Section
        id="trust"
        eyebrow="Why families trust us"
        title="Four checks before anyone drives your car"
        lede="Verification is not a marketing line here — it is a sequence every driver clears before taking a single booking."
      >
        <Pillars />
      </Section>

      <Section tone="subtle" id="stats" title="Where we stand today" align="center">
        <StatBlock stats={stats} />
      </Section>

      <Section
        id="services"
        eyebrow="What we do"
        title="A driver for every kind of journey"
        lede="Four services, one standard of driver. Pick the one that matches your day."
      >
        <ServicesGrid />
        <div className="mt-8">
          <MoreLink href="/services/">See what each service includes</MoreLink>
        </div>
      </Section>

      <Section
        tone="subtle"
        id="pricing"
        eyebrow="Pricing"
        title="Simple, honest rates"
        lede="Fixed at the time of booking. No surge pricing, no hidden charges."
      >
        <PricingCards compact />
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <ButtonLink href="/pricing/" variant="outline">
            Full price list
          </ButtonLink>
          <MoreLink href="/book/">Book a driver now</MoreLink>
        </div>
      </Section>

      <Section
        id="reviews"
        eyebrow="Happy clients"
        title="What families say about us"
        lede="Real reviews from customers across Chhattisgarh."
      >
        <Testimonials />
      </Section>

      <Section
        tone="subtle"
        id="cities"
        eyebrow="Service area"
        title="We come to you"
        lede="Four cities, verified drivers in each, around the clock."
      >
        <CitiesGrid />
      </Section>

      <Section id="faq" eyebrow="Got questions?" title="Frequently asked">
        <Accordion items={faqs.slice(0, 5)} name="home-faq" defaultOpenFirst />
        <div className="mt-8">
          <MoreLink href="/faq/">Read all {faqs.length} questions</MoreLink>
        </div>
      </Section>

      <ClosingCTA />

      {/* The five questions shown above, marked up for the FAQ rich result. */}
      <JsonLd data={faqSchema(faqs.slice(0, 5))} />
    </>
  );
}
