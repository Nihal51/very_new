import type { Metadata } from 'next';

import { TripClockApp } from '@/components/trip/TripClockApp';
import { Container } from '@/components/ui/Section';
import { pageMeta } from '@/lib/seo';

/* The driver's trip clock: opened from the link /admin sends him on WhatsApp
   (/trip/?k=…). Not linked from anywhere, noindex, disallowed in robots.txt.
   The key in the link is what lets him tap — firestore.rules, tripLinks. */
export const metadata: Metadata = pageMeta({
  title: 'Driver Trip Clock',
  description:
    'DriveBuddy drivers: tap Start, Car dropped and Home on your trip link, so the bill uses the real times. Opened from the link the office sends on WhatsApp.',
  path: '/trip/',
  noIndex: true,
});

export default function TripPage() {
  return (
    <>
      {/* The sticky "Call now / WhatsApp" bar is for customers, not the driver. */}
      <style>{'[data-cta-bar]{display:none}'}</style>
      <Container className="py-6 sm:py-10">
        <h1 className="text-display-sm mb-5 text-center">ड्राइवर ट्रिप घड़ी · Trip clock</h1>
        <TripClockApp />
      </Container>
    </>
  );
}
