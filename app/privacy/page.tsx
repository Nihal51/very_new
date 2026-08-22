import type { Metadata } from 'next';

import { JsonLd } from '@/components/JsonLd';
import { PageHero } from '@/components/sections/PageHero';
import { Alert } from '@/components/ui/Alert';
import { Container } from '@/components/ui/Section';
import { breadcrumbSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';
import { mailHref, site } from '@/lib/site';

const trail = [{ name: 'Privacy', path: '/privacy/' }];

export const metadata: Metadata = pageMeta({
  title: 'Privacy Policy',
  description:
    'What DriveBuddy collects when you submit a booking or driver application, how it is used, how long it is kept, and how to ask for your data to be deleted.',
  path: '/privacy/',
});

export default function PrivacyPage() {
  return (
    <>
      <PageHero
        eyebrow="Legal"
        title="Privacy policy"
        lede="Plain English: we collect the details needed to send you a driver, we use them for that, and we do not sell them."
        trail={trail}
      />

      <div className="py-14 sm:py-16">
        <Container>
          <Alert tone="info" title="Please have this reviewed" className="measure">
            This policy describes what the website actually does. It is a starting point written
            for accuracy, not legal advice — have a lawyer confirm it meets your obligations under
            India&apos;s DPDP Act before you rely on it.
          </Alert>

          <div className="prose-legal mt-10">
            <p className="text-fg-subtle text-sm">Last updated: 22 August 2026</p>

            <h2 id="what-we-collect">What we collect</h2>
            <p>
              We only collect what you type into one of our two forms. There are no tracking
              pixels, advertising cookies or analytics scripts on this site.
            </p>
            <h3>Booking form</h3>
            <ul>
              <li>Your name</li>
              <li>Your mobile number</li>
              <li>Your city and pickup address</li>
              <li>The service you selected and, if given, a preferred date and time</li>
              <li>Any notes you choose to add</li>
            </ul>
            <h3>Driver application form</h3>
            <ul>
              <li>Your name and mobile number</li>
              <li>The city you want to work in</li>
              <li>Your years of experience and licence type</li>
              <li>Anything you write in the free-text field</li>
            </ul>

            <h2 id="how-we-use-it">How we use it</h2>
            <p>
              Booking details are used to call you back, confirm the booking and dispatch a driver
              to your address. Driver applications are used to assess and contact applicants. That
              is the whole purpose — we do not use your details for marketing unless you ask us to.
            </p>

            <h2 id="who-can-see-it">Who can see it</h2>
            <p>
              Submissions are stored in Google Firebase (Firestore), and are readable only by
              {' '}{site.legalName} staff who handle dispatch and recruitment. Your pickup address
              and phone number are shared with the driver assigned to your booking, because they
              cannot reach you otherwise. We do not sell, rent or trade your information.
            </p>

            <h2 id="how-long">How long we keep it</h2>
            <p>
              Booking records are retained for up to 24 months for support and dispute resolution.
              Driver applications are kept for up to 12 months from the date of application, unless
              you join us, in which case they become part of your employment record.
            </p>

            <h2 id="your-rights">Your rights</h2>
            <p>
              You can ask us what we hold about you, ask for it to be corrected, or ask for it to be
              deleted. Email <a href={mailHref}>{site.email}</a> or call us, and we will action the
              request within 30 days. Deletion requests are honoured except where we are required to
              retain a record by law.
            </p>

            <h2 id="cookies">Cookies</h2>
            <p>
              This website sets <strong>no cookies of its own</strong> and runs no third-party
              analytics. Fonts are served from our own domain rather than a font CDN, so no request
              leaves your browser to a third party while you read these pages.
            </p>

            <h2 id="security">Security</h2>
            <p>
              The site is served over HTTPS. Form submissions are written to Firestore under
              security rules that permit creating a record but not reading, editing or deleting one
              from the browser. We recommend you also treat your booking confirmation SMS or
              WhatsApp message as private.
            </p>

            <h2 id="children">Children</h2>
            <p>
              Our service is intended for adults who own or are responsible for a vehicle. We do not
              knowingly collect information from anyone under 18.
            </p>

            <h2 id="changes">Changes to this policy</h2>
            <p>
              If we change what we collect or why, we will update this page and change the date at
              the top. Material changes will be mentioned on the booking form itself.
            </p>

            <h2 id="contact">Contact</h2>
            <p>
              Questions about this policy: <a href={mailHref}>{site.email}</a>, or call the numbers
              in the footer. {site.legalName}, Raipur, {site.region}, India.
            </p>
          </div>
        </Container>
      </div>

      <JsonLd data={breadcrumbSchema(trail)} />
    </>
  );
}
