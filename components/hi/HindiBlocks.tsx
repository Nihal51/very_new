import Link from 'next/link';

import { Card } from '@/components/ui/Card';
import { ButtonAnchor, ButtonLink } from '@/components/ui/Button';
import { Container } from '@/components/ui/Section';
import { ArrowRightIcon, CheckIcon, Icon, PhoneIcon, WhatsappIcon } from '@/components/icons';
import { cities, pillars, services } from '@/lib/content';
import { cityHi, pillarsHi, pricesHi, serviceHi, waMessageHi } from '@/lib/content-hi';
import { formatPhone, site, telHref, waHref } from '@/lib/site';

/**
 * Building blocks for the Hindi pages. Same design system as the English site —
 * only the words change — so a visitor switching languages lands on a page that
 * looks like the one they left.
 */

/** "Read this page in English / हिंदी में पढ़ें" — a plain link, crawlable both ways. */
export function LanguageLink({
  href,
  lang,
  label,
  className = '',
}: {
  href: string;
  lang: 'en' | 'hi';
  label: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      hrefLang={lang === 'hi' ? 'hi-IN' : 'en-IN'}
      lang={lang}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-semibold underline underline-offset-4 ${className}`}
    >
      {label}
      <ArrowRightIcon className="size-4" />
    </Link>
  );
}

/** Call / WhatsApp / online form, in Hindi. */
export function HindiActions({ cityName, onDark = false }: { cityName?: string; onDark?: boolean }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <ButtonAnchor href={telHref} size="lg">
        <PhoneIcon className="size-5" />
        <span className="tabular">{formatPhone(site.phone)}</span>
      </ButtonAnchor>
      <ButtonAnchor
        href={waHref(waMessageHi(cityName))}
        target="_blank"
        rel="noopener noreferrer"
        variant={onDark ? 'onDark' : 'outline'}
        size="lg"
      >
        <WhatsappIcon className="size-5" />
        WhatsApp पर बुक करें
      </ButtonAnchor>
      <ButtonLink href="/book/" variant={onDark ? 'onDark' : 'outline'} size="lg">
        ऑनलाइन बुक करें
      </ButtonLink>
    </div>
  );
}

export function HindiServices() {
  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {services.map((s) => (
        <li key={s.slug}>
          <Card className="flex h-full flex-col">
            <span className="bg-accent-subtle text-accent-text flex size-11 items-center justify-center rounded-xl">
              <Icon name={s.icon} className="size-5.5" />
            </span>
            <h3 className="font-display mt-4 text-lg font-semibold">{serviceHi(s.slug).title}</h3>
            <p className="text-fg-muted mt-2 text-[0.9375rem]">{serviceHi(s.slug).short}</p>
            <Link
              href={`/services/${s.slug}/`}
              hrefLang="en-IN"
              className="text-accent-text mt-auto inline-flex min-h-11 items-end gap-1.5 rounded-lg pt-4 text-sm font-semibold"
            >
              पूरी जानकारी (English)
              <ArrowRightIcon className="size-4" />
            </Link>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function HindiPrices() {
  return (
    <div className="border-border bg-bg divide-border max-w-3xl divide-y rounded-2xl border">
      {pricesHi.map((row) => (
        <div key={row.name} className="flex items-baseline justify-between gap-4 px-5 py-4">
          <span className="text-[0.9375rem] font-semibold">{row.name}</span>
          <span className="text-right">
            <span className="tabular font-display text-lg font-bold">{row.price}</span>
            <span className="text-fg-subtle block text-xs">{row.unit}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function HindiPillars() {
  return (
    <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {pillarsHi.map((p, i) => (
        <li key={p.title}>
          <Card className="h-full">
            <span className="bg-accent-subtle text-accent-text flex size-11 items-center justify-center rounded-xl">
              <Icon name={pillars[i]?.icon ?? 'shield'} className="size-5.5" />
            </span>
            <h3 className="font-display mt-4 text-lg font-semibold">{p.title}</h3>
            <p className="text-fg-muted mt-2 text-[0.9375rem]">{p.body}</p>
          </Card>
        </li>
      ))}
    </ol>
  );
}

export function HindiCities() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cities.map((c) => (
        <li key={c.slug}>
          <Link
            href={`/hi/cities/${c.slug}/`}
            className="border-border bg-bg hover:border-accent-border flex min-h-11 items-center justify-between gap-3 rounded-2xl border px-5 py-4 transition-colors"
          >
            <span>
              <span className="font-display block text-lg font-semibold">
                {cityHi(c.slug).name} में ड्राइवर
              </span>
              <span className="text-fg-subtle text-sm">{cityHi(c.slug).badge}</span>
            </span>
            <ArrowRightIcon className="text-accent-text size-5 shrink-0" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function HindiChecklist({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-[0.9375rem]">
          <CheckIcon className="text-success mt-0.5 size-5 shrink-0" />
          <span className="text-fg-muted">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function HindiClosing({ title, lede, cityName }: { title: string; lede: string; cityName?: string }) {
  return (
    <section aria-labelledby="hi-closing-heading" className="bg-ink text-fg-inverse">
      <Container className="py-16 sm:py-20 lg:py-24">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <h2 id="hi-closing-heading" className="text-display-md">
            {title}
          </h2>
          <p className="text-lede mt-4 text-white/70">{lede}</p>
          <div className="mt-9">
            <HindiActions cityName={cityName} onDark />
          </div>
          <p className="mt-6 text-sm text-white/50">
            24 घंटे उपलब्ध · दूसरा नंबर <span className="tabular">{formatPhone(site.phoneAlt)}</span>
          </p>
        </div>
      </Container>
    </section>
  );
}
