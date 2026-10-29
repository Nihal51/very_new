import type { Metadata } from 'next';

import { JsonLd } from '@/components/JsonLd';
import { OneWayPriceChecker } from '@/components/OneWayPriceChecker';
import { ClosingCTA } from '@/components/sections/ClosingCTA';
import { PageHero } from '@/components/sections/PageHero';
import { Accordion } from '@/components/ui/Accordion';
import { ButtonAnchor, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Section } from '@/components/ui/Section';
import { CheckIcon, CloseIcon, PhoneIcon } from '@/components/icons';
import { breadcrumbSchema, faqSchema, oneWayDropSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';
import { priceText, rupeeRange, rupees, settings } from '@/lib/settings';
import { formatPhone, site, telHref } from '@/lib/site';
import { homeText, kmText, tripFor } from '@/lib/trip';
import { DEFAULT_START_HOUR } from '@/lib/outstation';

const trail = [{ name: 'One-Way Drop', path: '/one-way-drop/' }];
const perDriveDay = `${priceText.outstation} for each ${priceText.outstationHours} of driving`;
const late = priceText.outstationReturnRule;

export const metadata: Metadata = pageMeta({
  title: 'One-Way Drop Driver: You & Your Car to Any City',
  description: `A verified driver takes you and your car, or just the car, from Raipur, Bhilai, Durg or Bilaspur to any city — with his train home timed from your start time.`,
  path: '/one-way-drop/',
});

/** Popular drops from Raipur, worked out from lib/outstation.ts at build time. */
const ROUTES = [
  'bilaspur',
  'korba',
  'raigarh',
  'jagdalpur',
  'ambikapur',
  'nagpur',
  'jabalpur',
  'sambalpur',
  'visakhapatnam',
  'bhubaneswar',
  'puri',
  'ranchi',
  'bhopal',
  'varanasi',
  'hyderabad',
  'kolkata',
  'lucknow',
  'pune',
  'mumbai',
  'delhi',
  'bengaluru',
  'chennai',
]
  .map((id) => tripFor('one-way-drop', 'Raipur', id, 0))
  .filter((t) => t.dest && t.est)
  .sort((a, b) => a.km - b.km);

const options = [
  {
    title: 'You and your car',
    body: 'Moving to a new city, a wedding or a hospital far from home, a long family trip you would rather not drive. The driver takes you and your car to the address, then comes home on his own.',
    points: ['Sit back for the whole journey', 'Overnight halts on long routes', 'Stops on the way, if you book the days'],
  },
  {
    title: 'Just the car',
    body: 'Your car needs to be in another city — at a new posting, with family, or waiting for you at the end of a trip. The driver delivers it to the address you give, then comes home on his own.',
    points: ['Tell us who receives the car and keys', 'Ideal when you fly or take the train', 'The same price as riding along'],
  },
];

const steps = [
  {
    title: 'See the price',
    body: 'Pick your city, destination and start time above: the estimate shows straight away, with the train he will take home.',
  },
  {
    title: 'We call you',
    body: 'Within minutes, to confirm the date, the address and the exact price.',
  },
  {
    title: 'The drive',
    body: `About ${priceText.outstationHours} of driving a day (${settings.outstation.kmPerDay} km), resting at night — or day and night, if you want it there sooner.`,
  },
  {
    title: 'He comes home',
    body: `By bus or train — you book his ticket. From the drop until he is home, waiting for his train included: ${late}.`,
  },
];

const included = [
  'A police-verified, sober, highway-experienced driver',
  `${priceText.outstation} for each ${priceText.outstationHours} of driving, ${priceText.outstationExtraHour} an hour beyond`,
  'The estimate times his train home from your start date and time',
  'Ride along or send the car alone — the same price',
];

const notIncluded = [
  'Fuel, tolls and parking',
  'His bus or train ticket home — you book it',
  `His way home: ${late}`,
  `His meals — or ${priceText.mealAllowance} a day`,
  'His overnight stay on routes longer than a day',
];

const faqs = [
  {
    q: 'Can I travel with the driver and my car?',
    a: `Yes. Many one-way drops are families travelling in their own car. The driver drives you to the address you give, then comes home on his own by bus or train. The price is the same whether you ride along or send the car alone: ${perDriveDay}.`,
  },
  {
    q: 'Can a driver take my car to another city without me?',
    a: `Yes. A verified driver delivers your car to the address you give — tell us who will receive the car and the keys — and then comes home on his own. Call ${formatPhone(site.phone)} or book below.`,
  },
  {
    q: 'Is the driver’s way home included?',
    a: `It is charged by the hour, from the drop until he is home — waiting for his train included: ${late}. From your start date and time the estimate works out when he drops the car, the first train home he can catch that day and when he is home (Raipur → Nagpur: about 6 hours; Raipur → Mumbai: about 23). The final bill uses the real times. You book his train or bus ticket.`,
  },
  {
    q: 'How many days will my drop take?',
    a: `About ${settings.outstation.kmPerDay} km — ${priceText.outstationHours} — of driving a day, resting at night. From Raipur, Nagpur, Jabalpur or Visakhapatnam is one day; Hyderabad, Kolkata, Mumbai or Delhi two; Bengaluru or Chennai three. Want it sooner? Ask for day and night driving (the same price). Want to stop on the way? Book extra days; each is charged in full.`,
  },
  {
    q: 'What else do I pay for?',
    a: `Fuel, tolls and parking, as on every DriveBuddy booking. You book the driver's bus or train ticket home. Please give him his meals, or ${priceText.mealAllowance} a day. On routes longer than a day, his overnight stay too.`,
  },
  {
    q: 'When do I pay, and how?',
    a: 'No payment online. We confirm the price with you on the call before the driver leaves; you pay the driver’s charges in cash, by UPI or bank transfer.',
  },
];

export default function OneWayDropPage() {
  return (
    <>
      <PageHero
        eyebrow="One-way drop"
        title="One-way drop to another city — you and your car, or just the car"
        lede={`A verified driver drives your car from Raipur, Bhilai, Durg or Bilaspur to any city, then comes home by bus or train. ${priceText.outstation} for each ${priceText.outstationHours} of driving; his way home ${late}.`}
        trail={trail}
        actions={
          <>
            <ButtonLink href="#price" size="lg">
              Check your price
            </ButtonLink>
            <ButtonAnchor href={telHref} variant="outline" size="lg">
              <PhoneIcon className="size-5" />
              Call {formatPhone(site.phone)}
            </ButtonAnchor>
          </>
        }
      />

      <Section id="price" eyebrow="Price checker" title="What will my drop cost?">
        <OneWayPriceChecker />
      </Section>

      <Section tone="subtle" id="options" eyebrow="Two ways" title="Ride along, or send the car">
        <div className="grid gap-5 lg:grid-cols-2">
          {options.map((o) => (
            <Card key={o.title}>
              <h3 className="font-display text-lg font-semibold">{o.title}</h3>
              <p className="text-fg-muted mt-2 text-[0.9375rem]">{o.body}</p>
              <ul className="mt-4 flex flex-col gap-2">
                {o.points.map((p) => (
                  <li key={p} className="flex gap-3 text-[0.9375rem]">
                    <CheckIcon className="text-success mt-0.5 size-5 shrink-0" />
                    <span className="text-fg-muted">{p}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </Section>

      <Section
        id="routes"
        eyebrow="Popular routes"
        title="One-way drops from Raipur"
        lede={`Leaving Raipur at ${DEFAULT_START_HOUR} AM, with the regular train or bus he can catch home. Another start time or Bhilai, Durg or Bilaspur: use the price checker above.`}
      >
        <div className="border-border overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-[0.9375rem]">
            <thead className="bg-bg-subtle text-fg-subtle text-xs tracking-wide uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Destination
                </th>
                <th scope="col" className="hidden px-4 py-3 font-semibold sm:table-cell">
                  Driving days
                </th>
                <th scope="col" className="hidden px-4 py-3 font-semibold sm:table-cell">
                  Driver’s way home
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">
                  Estimate
                </th>
              </tr>
            </thead>
            <tbody>
              {ROUTES.map((t) => (
                <tr key={t.dest?.id} className="border-border border-t">
                  <th scope="row" className="px-4 py-3 font-semibold">
                    {t.dest?.name}
                    <span className="text-fg-subtle block text-xs font-normal">
                      {kmText(t.km)}
                      {/* Phones: days and the way home under the name, the price stays in view. */}
                      <span className="sm:hidden">
                        {' · '}
                        {t.days} {t.days === 1 ? 'day' : 'days'} ·{' '}
                        {`+${t.returnHours} h home`}
                      </span>
                    </span>
                  </th>
                  <td className="tabular hidden px-4 py-3 sm:table-cell">{t.days}</td>
                  <td className="text-fg-muted hidden px-4 py-3 sm:table-cell">
                    {t.home ? <span className="block">{homeText(t.home)} (typical)</span> : null}
                    <span className="text-fg text-xs">
                      {`${t.returnHours} h from the drop · ${rupees(t.est?.returnCharge ?? 0)}`}
                    </span>
                  </td>
                  <td className="tabular px-4 py-3 text-right font-semibold whitespace-nowrap">
                    {t.est ? rupeeRange(t.est.from, t.est.to) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-fg-subtle mt-3 text-sm">
          The way home here is a typical time. Pick your date on the booking form and the estimate looks up the real
          trains home for that day. Fuel, tolls, parking and meals are extra; you book his ticket home. Exact price
          confirmed on the call.
        </p>
      </Section>

      <Section tone="subtle" id="how" eyebrow="How it works" title="From your door to theirs">
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

      <Section id="included" eyebrow="Clear boundaries" title="What the price covers">
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <h3 className="font-display text-lg font-semibold">Included</h3>
            <ul className="mt-5 flex flex-col gap-3">
              {included.map((item) => (
                <li key={item} className="flex gap-3 text-[0.9375rem]">
                  <CheckIcon className="text-success mt-0.5 size-5 shrink-0" />
                  <span className="text-fg-muted">{item}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h3 className="font-display text-lg font-semibold">Not included</h3>
            <ul className="mt-5 flex flex-col gap-3">
              {notIncluded.map((item) => (
                <li key={item} className="flex gap-3 text-[0.9375rem]">
                  <CloseIcon className="text-fg-subtle mt-0.5 size-5 shrink-0" />
                  <span className="text-fg-muted">{item}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>

      <Section tone="subtle" id="faq" eyebrow="Questions" title="Before you book a one-way drop">
        <Accordion items={faqs} name="one-way-faq" defaultOpenFirst />
      </Section>

      <ClosingCTA
        title="Need your car in another city?"
        lede="Check the price above, book in a minute, or call — we confirm everything with you before the driver leaves."
      />

      <JsonLd data={oneWayDropSchema(settings.prices.outstation)} />
      <JsonLd data={faqSchema(faqs)} />
      <JsonLd data={breadcrumbSchema(trail)} />
    </>
  );
}
