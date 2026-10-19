import type { Metadata } from 'next';

import { JsonLd } from '@/components/JsonLd';
import { PageHero } from '@/components/sections/PageHero';
import { Alert } from '@/components/ui/Alert';
import { Container } from '@/components/ui/Section';
import { breadcrumbSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';
import { formatPhone, mailHref, site } from '@/lib/site';

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
            <p className="text-fg-subtle text-sm">Last updated: 19 October 2026</p>

            <h2 id="what-we-collect">What we collect</h2>
            <p>
              We only collect what you type into our forms (on this website or in the DriveBuddy
              app), plus the few account details listed below if you choose to log in. There are no
              tracking pixels, advertising cookies or analytics scripts on this website. The app can
              send the two kinds of technical data described under &ldquo;The DriveBuddy app&rdquo;,
              and neither is used for advertising.
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

            <h3>If you log in (optional)</h3>
            <ul>
              <li>Your Google account name and email address, and an account ID from Google Firebase</li>
              <li>The name and mobile number you save, so we can fill in your next booking</li>
            </ul>
            <h3>The DriveBuddy app</h3>
            <ul>
              <li>The same booking details as the form above</li>
              <li>
                If you turn on booking updates: a notification token for your phone and the language
                you use in the app, so we can tell you when a booking is confirmed or a driver is
                assigned
              </li>
            </ul>
            <h3>Crash reports and usage statistics (app only)</h3>
            <ul>
              <li>
                <strong>Crash reports:</strong> if the app crashes, a technical report (the error,
                the app version and the phone model and Android or iOS version) is sent to Sentry so
                we can fix the fault. It contains no name, phone number, address or booking details.
              </li>
              <li>
                <strong>Anonymous usage statistics:</strong> counts of actions such as &ldquo;app
                opened&rdquo; or &ldquo;booking sent&rdquo;, with the app language and version, sent
                to PostHog under a random ID that is not linked to your name, number or account. You
                can switch this off in the app under Account → <em>Anonymous usage stats</em>.
              </li>
            </ul>
            <p>
              The app does not access your location, contacts, photos or files, does not use the
              advertising ID, and shows no advertising.
            </p>

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
            <p>
              Service providers that handle data for us: Google Firebase (storage and login), Expo
              with Google and Apple (delivering app notifications), Sentry (app crash reports),
              PostHog (anonymous app usage statistics) and Meta&apos;s WhatsApp (when we message you
              there about your booking).
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

            <h2 id="delete-account">Deleting your DriveBuddy account</h2>
            <p>
              This applies to the <strong>DriveBuddy</strong> app (by {site.legalName}) and to
              logins on this website. There are two ways to delete your account:
            </p>
            <ol>
              <li>
                <strong>In the app:</strong> open the <em>Account</em> tab → <em>Delete my account</em>{' '}
                → confirm. It happens at once.
              </li>
              <li>
                <strong>Without the app:</strong> email <a href={mailHref}>{site.email}</a> from the
                email address you log in with (or call or WhatsApp {formatPhone(site.phone)}) and write
                &ldquo;Delete my DriveBuddy account&rdquo;. We delete it within 7 days and confirm
                by reply.
              </li>
            </ol>
            <p>
              <strong>Deleted straight away:</strong> your login (Google account link), the name and
              mobile number saved in your profile, and your phones&apos; notification tokens.{' '}
              <strong>Kept:</strong> records of past bookings, for up to 24 months for accounts,
              disputes and safety, no longer linked to any login; then they are deleted. Anonymous
              usage statistics are not linked to you, so there is nothing to connect them to your
              account. To have past booking records removed sooner, say so in your email.
            </p>

            <h2 id="cookies">Cookies</h2>
            <p>
              This website sets <strong>no cookies of its own</strong> and runs no third-party
              analytics. Fonts are served from our own domain rather than a font CDN, so no request
              leaves your browser to a third party while you read these pages.
            </p>

            <h2 id="security">Security</h2>
            <p>
              The site and the app use HTTPS only. Bookings are written to Firestore under security
              rules that let a guest create a booking but not read, edit or delete one; a logged-in
              customer can read only their own bookings and profile. We recommend you also treat
              your booking confirmation SMS or WhatsApp message as private.
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
