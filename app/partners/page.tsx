import type { Metadata } from 'next';

import { JsonLd } from '@/components/JsonLd';
import { ClosingCTA } from '@/components/sections/ClosingCTA';
import { PageHero } from '@/components/sections/PageHero';
import { Accordion } from '@/components/ui/Accordion';
import { ButtonAnchor } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Section } from '@/components/ui/Section';
import { Icon, PhoneIcon, WhatsappIcon } from '@/components/icons';
import { partnerFaqs, partnerSteps, partnerTypes, partnerWhatsapp } from '@/lib/partners';
import { breadcrumbSchema, faqSchema } from '@/lib/schema';
import { pageMeta } from '@/lib/seo';
import { priceText } from '@/lib/settings';
import { formatPhone, site, telHref, waHref } from '@/lib/site';

const trail = [{ name: 'Become a partner', path: '/partners/' }];

export const metadata: Metadata = pageMeta({
  title: 'Become a DriveBuddy Partner — Earn per Customer',
  description: `Car showrooms, hospitals, wedding planners, hotels and housing societies: send customers who need a driver and earn up to ${priceText.partnerMonthly} each. No fee to join.`,
  path: '/partners/',
});

export default function PartnersPage() {
  return (
    <>
      <PageHero
        eyebrow="Partner program"
        title="Partner with DriveBuddy"
        lede="You meet people who need a driver every day. Send them to us: your customers get a police-verified driver for their own car, and you get a reward once they have paid. No fee, nothing to sign, no targets."
        trail={trail}
        actions={
          <>
            <ButtonAnchor href={waHref(partnerWhatsapp)} target="_blank" rel="noopener noreferrer" size="lg">
              <WhatsappIcon className="size-5" />
              Become a partner
            </ButtonAnchor>
            <ButtonAnchor href={telHref} variant="outline" size="lg">
              <PhoneIcon className="size-5" />
              <span className="tabular">{formatPhone(site.phone)}</span>
            </ButtonAnchor>
          </>
        }
      />

      <Section
        id="who"
        eyebrow="Who can partner"
        title="What you and your customers get"
        lede="Five kinds of partners, each with an offer that fits how they work."
      >
        <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {partnerTypes.map((p) => (
            <li key={p.id} className="reveal">
              <Card className="flex h-full flex-col">
                <div className="flex items-center gap-3">
                  <span className="bg-accent-subtle text-accent-text flex size-10 shrink-0 items-center justify-center rounded-xl">
                    <Icon name={p.icon} className="size-5" />
                  </span>
                  <h3 className="font-display text-lg font-semibold">{p.title}</h3>
                </div>
                <p className="text-fg-subtle mt-3 text-sm">{p.who}</p>
                <p className="text-fg-muted mt-3 text-[0.9375rem]">{p.need}</p>
                {/* mt-auto pins the offer to the card's foot; pt-5 keeps a gap when the text above is long. */}
                <div className="mt-auto pt-5">
                  <dl className="border-border flex flex-col gap-3 border-t pt-4 text-[0.9375rem]">
                    <div>
                      <dt className="text-fg-subtle text-xs font-semibold tracking-wide uppercase">
                        Your customers get
                      </dt>
                      <dd className="mt-1">{p.customersGet}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-subtle text-xs font-semibold tracking-wide uppercase">You get</dt>
                      <dd className="mt-1 font-semibold">{p.partnerGets}</dd>
                    </div>
                  </dl>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      <Section tone="subtle" id="how" eyebrow="How it works" title="Three steps, no paperwork">
        <ol className="grid gap-5 md:grid-cols-3">
          {partnerSteps.map((step, i) => (
            <li key={step.title} className="reveal">
              <Card className="h-full">
                <span className="bg-accent text-ink font-display flex size-9 items-center justify-center rounded-full text-sm font-bold">
                  {i + 1}
                </span>
                <h3 className="font-display mt-4 text-lg font-semibold">{step.title}</h3>
                <p className="text-fg-muted mt-2 text-[0.9375rem]">{step.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="faq" eyebrow="Questions" title="Good to know">
        <Accordion items={partnerFaqs} name="partner-faq" defaultOpenFirst />
      </Section>

      <ClosingCTA
        title="Ready to partner with us?"
        lede="Send us a WhatsApp with your business name and area, or call. We call you back, and you can start sending customers straight away."
      />

      <JsonLd data={breadcrumbSchema(trail)} />
      <JsonLd data={faqSchema(partnerFaqs)} />
    </>
  );
}
