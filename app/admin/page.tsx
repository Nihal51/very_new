import type { Metadata } from 'next';

import { AdminApp } from '@/components/admin/AdminApp';
import { JsonLd } from '@/components/JsonLd';
import { Container } from '@/components/ui/Section';
import { breadcrumbSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';

/* The dispatch desk. Not linked from anywhere, noindex, disallowed in
   robots.txt — and none of that is the security: firestore.rules only show data
   to accounts holding the admin claim. This page is just a window onto it. */
export const metadata: Metadata = pageMeta({
  title: 'Admin — Bookings & Drivers',
  description:
    'DriveBuddy dispatch desk: live bookings, driver assignment and driver applications. Admin access only; sign in with the admin Google account.',
  path: '/admin/',
  noIndex: true,
});

export default function AdminPage() {
  return (
    <>
      {/* The sticky "Call now / WhatsApp" bar is for customers, not the dispatcher. */}
      <style>{'[data-cta-bar]{display:none}'}</style>
      <Container className="py-8 sm:py-10">
        <h1 className="text-display-md">Dispatch desk</h1>
        <div className="mt-6">
          <AdminApp />
        </div>
      </Container>
      <JsonLd data={breadcrumbSchema([{ name: 'Admin', path: '/admin/' }])} />
    </>
  );
}
