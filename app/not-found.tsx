import type { Metadata } from 'next';

import { PageHero } from '@/components/sections/PageHero';
import { ButtonLink } from '@/components/ui/Button';
import { Container } from '@/components/ui/Section';
import { EmptyState } from '@/components/ui/EmptyState';
import { nav } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <>
      <PageHero
        eyebrow="404"
        title="Page not found"
        lede="That link does not lead anywhere. Nothing is broken with your booking — the page just is not here."
      />

      <div className="py-14 sm:py-16 lg:py-20">
        <Container>
          <EmptyState
            icon="mapPin"
            title="Let us get you back on the road"
            body="Try one of the pages below, or call us and we will handle it over the phone."
            action={
              <>
                <ButtonLink href="/">Go to the homepage</ButtonLink>
                <ButtonLink href="/book/" variant="outline">
                  Book a driver
                </ButtonLink>
              </>
            }
          />

          <nav aria-label="Site pages" className="mt-12">
            <h2 className="text-fg-subtle text-eyebrow text-center uppercase">
              Everything on the site
            </h2>
            <ul className="mt-5 flex flex-wrap justify-center gap-x-6 gap-y-3">
              {nav.map((item) => (
                <li key={item.href}>
                  <ButtonLink href={item.href} variant="ghost" size="sm">
                    {item.label}
                  </ButtonLink>
                </li>
              ))}
            </ul>
          </nav>
        </Container>
      </div>
    </>
  );
}
