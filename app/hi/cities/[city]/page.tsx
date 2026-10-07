import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
  HindiActions,
  HindiClosing,
  HindiPrices,
  HindiServices,
  LanguageLink,
} from '@/components/hi/HindiBlocks';
import { JsonLd } from '@/components/JsonLd';
import { PageHero } from '@/components/sections/PageHero';
import { Accordion } from '@/components/ui/Accordion';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Section } from '@/components/ui/Section';
import { BuildingIcon, ClockIcon, RouteIcon } from '@/components/icons';
import { cities, getCity } from '@/lib/content';
import { cityFaqsHi, cityHi } from '@/lib/content-hi';
import { breadcrumbSchema, citySchema, faqSchema, hindiPageSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';
import { priceText } from '@/lib/settings';
import { site } from '@/lib/site';

export function generateStaticParams() {
  return cities.map((city) => ({ city: city.slug }));
}

export const dynamicParams = false;

type Props = { params: Promise<{ city: string }> };

const HOME = { name: 'होम', path: '/hi/' };

/* "रायपुर में ड्राइवर चाहिए" is how the query is actually typed and spoken, so the
   title asks it back. The description carries the city's own typical wait. */
const titleFor = (name: string) => `${name} में ड्राइवर चाहिए? 24/7, 30 मिनट में`;
const descriptionFor = (name: string, wait: string) =>
  `${name} में अपनी कार के लिए पुलिस-वेरिफ़ाइड ड्राइवर — घंटे, पूरे दिन या रात के लिए। आमतौर पर ${wait} में, 24/7, ${priceText.startingFrom} से।`;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city: slug } = await params;
  const city = getCity(slug);
  if (!city) return {};
  const hi = cityHi(city.slug);

  return pageMeta({
    title: titleFor(hi.name),
    description: descriptionFor(hi.name, hi.wait),
    path: `/hi/cities/${city.slug}/`,
    languages: { en: `/cities/${city.slug}/`, hi: `/hi/cities/${city.slug}/` },
    locale: 'hi_IN',
    ogImageAlt: `${site.name} — ${hi.name} में वेरिफ़ाइड ड्राइवर`,
  });
}

export default async function HindiCityPage({ params }: Props) {
  const { city: slug } = await params;
  const city = getCity(slug);
  if (!city) notFound();
  const hi = cityHi(city.slug);
  const path = `/hi/cities/${city.slug}/`;
  const trail = [{ name: `${hi.name} में ड्राइवर`, path }];

  return (
    <div lang="hi">
      <PageHero
        eyebrow={`${hi.name} · ${hi.badge}`}
        title={`${hi.name} में ड्राइवर ऑन कॉल`}
        lede={hi.intro}
        trail={trail}
        home={HOME}
        actions={<HindiActions cityName={hi.name} />}
      >
        <LanguageLink
          href={`/cities/${city.slug}/`}
          lang="en"
          label={`Drivers in ${city.name} — English`}
          className="text-fg-muted mt-5"
        />
      </PageHero>

      <Section id="coverage" eyebrow="कवरेज" title={`${hi.name} में हम कैसे पहुँचते हैं`} lede={hi.coverage}>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <div className="flex items-center gap-3">
              <span className="bg-accent-subtle text-accent-text flex size-10 items-center justify-center rounded-xl">
                <RouteIcon className="size-5" />
              </span>
              <h3 className="font-display text-lg font-semibold">इलाक़े जहाँ हम जाते हैं</h3>
            </div>
            <ul className="mt-5 flex flex-wrap gap-2">
              {hi.areas.map((area) => (
                <li key={area}>
                  <Badge tone="outline">{area}</Badge>
                </li>
              ))}
            </ul>
            <p className="text-fg-subtle mt-5 text-sm">
              आपका इलाक़ा सूची में नहीं है? फिर भी आते हैं — ये बस वे इलाक़े हैं जहाँ से सबसे
              ज़्यादा बुकिंग आती है।
            </p>
          </Card>

          <Card>
            <div className="flex items-center gap-3">
              <span className="bg-accent-subtle text-accent-text flex size-10 items-center justify-center rounded-xl">
                <BuildingIcon className="size-5" />
              </span>
              <h3 className="font-display text-lg font-semibold">जगहें जो हमारे ड्राइवर अच्छी तरह जानते हैं</h3>
            </div>
            <ul className="mt-5 flex flex-col gap-3">
              {hi.landmarks.map((landmark) => (
                <li key={landmark} className="text-fg-muted flex gap-3 text-[0.9375rem]">
                  <span aria-hidden="true" className="bg-accent mt-2 size-1.5 shrink-0 rounded-full" />
                  {landmark}
                </li>
              ))}
            </ul>
            <p className="text-fg-subtle mt-5 flex items-start gap-2 text-sm">
              <ClockIcon className="mt-0.5 size-4 shrink-0" />
              {hi.name} में सबसे ज़्यादा बुकिंग: {hi.popular}।
            </p>
          </Card>
        </div>
      </Section>

      <Section
        tone="subtle"
        id="services"
        eyebrow="सेवाएँ"
        title={`${hi.name} में हर सेवा उपलब्ध`}
        lede="वही वेरिफ़ाइड ड्राइवर, वही रेट — जैसे बाक़ी शहरों में।"
      >
        <HindiServices />
      </Section>

      <Section id="pricing" eyebrow="कीमतें" title={`${hi.name} में ड्राइवर का चार्ज`}>
        <HindiPrices />
      </Section>

      <Section tone="subtle" id="faq" eyebrow="सवाल-जवाब" title={`${hi.name} में ड्राइवर बुक करना`}>
        <div className="max-w-3xl">
          <Accordion items={cityFaqsHi} name="hi-city-faq" defaultOpenFirst />
        </div>
      </Section>

      <HindiClosing
        title={`${hi.name} में अभी ड्राइवर चाहिए?`}
        lede={`कॉल करें — ${hi.name} में कहीं भी, पुलिस-वेरिफ़ाइड और नशामुक्त ड्राइवर लगभग 30 मिनट में पहुँचता है।`}
        cityName={hi.name}
      />

      <JsonLd
        data={hindiPageSchema({
          path,
          name: titleFor(hi.name),
          description: descriptionFor(hi.name, hi.wait),
        })}
      />
      <JsonLd data={citySchema(city.slug)} />
      <JsonLd data={faqSchema(cityFaqsHi)} />
      <JsonLd data={breadcrumbSchema(trail, HOME)} />
    </div>
  );
}
