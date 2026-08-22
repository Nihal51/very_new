import type { Metadata } from 'next';

import { JsonLd } from '@/components/JsonLd';
import { CitiesGrid } from '@/components/sections/CitiesGrid';
import { ClosingCTA } from '@/components/sections/ClosingCTA';
import { PageHero } from '@/components/sections/PageHero';
import { Card } from '@/components/ui/Card';
import { Section } from '@/components/ui/Section';
import { MapPinIcon } from '@/components/icons';
import { cities } from '@/lib/content';
import { breadcrumbSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';
import { site } from '@/lib/site';

const trail = [{ name: 'Cities', path: '/cities/' }];

export const metadata: Metadata = pageMeta({
  title: 'Cities We Serve',
  description:
    'DriveBuddy provides verified drivers in Raipur, Bhilai, Durg and Bilaspur — 24 hours a day, with a 30-minute arrival guarantee. See coverage area by city.',
  path: '/cities/',
});

export default function CitiesPage() {
  return (
    <>
      <PageHero
        eyebrow="Service area"
        title="Where we operate"
        lede={`Four cities across ${site.region}, each with its own driver roster on duty around the clock. Pick your city to see the areas we cover and how quickly we usually reach you.`}
        trail={trail}
      />

      <Section id="city-list" title="Choose your city" headingLevel={2}>
        <CitiesGrid />
      </Section>

      <Section
        tone="subtle"
        id="coverage-detail"
        eyebrow="Coverage"
        title="What coverage actually means"
        lede="Not a map with a radius drawn on it — a roster of drivers who live and work in these areas."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          {cities.map((city) => (
            <Card key={city.slug} className="reveal">
              <div className="flex items-center gap-3">
                <span className="bg-accent-subtle text-accent-text flex size-10 items-center justify-center rounded-xl">
                  <MapPinIcon className="size-5" />
                </span>
                <h3 className="font-display text-lg font-semibold">{city.name}</h3>
              </div>
              <p className="text-fg-muted mt-4 text-[0.9375rem]">{city.coverage}</p>
              <p className="text-fg-subtle mt-4 text-sm">
                <span className="text-fg font-semibold">Booked most here:</span> {city.popular}
              </p>
            </Card>
          ))}
        </div>

        <p className="text-fg-subtle mt-8 text-sm">
          Travelling outside these four cities? Outstation bookings start from any of them and go
          anywhere in {site.region} and beyond — call us for a quote on the full journey.
        </p>
      </Section>

      <ClosingCTA />

      <JsonLd data={breadcrumbSchema(trail)} />
    </>
  );
}
