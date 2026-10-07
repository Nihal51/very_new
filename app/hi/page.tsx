import type { Metadata } from 'next';

import {
  HindiActions,
  HindiCities,
  HindiClosing,
  HindiPillars,
  HindiPrices,
  HindiServices,
  LanguageLink,
} from '@/components/hi/HindiBlocks';
import { JsonLd } from '@/components/JsonLd';
import { Accordion } from '@/components/ui/Accordion';
import { Badge } from '@/components/ui/Badge';
import { Container, Section } from '@/components/ui/Section';
import { CertificateIcon, ClockIcon, NoAlcoholIcon, ShieldIcon } from '@/components/icons';
import { cityListHi, faqsHi } from '@/lib/content-hi';
import { faqSchema, hindiPageSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';
import { priceText } from '@/lib/settings';
import { site } from '@/lib/site';

/* The Hindi home page targets the Hindi form of the state-level query —
   "छत्तीसगढ़ में ड्राइवर सेवा" — the way the English home page targets
   "driver service in Chhattisgarh". The city queries belong to /hi/cities/<city>/. */
const TITLE = 'छत्तीसगढ़ में ड्राइवर सेवा — 24/7, 30 मिनट में';
const DESCRIPTION = `${cityListHi} में आपकी अपनी कार के लिए पुलिस-वेरिफ़ाइड, नशामुक्त ड्राइवर। 24 घंटे, लगभग 30 मिनट में, ${priceText.startingFrom} से।`;

export const metadata: Metadata = pageMeta({
  title: TITLE,
  description: DESCRIPTION,
  path: '/hi/',
  languages: { en: '/', hi: '/hi/' },
  locale: 'hi_IN',
  ogImageAlt: `${site.name} — छत्तीसगढ़ में वेरिफ़ाइड ड्राइवर`,
});

const chips = [
  { icon: ShieldIcon, label: 'पुलिस वेरिफ़ाइड' },
  { icon: NoAlcoholIcon, label: 'शराब पर पूरी रोक' },
  { icon: CertificateIcon, label: 'प्रशिक्षित ड्राइवर' },
  { icon: ClockIcon, label: 'लगभग 30 मिनट में' },
];

export default function HindiHomePage() {
  return (
    /* lang on the wrapper, not <html>: the header and footer stay English, and
       screen readers switch voice for exactly the part that is Hindi. */
    <div lang="hi">
      <section aria-labelledby="hi-hero-heading" className="bg-ink text-fg-inverse">
        <Container className="py-16 sm:py-20 lg:py-24">
          <div className="max-w-3xl">
            <Badge tone="onDark">
              <span className="bg-success size-1.5 rounded-full" aria-hidden="true" />
              अभी उपलब्ध · 24/7
            </Badge>

            <h1 id="hi-hero-heading" className="mt-6">
              <span className="text-display-xl block">
                आपकी कार। <span className="text-accent">हमारा ड्राइवर।</span>
              </span>
              <span className="text-lede mt-4 block font-semibold text-white/85">
                छत्तीसगढ़ में ड्राइवर सेवा — {cityListHi}
              </span>
            </h1>

            <p className="text-lede mt-5 max-w-xl text-white/70">
              पुलिस-वेरिफ़ाइड, ब्रेथ-टेस्टेड और प्रशिक्षित ड्राइवर, 24 घंटे — आमतौर पर लगभग 30
              मिनट में आपके दरवाज़े पर। कार आपकी रहती है, ड्राइविंग हम संभालते हैं।
            </p>

            <div className="mt-9">
              <HindiActions onDark />
            </div>

            <ul className="mt-10 grid gap-x-8 gap-y-4 sm:grid-cols-2">
              {chips.map((chip) => (
                <li key={chip.label} className="flex items-center gap-2.5 text-sm text-white/80">
                  <chip.icon className="text-accent size-5 shrink-0" />
                  {chip.label}
                </li>
              ))}
            </ul>

            <LanguageLink href="/" lang="en" label="Read in English" className="mt-8 text-white/70" />
          </div>
        </Container>
      </section>

      <Section
        id="services"
        eyebrow="हमारी सेवाएँ"
        title="हर तरह की यात्रा के लिए ड्राइवर"
        lede="घंटे के हिसाब से, पूरे दिन या पूरे महीने — हर बुकिंग में एक जैसा भरोसेमंद ड्राइवर।"
      >
        <HindiServices />
      </Section>

      <Section
        tone="subtle"
        id="pricing"
        eyebrow="कीमतें"
        title="ड्राइवर का चार्ज"
        lede="बुकिंग के समय तय — सिर्फ़ ड्राइवर का चार्ज, कोई सर्ज या छुपा ख़र्च नहीं। गाड़ी और ईंधन आपका।"
      >
        <HindiPrices />
      </Section>

      <Section
        id="trust"
        eyebrow="भरोसा"
        title="आपकी कार चलाने से पहले चार जाँच"
        lede="बुकिंग की कीमत कुछ भी हो, ड्राइवर का स्तर वही रहता है।"
      >
        <HindiPillars />
      </Section>

      <Section
        tone="subtle"
        id="cities"
        eyebrow="शहर"
        title="हम कहाँ-कहाँ हैं"
        lede="चार शहर, हर शहर में वेरिफ़ाइड ड्राइवर, दिन-रात।"
      >
        <HindiCities />
      </Section>

      <Section id="faq" eyebrow="सवाल-जवाब" title="अक्सर पूछे जाने वाले सवाल">
        <div className="max-w-3xl">
          <Accordion items={faqsHi} name="hi-faq" defaultOpenFirst />
        </div>
      </Section>

      <HindiClosing
        title="अभी ड्राइवर चाहिए?"
        lede={`कॉल करें — ${cityListHi} में कहीं भी, पुलिस-वेरिफ़ाइड और नशामुक्त ड्राइवर लगभग 30 मिनट में पहुँचता है।`}
      />

      <JsonLd data={hindiPageSchema({ path: '/hi/', name: TITLE, description: DESCRIPTION })} />
      <JsonLd data={faqSchema(faqsHi)} />
    </div>
  );
}
