import type { Metadata } from 'next';
import Link from 'next/link';

import { JsonLd } from '@/components/JsonLd';
import { ClosingCTA } from '@/components/sections/ClosingCTA';
import { PlaceLinks } from '@/components/sections/LocalBlocks';
import { PageHero } from '@/components/sections/PageHero';
import { Section } from '@/components/ui/Section';
import { cities, services } from '@/lib/content';
import { cityServicePath, localitiesOf, places, townsNear } from '@/lib/local-seo';
import { breadcrumbSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';
import { priceText } from '@/lib/settings';

export const metadata: Metadata = pageMeta({
  title: 'Driver Service Near You — All Areas We Cover',
  description: `Find a driver near you in Raipur, Bhilai, Durg, Bilaspur, Naya Raipur, Arang, Abhanpur, Kumhari and Tilda-Neora. Verified drivers for your car from ${priceText.oneHour}.`,
  path: '/driver-in/',
});

const trail = [{ name: 'Areas', path: '/driver-in/' }];

export default function AreasPage() {
  return (
    <>
      <PageHero
        eyebrow={`${places.length} areas · 24/7`}
        title="Find a driver near you"
        lede="Pick your area to see how quickly a DriveBuddy driver reaches you, what it costs and every service available there — personal driver, night driver, monthly driver, airport and outstation trips, weddings and one-way car drops."
        trail={trail}
      />

      {cities.map((city, i) => {
        const towns = townsNear(city.slug);
        return (
          <Section
            key={city.slug}
            tone={i % 2 ? 'subtle' : 'default'}
            id={city.slug}
            eyebrow={city.badge}
            title={
              <Link href={`/cities/${city.slug}/`} className="hover:text-accent-text">
                Driver in {city.name}
              </Link>
            }
            lede={city.short}
          >
            <h3 className="text-fg-subtle mb-3 text-xs font-semibold tracking-wide uppercase">Neighbourhoods</h3>
            <PlaceLinks places={localitiesOf(city.slug)} />
            {towns.length > 0 && (
              <>
                <h3 className="text-fg-subtle mt-7 mb-3 text-xs font-semibold tracking-wide uppercase">
                  Towns served from {city.name}
                </h3>
                <PlaceLinks places={towns} />
              </>
            )}
            <h3 className="text-fg-subtle mt-7 mb-3 text-xs font-semibold tracking-wide uppercase">
              Services in {city.name}
            </h3>
            <ul className="flex flex-wrap gap-2">
              {services.map((s) => (
                <li key={s.slug}>
                  <Link
                    href={cityServicePath(city, s)}
                    className="border-border-strong text-fg-muted hover:border-accent hover:text-fg inline-flex rounded-full border px-3 py-1.5 text-sm font-medium transition-colors"
                  >
                    {s.title} in {city.name}
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        );
      })}

      <ClosingCTA />
      <JsonLd data={breadcrumbSchema(trail)} />
    </>
  );
}
