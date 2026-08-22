import type { Metadata } from 'next';

import { JsonLd } from '@/components/JsonLd';
import { PageHero } from '@/components/sections/PageHero';
import { Alert } from '@/components/ui/Alert';
import { Container } from '@/components/ui/Section';
import { breadcrumbSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';
import { formatPhone, mailHref, site } from '@/lib/site';

const trail = [{ name: 'Terms', path: '/terms/' }];

export const metadata: Metadata = pageMeta({
  title: 'Terms of Service',
  description:
    'The terms on which DriveBuddy supplies drivers: what a booking includes, rates and payment, cancellations, your responsibilities and liability.',
  path: '/terms/',
});

export default function TermsPage() {
  return (
    <>
      <PageHero
        eyebrow="Legal"
        title="Terms of service"
        lede="What you can expect from us, and what we need from you. Written to be read, not to be skipped."
        trail={trail}
      />

      <div className="py-14 sm:py-16">
        <Container>
          <Alert tone="info" title="Please have this reviewed" className="measure">
            These terms reflect how the service is described on this website. They are a starting
            point, not legal advice — have a lawyer adapt them to your business before relying on
            them, particularly the liability and insurance sections.
          </Alert>

          <div className="prose-legal mt-10">
            <p className="text-fg-subtle text-sm">Last updated: 22 August 2026</p>

            <h2 id="what-we-provide">1. What we provide</h2>
            <p>
              {site.legalName} supplies a <strong>driver</strong>, not a vehicle. You provide the car
              you want driven, along with valid registration, insurance and fuel. We are a driver
              service, not a taxi or cab operator.
            </p>

            <h2 id="booking">2. Making a booking</h2>
            <p>
              A booking is confirmed only when we call you back and agree the service, rate and
              arrival time. Submitting the website form is a request, not a confirmation. We aim to
              have a driver with you within 30 minutes of confirmation; this is a target based on
              normal conditions, not a guarantee against traffic, weather or exceptional demand.
            </p>

            <h2 id="rates">3. Rates and payment</h2>
            <ul>
              <li>Rates are those quoted and agreed on the confirmation call.</li>
              <li>
                Published rates cover the driver only. Fuel, tolls, parking and any overnight stay
                costs on outstation trips are yours.
              </li>
              <li>
                Extensions beyond the booked hours are charged at the same hourly rate, agreed at the
                time you extend.
              </li>
              <li>Payment is due after the trip, by cash, UPI or bank transfer.</li>
              <li>We do not apply surge pricing. The rate agreed is the rate charged.</li>
            </ul>

            <h2 id="cancellation">4. Cancellations</h2>
            <p>
              Cancel free of charge any time before the driver sets out. If the driver has already
              travelled to your pickup address, we may charge one hour at the applicable rate to
              cover their time. Simply call the number you booked on — no forms.
            </p>

            <h2 id="your-responsibilities">5. Your responsibilities</h2>
            <ul>
              <li>
                The vehicle must be roadworthy, taxed and covered by valid insurance that permits a
                third party to drive it. <strong>Please check your policy</strong> — most Indian
                private motor policies cover any licensed driver with the owner&apos;s consent, but
                you should confirm yours does.
              </li>
              <li>You must be legally entitled to authorise someone to drive the vehicle.</li>
              <li>
                Do not ask a driver to exceed speed limits, carry unlawful goods, or drive a vehicle
                you know to be unsafe. Drivers may refuse and end the booking in these cases.
              </li>
              <li>Please do not leave valuables in the vehicle; we cannot accept responsibility for them.</li>
            </ul>

            <h2 id="our-standards">6. Our standards</h2>
            <p>
              Every driver we assign has passed government ID verification, a police background
              check and holds a minimum of five years of driving experience, and is breath-tested
              before each shift. If a driver arrives and you have any doubt about their sobriety or
              conduct, refuse the booking and call us immediately — you will not be charged.
            </p>

            <h2 id="liability">7. Liability</h2>
            <p>
              Our drivers exercise reasonable care and skill. In the event of an incident, your
              vehicle insurance is the primary cover, as it would be with any driver you permit to
              drive your car. Our liability is limited to the value of the booking, except where
              liability cannot lawfully be limited. We are not liable for indirect losses such as
              missed flights, appointments or business opportunities.
            </p>

            <h2 id="emergencies">8. Medical and emergency bookings</h2>
            <p>
              We prioritise hospital and emergency requests, and give them the fastest dispatch we
              can. We are not an ambulance service and provide no medical care. In a
              life-threatening emergency, call 108 first.
            </p>

            <h2 id="conduct">9. Conduct and refusal of service</h2>
            <p>
              We may decline or end a booking where a customer behaves abusively toward a driver,
              where the vehicle or request is unsafe or unlawful, or where an address cannot be
              reached. We will tell you why.
            </p>

            <h2 id="complaints">10. Complaints</h2>
            <p>
              Call <span className="tabular">{formatPhone(site.phone)}</span> or email{' '}
              <a href={mailHref}>{site.email}</a> with your booking details. We respond to
              complaints within two working days and take driver conduct reports seriously.
            </p>

            <h2 id="changes">11. Changes and governing law</h2>
            <p>
              We may update these terms; the version in force is the one published here when your
              booking is confirmed. These terms are governed by the laws of India, and the courts at
              Raipur, {site.region} have jurisdiction.
            </p>
          </div>
        </Container>
      </div>

      <JsonLd data={breadcrumbSchema(trail)} />
    </>
  );
}
