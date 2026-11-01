import type { Metadata } from 'next';
import Link from 'next/link';

import { JsonLd } from '@/components/JsonLd';
import { ClosingCTA } from '@/components/sections/ClosingCTA';
import { PageHero } from '@/components/sections/PageHero';
import { Accordion } from '@/components/ui/Accordion';
import { ButtonAnchor, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Section } from '@/components/ui/Section';
import { CheckIcon, PhoneIcon, WhatsappIcon } from '@/components/icons';
import { breadcrumbSchema, faqSchema, newCarSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';
import { priceText, settings } from '@/lib/settings';
import { formatPhone, site, telHref, waHref } from '@/lib/site';

/**
 * For people who have bought a car but do not drive yet (or not confidently):
 * the car brought home from the showroom, then a driver until they drive
 * themselves. Booked as an ordinary local booking; the note tells the team
 * it is a showroom pickup.
 */

const trail = [{ name: 'New car? Get a driver', path: '/new-car-driver/' }];

const bookHref = `/book/?pkg=1-hour-300&note=${encodeURIComponent('New car: pick up from the showroom and drive it home')}`;
const whatsapp =
  'Hi DriveBuddy, I bought a new car and need a driver to bring it home from the showroom.\nShowroom:\nDelivery date and time:\nDrop address:';

export const metadata: Metadata = pageMeta({
  title: 'New Car but Can’t Drive? Showroom Pickup & Driver',
  description: `New car but can’t drive yet? A verified driver brings it home from the showroom in Raipur, Bhilai, Durg or Bilaspur and drives it for you, from ${priceText.oneHour}/hour.`,
  path: '/new-car-driver/',
});

const steps = [
  {
    title: 'Tell us the showroom',
    body: 'Book online, WhatsApp or call with the showroom, the delivery date and time, and your home address.',
  },
  {
    title: 'He meets you at the showroom',
    body: 'A police-verified, experienced driver reaches the showroom before your handover. Enjoy the delivery — he waits.',
  },
  {
    title: 'He checks the car with you',
    body: 'Before driving off he goes round the car with you and takes photos: body, odometer and fuel. Your record and ours.',
  },
  {
    title: 'He drives it home gently',
    body: 'Slowly and smoothly, as a brand-new car should be driven, and parks it where you want it.',
  },
];

const plans = [
  {
    title: 'When you need to go somewhere',
    price: `${priceText.oneHour} for 1 hour · ${priceText.threeHours} for 3 hours`,
    body: 'Office, market, a family visit, the temple: book a driver for a few hours whenever you need one.',
    link: { href: '/services/personal-driver/', label: 'Personal driver by the hour' },
  },
  {
    title: 'A whole day out',
    price: `${priceText.fullDay} for 8 hours`,
    body: 'Shopping, relatives across town, a day trip: one driver with you for the day.',
    link: { href: '/pricing/', label: 'Full-day rates' },
  },
  {
    title: 'Every day, the same driver',
    price: `${priceText.basic} a month (Basic) · ${priceText.premium} (Premium)`,
    body: 'If the car is for daily use: one regular driver who knows your routes, with a stand-in on his leave days.',
    link: { href: '/services/monthly-driver/', label: 'Monthly driver plans' },
  },
];

const checklist = [
  'Insurance and temporary registration done by the showroom before the car leaves — we do not move a car without them',
  'Enough fuel for the drive home (new cars often come with very little)',
  'FASTag fixed, if the way home has a toll',
  'Papers, spare key and accessories collected from the showroom',
  'Someone at home to receive the car, if you are not riding with him',
];

const faqs = [
  {
    q: 'I bought a car but I don’t know driving. Can you bring it home from the showroom?',
    a: `Yes. A verified driver meets you at the showroom in Raipur, Bhilai, Durg or Bilaspur, checks the car with you, and drives it home. It is booked like any local booking — from ${priceText.oneHour} for the first hour — and we confirm the price on the call.`,
  },
  {
    q: 'Do I have to be at the showroom?',
    a: 'Usually yes: most showrooms want the owner at the handover to sign the papers and take the keys. You can ride home with the driver in your new car. If the showroom agrees to hand the car to our driver without you, tell us who will receive it at home.',
  },
  {
    q: 'Can you deliver the new car to another town?',
    a: 'Yes. If the showroom is in Raipur and home is in Bilaspur, Korba, Ambikapur or anywhere else, it is a one-way drop: priced by distance, with the driver coming back by bus or train.',
  },
  {
    q: 'Who drives the car after that, until I learn?',
    a: `Our drivers, whenever you need one: by the hour (${priceText.oneHour}), for a full day (${priceText.fullDay}), or a regular monthly driver (${priceText.basic} a month on the Basic plan).`,
  },
  {
    q: 'Do you teach driving?',
    a: 'No — we are drivers, not a driving school. Learn at a licensed driving school; until you are confident on the road, our driver takes you wherever you need to go.',
  },
  {
    q: 'Will he drive my new car carefully?',
    a: 'Yes. Every DriveBuddy driver is police verified, sober and experienced. With a new car he drives gently, as it should be for its first kilometres, and photographs the car with you before he sets off.',
  },
];

export default function NewCarDriverPage() {
  return (
    <>
      <PageHero
        eyebrow="New car owners"
        title="Bought a new car but can’t drive yet? We bring it home, and drive it for you"
        lede="A police-verified driver collects your new car from the showroom and drives it home carefully. After that, book a driver by the hour, the day or the month — until you are ready to drive yourself."
        trail={trail}
        actions={
          <>
            <ButtonLink href={bookHref} size="lg">
              Book showroom pickup
            </ButtonLink>
            <ButtonAnchor href={waHref(whatsapp)} target="_blank" rel="noopener noreferrer" variant="outline" size="lg">
              <WhatsappIcon className="size-5" />
              WhatsApp us
            </ButtonAnchor>
            <ButtonAnchor href={telHref} variant="outline" size="lg">
              <PhoneIcon className="size-5" />
              <span className="tabular">{formatPhone(site.phone)}</span>
            </ButtonAnchor>
          </>
        }
      />

      <Section id="how" eyebrow="Delivery day" title="From the showroom to your door">
        <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.title}>
              <Card className="h-full">
                <p className="text-accent-text font-display text-sm font-bold">0{i + 1}</p>
                <h3 className="font-display mt-1 text-lg font-semibold">{s.title}</h3>
                <p className="text-fg-muted mt-2 text-[0.9375rem]">{s.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        tone="subtle"
        id="after"
        eyebrow="After delivery"
        title="A driver until you drive"
        lede="Your car, our driver — as often as you need him. Fuel, tolls and parking are yours, as on every booking."
      >
        <ul className="grid gap-5 lg:grid-cols-3">
          {plans.map((p) => (
            <li key={p.title}>
              <Card className="flex h-full flex-col">
                <h3 className="font-display text-lg font-semibold">{p.title}</h3>
                <p className="mt-2 font-semibold">{p.price}</p>
                <p className="text-fg-muted mt-2 text-[0.9375rem]">{p.body}</p>
                <div className="mt-auto pt-5">
                  <ButtonLink href={p.link.href} variant="outline" size="sm">
                    {p.link.label}
                  </ButtonLink>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="checklist" eyebrow="Before you leave the showroom" title="A quick checklist">
        <Card>
          <ul className="flex flex-col gap-3">
            {checklist.map((item) => (
              <li key={item} className="flex gap-3 text-[0.9375rem]">
                <CheckIcon className="text-success mt-0.5 size-5 shrink-0" />
                <span className="text-fg-muted">{item}</span>
              </li>
            ))}
          </ul>
        </Card>
        <p className="text-fg-subtle mt-4 text-sm">
          Showroom far from home, or home in another town? That is a{' '}
          <Link href="/one-way-drop/" className="text-accent-text underline underline-offset-2">
            one-way drop
          </Link>
          . Car showroom sales team? See our{' '}
          <Link href="/partners/" className="text-accent-text underline underline-offset-2">
            partner program
          </Link>
          .
        </p>
      </Section>

      <Section tone="subtle" id="faq" eyebrow="Questions" title="New car, no driving yet">
        <Accordion items={faqs} name="new-car-faq" defaultOpenFirst />
      </Section>

      <ClosingCTA
        title="Picking up your new car soon?"
        lede="Book the showroom pickup now, or call — we confirm the driver and the time with you before delivery day."
      />

      <JsonLd data={newCarSchema({ from: settings.prices.oneHour })} />
      <JsonLd data={faqSchema(faqs)} />
      <JsonLd data={breadcrumbSchema(trail)} />
    </>
  );
}
