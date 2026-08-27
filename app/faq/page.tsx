import type { Metadata } from 'next';

import { JsonLd } from '@/components/JsonLd';
import { ClosingCTA } from '@/components/sections/ClosingCTA';
import { PageHero } from '@/components/sections/PageHero';
import { Accordion } from '@/components/ui/Accordion';
import { Container } from '@/components/ui/Section';
import { faqs } from '@/lib/content';
import { breadcrumbSchema, faqSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';

const trail = [{ name: 'FAQ', path: '/faq/' }];

export const metadata: Metadata = pageMeta({
  title: 'Driver Service FAQ — Timings, Rates, Safety',
  description:
    'How quickly drivers arrive, how they are verified, night service timings, payment methods, extending a booking and whether you need to provide the car — answered.',
  path: '/faq/',
});

export default function FaqPage() {
  return (
    <>
      <PageHero
        eyebrow="FAQ"
        title="Questions, answered"
        lede="Everything customers ask us before their first booking. If yours is not here, call — we would rather answer it than have you guess."
        trail={trail}
      />

      <div className="py-14 sm:py-16 lg:py-20">
        <Container>
          <div className="max-w-3xl">
            <Accordion items={faqs} name="faq-page" defaultOpenFirst />
          </div>
        </Container>
      </div>

      <ClosingCTA
        title="Still not sure?"
        lede="Call us and ask. No booking, no obligation — we will tell you straight whether we are the right fit for your journey."
      />

      <JsonLd data={faqSchema(faqs)} />
      <JsonLd data={breadcrumbSchema(trail)} />
    </>
  );
}
