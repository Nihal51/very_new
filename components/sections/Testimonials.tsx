import { Card } from '@/components/ui/Card';
import { ButtonAnchor } from '@/components/ui/Button';
import { MapPinIcon } from '@/components/icons';
import { cn } from '@/lib/cn';
import { testimonials, type Testimonial } from '@/lib/content';
import { googleProfileHref, googleReviewHref } from '@/lib/site';

/* No star row on these cards. Each one used to open with five filled stars and
   `aria-label="Rated 5 out of 5"` — a rating claim that rendered as wordless
   decoration to a sighted visitor while asserting a perfect score to every screen
   reader and crawler. The owner has confirmed the site's review figures were not
   real, so a fabricated 5-out-of-5 attached to a named individual is the same
   claim in a quieter voice. scripts/audit.mjs now scans attribute values for
   exactly this, because stripping tags cannot see it.

   What carries the section instead: the customers' own words, with the line that
   matters most set in bold (an exact phrase from the quote — lib/content.ts
   refuses anything else), and a way for the next customer to add theirs on
   Google, which is where stars are allowed to come from. */

/** Opening quotation mark — decorative, so hidden from screen readers. */
function QuoteMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 30" aria-hidden="true" focusable="false" className={className} fill="currentColor">
      <path d="M0 30V18C0 8.6 5.3 2.4 15.8 0l1.6 3.6C11.6 5.2 8.8 8.6 8.6 13.2H16V30H0Zm22 0V18c0-9.4 5.3-15.6 15.8-18l1.6 3.6c-5.8 1.6-8.6 5-8.8 9.6H38V30H22Z" />
    </svg>
  );
}

/** The quote with its highlight set in bold — same words, same order. */
function QuoteText({ t }: { t: Testimonial }) {
  const at = t.quote.indexOf(t.highlight);
  return (
    <>
      {t.quote.slice(0, at)}
      <strong className="text-fg font-semibold">{t.highlight}</strong>
      {t.quote.slice(at + t.highlight.length)}
    </>
  );
}

export function Testimonials() {
  return (
    <div>
      <ul
        className={cn(
          // Phones and tablets: a swipeable rail with the next card peeking in, so
          // three quotes don't become a long scroll. Desktop: three across.
          'snap-rail -mx-5 gap-4 px-5 pb-3 sm:-mx-8 sm:scroll-px-8 sm:px-8',
          'lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-5 lg:overflow-visible lg:px-0 lg:pb-0',
        )}
      >
        {testimonials.map((t) => (
          <li key={t.name} className="w-[18.5rem] sm:w-[21rem] lg:w-auto">
            <Card as="figure" className="flex h-full flex-col">
              <QuoteMark className="text-accent h-6 w-8" />
              <blockquote className="mt-5 flex-1">
                <p className="text-fg-muted text-[0.9375rem] leading-relaxed">
                  <QuoteText t={t} />
                </p>
              </blockquote>
              <figcaption className="border-border mt-6 flex items-center gap-3 border-t pt-5">
                <span
                  aria-hidden="true"
                  className="bg-accent-subtle text-accent-text font-display flex size-11 shrink-0 items-center justify-center rounded-full text-lg font-bold"
                >
                  {t.initial}
                </span>
                <span>
                  <span className="block font-semibold">{t.name}</span>
                  <span className="text-fg-subtle flex items-center gap-1 text-sm">
                    <MapPinIcon className="size-3.5" />
                    {t.city}
                  </span>
                </span>
              </figcaption>
            </Card>
          </li>
        ))}
      </ul>

      <div className="border-border bg-bg-subtle mt-8 flex flex-col gap-5 rounded-2xl border p-6 sm:p-7 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-xl">
          <p className="font-display text-lg font-semibold">Booked a DriveBuddy driver?</p>
          <p className="text-fg-muted mt-1 text-[0.9375rem]">
            Share your experience on Google. It helps other families find a driver they can trust.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row lg:shrink-0">
          <ButtonAnchor href={googleReviewHref} target="_blank" rel="noopener noreferrer">
            Write a review on Google
          </ButtonAnchor>
          <ButtonAnchor href={googleProfileHref} target="_blank" rel="noopener noreferrer" variant="outline">
            See us on Google Maps
          </ButtonAnchor>
        </div>
      </div>
    </div>
  );
}
