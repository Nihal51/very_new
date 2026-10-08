import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { JsonLd } from '@/components/JsonLd';
import { ClosingCTA } from '@/components/sections/ClosingCTA';
import { LocalBooking, PlaceLinks, ServiceLinks } from '@/components/sections/LocalBlocks';
import { PageHero } from '@/components/sections/PageHero';
import { PricingCards } from '@/components/sections/PricingCards';
import { Accordion } from '@/components/ui/Accordion';
import { ButtonAnchor, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Section } from '@/components/ui/Section';
import { BuildingIcon, PhoneIcon, RouteIcon } from '@/components/icons';
import { faqs } from '@/lib/content';
import { fitDescription, fitTitle, getPlace, nearbyPlaces, placePath, places, type Place } from '@/lib/local-seo';
import { breadcrumbSchema, faqSchema, placeServiceSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';
import { priceText } from '@/lib/settings';
import { formatPhone, site, telHref } from '@/lib/site';

export function generateStaticParams() {
  return places.map((p) => ({ place: p.slug }));
}

export const dynamicParams = false;

type Props = { params: Promise<{ place: string }> };

/** Everything a page says about its place, worked out once for the page and its metadata. */
function copy(p: Place) {
  const c = p.city.name;
  if (p.kind === 'town') {
    const t = p.town;
    return {
      title: fitTitle(
        `Driver in ${t.name} — Driver on Call for Your Car`,
        `Driver Service in ${t.name} — Hire a Driver`,
        `Driver in ${t.name}`,
      ),
      description: fitDescription(
        `Hire a driver in ${t.name}${t.alsoCalled ? ` (${t.alsoCalled})` : ''} to drive your own car — hourly, full day, night, monthly or outstation. Police-verified drivers from ${priceText.oneHour}.`,
        `Hire a verified driver in ${t.name} for your own car — hourly, full day, night or monthly, from ${priceText.oneHour}. Call or book online.`,
      ),
      eyebrow: `Near ${c} · about ${t.km} km`,
      lede: `Need a driver in ${t.name}? DriveBuddy sends a police-verified, sober driver to drive your own car — for an hour, a full day, the night, an outstation trip or every month. ${t.where}`,
      coverage: `Because the driver travels about ${t.km} km from ${c}, we give you the arrival time when we confirm the booking instead of a fixed promise. Book a little ahead for early-morning trips and it is rarely a wait.`,
      landmarks: t.landmarks,
      popular: t.popular,
      eta: `We confirm the arrival time on the call — the driver comes out from ${c}, about ${t.km} km away.`,
    };
  }
  return {
    title: fitTitle(
      `Driver in ${p.name}, ${c} — On Call 24/7`,
      `Driver in ${p.name}, ${c} — Hire Now`,
      `Driver in ${p.name}, ${c}`,
    ),
    description: fitDescription(
      `Hire a driver in ${p.name}, ${c} for your own car — hourly, full day, night or monthly. Police-verified, sober, usually there in 30 minutes, from ${priceText.oneHour}.`,
      `Hire a driver in ${p.name}, ${c} for your own car. Police-verified, usually there in 30 minutes, from ${priceText.oneHour}.`,
    ),
    eyebrow: `${c} · ${p.name}`,
    lede: `Need a driver in ${p.name}? DriveBuddy sends a police-verified, sober driver to your door in ${p.name}, ${c} to drive your own car — for an hour, a full day, the night or every month. Call it a driver on call, an acting driver or a personal driver: it is the same trusted person, at your gate in about 30 minutes.`,
    coverage: p.city.coverage,
    landmarks: p.city.landmarks,
    popular: p.city.popular,
    eta: `A driver usually reaches ${p.name} in about 30 minutes, often sooner — ${p.name} is inside our ${c} coverage.`,
  };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { place: slug } = await params;
  const p = getPlace(slug);
  if (!p) return {};
  const t = copy(p);
  return pageMeta({
    title: t.title,
    description: t.description,
    path: placePath(p),
    ogImageAlt: `${site.name} — verified drivers in ${p.label}`,
  });
}

export default async function PlacePage({ params }: Props) {
  const { place: slug } = await params;
  const p = getPlace(slug);
  if (!p) notFound();
  const t = copy(p);
  const c = p.city;

  const general = faqs.filter((f) =>
    ['drivers verified', 'provide the car', 'payment methods', 'available at night'].some((n) => f.q.includes(n)),
  );
  const localFaqs = [
    {
      q: `How do I hire a driver in ${p.label}?`,
      a: `Call ${formatPhone(site.phone)} or fill in the form on this page with your pickup in ${p.name}. We call you back within minutes, confirm the price and send a police-verified driver to drive your own car.`,
    },
    { q: `How soon can a driver reach ${p.name}?`, a: t.eta },
    {
      q: `What does a driver cost in ${p.name}?`,
      a: `The same as everywhere we work: ${priceText.oneHour} for one hour, ${priceText.threeHours} for three hours, ${priceText.fullDay} for a local full day and ${priceText.outstation} for an outstation trip. A monthly driver starts from ${priceText.basicFrom} a month. You provide the car and fuel.`,
    },
    ...general,
  ];

  const trail = [
    { name: 'Areas', path: '/driver-in/' },
    { name: p.label, path: placePath(p) },
  ];
  const nearby = nearbyPlaces(p);

  return (
    <>
      <PageHero
        eyebrow={t.eyebrow}
        title={`Driver in ${p.label}`}
        lede={t.lede}
        trail={trail}
        actions={
          <>
            <ButtonAnchor href={telHref} size="lg">
              <PhoneIcon className="size-5" />
              <span className="tabular">{formatPhone(site.phone)}</span>
            </ButtonAnchor>
            <ButtonLink href="#book" variant="outline" size="lg">
              Book a driver in {p.name}
            </ButtonLink>
          </>
        }
      />

      <Section
        id="services"
        eyebrow="What you can book"
        title={`Driver services in ${p.name}`}
        lede={`Every DriveBuddy service is available in ${p.name}. Pick one to see what it includes and what it costs.`}
      >
        {/* Towns link to the city pages of the pool that serves them — that is where the driver comes from. */}
        <ServiceLinks city={c} where={c.name} />
      </Section>

      <Section tone="subtle" id="coverage" eyebrow="Coverage" title={`How we reach ${p.name}`} lede={t.coverage}>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <div className="flex items-center gap-3">
              <span className="bg-accent-subtle text-accent-text flex size-10 items-center justify-center rounded-xl">
                <BuildingIcon className="size-5" />
              </span>
              <h3 className="font-display text-lg font-semibold">Places our drivers know well</h3>
            </div>
            <ul className="mt-5 flex flex-col gap-3">
              {t.landmarks.map((l) => (
                <li key={l} className="text-fg-muted flex gap-3 text-[0.9375rem]">
                  <span aria-hidden="true" className="bg-accent mt-2 size-1.5 shrink-0 rounded-full" />
                  {l}
                </li>
              ))}
            </ul>
            <p className="text-fg-subtle mt-5 text-sm">Booked most here: {t.popular.toLowerCase()}.</p>
          </Card>
          <Card>
            <div className="flex items-center gap-3">
              <span className="bg-accent-subtle text-accent-text flex size-10 items-center justify-center rounded-xl">
                <RouteIcon className="size-5" />
              </span>
              <h3 className="font-display text-lg font-semibold">Also nearby</h3>
            </div>
            <div className="mt-5">
              <PlaceLinks places={nearby} />
            </div>
            <p className="text-fg-subtle mt-5 text-sm">
              Everything in {c.name}:{' '}
              <Link href={`/cities/${c.slug}/`} className="text-accent-text font-semibold underline underline-offset-4">
                driver in {c.name}
              </Link>
              .
            </p>
          </Card>
        </div>
      </Section>

      <LocalBooking where={p.name} />

      <Section id="pricing" eyebrow="Pricing" title={`Driver charges in ${p.name}`}>
        <PricingCards compact />
      </Section>

      <Section tone="subtle" id="faq" eyebrow="Questions" title={`Hiring a driver in ${p.name}`}>
        <Accordion items={localFaqs} name="place-faq" defaultOpenFirst />
      </Section>

      <ClosingCTA
        title={`Need a driver in ${p.name}?`}
        lede={`Call us and we send a police-verified, sober driver to ${p.label} to drive your car — any hour, any day.`}
      />

      <JsonLd
        data={placeServiceSchema({
          path: placePath(p),
          name: `Driver service in ${p.label}`,
          description: t.description,
          place: p.name,
          city: c,
        })}
      />
      <JsonLd data={faqSchema(localFaqs)} />
      <JsonLd data={breadcrumbSchema(trail)} />
    </>
  );
}
