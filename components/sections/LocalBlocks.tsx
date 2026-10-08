import Link from 'next/link';

import { BookingForm } from '@/components/BookingForm';
import { ArrowRightIcon, Icon } from '@/components/icons';
import { Container } from '@/components/ui/Section';
import { services, type City } from '@/lib/content';
import { cityServicePath, placePath, type Place } from '@/lib/local-seo';
import { formatPhone, site, telHref } from '@/lib/site';

/** The booking band used on every local page: the visitor never needs a second click. */
export function LocalBooking({ where, note }: { where: string; note?: string }) {
  return (
    <section
      id="book"
      aria-labelledby="local-book-heading"
      className="border-border bg-bg-subtle scroll-mt-20 border-y py-16 sm:py-20"
    >
      <Container>
        <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:items-start lg:gap-14">
          <div className="reveal lg:sticky lg:top-24">
            <p className="text-eyebrow text-accent-text uppercase">Book now</p>
            <h2 id="local-book-heading" className="text-display-md mt-3">
              Get a driver in {where}
            </h2>
            <p className="text-lede text-fg-muted mt-4">
              {note ?? 'Send your pickup details and we call you back within minutes.'} For anything urgent,
              call{' '}
              <a href={telHref} className="text-accent-text tabular font-semibold underline underline-offset-4">
                {formatPhone(site.phone)}
              </a>
              .
            </p>
          </div>
          <BookingForm
            id="local-booking-form"
            headingLevel="h3"
            title={`Book a driver in ${where}`}
            lede="We only ask for what dispatch needs to reach you."
          />
        </div>
      </Container>
    </section>
  );
}

/** Every service, each linking to its page for this city. */
export function ServiceLinks({ city, where, skip }: { city: City; where: string; skip?: string }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {services
        .filter((s) => s.slug !== skip)
        .map((s) => (
          <li key={s.slug}>
            <Link
              href={cityServicePath(city, s)}
              className="border-border bg-bg hover:border-accent group flex h-full flex-col gap-2 rounded-2xl border p-5 transition-colors"
            >
              <span className="flex items-center gap-3">
                <span className="bg-accent-subtle text-accent-text flex size-9 shrink-0 items-center justify-center rounded-xl">
                  <Icon name={s.icon} className="size-5" />
                </span>
                <span className="font-display font-semibold">
                  {s.title} in {where}
                </span>
              </span>
              <span className="text-fg-muted text-[0.9375rem]">{s.short}</span>
              <span className="text-accent-text mt-auto inline-flex items-center gap-1 text-sm font-semibold">
                See details <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          </li>
        ))}
    </ul>
  );
}

/** A wrap of place links — "Driver in Telibandha", "Driver in Pandri"… */
export function PlaceLinks({ places, prefix = 'Driver in' }: { places: Place[]; prefix?: string }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {places.map((p) => (
        <li key={p.slug}>
          <Link
            href={placePath(p)}
            className="border-border-strong text-fg-muted hover:border-accent hover:text-fg inline-flex rounded-full border px-3 py-1.5 text-sm font-medium transition-colors"
          >
            {prefix ? `${prefix} ${p.label}` : p.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
