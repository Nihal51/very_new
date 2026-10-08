import type { Metadata } from 'next';

import { AccountApp } from '@/components/account/AccountApp';
import { JsonLd } from '@/components/JsonLd';
import { PageHero } from '@/components/sections/PageHero';
import { Container } from '@/components/ui/Section';
import { breadcrumbSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';

const trail = [{ name: 'My account', path: '/account/' }];

/* A login page has nothing for a search engine, so it is noindex and kept out
   of the sitemap (scripts/audit.mjs knows to expect that). */
export const metadata: Metadata = pageMeta({
  title: 'My Account — Log In or Sign Up',
  description:
    'Log in with your mobile number or Google account to see your DriveBuddy bookings, their status and your driver, and book faster next time.',
  path: '/account/',
  noIndex: true,
});

export default function AccountPage() {
  return (
    <>
      <PageHero
        eyebrow="My account"
        title="Your bookings, in one place"
        lede="Log in with your mobile number or Google. Booking without an account still works, always."
        trail={trail}
      />
      <Container className="py-12 sm:py-16">
        <AccountApp />
      </Container>
      <JsonLd data={breadcrumbSchema(trail)} />
    </>
  );
}
