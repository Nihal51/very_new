import { Card } from '@/components/ui/Card';
import { testimonials } from '@/lib/content';

/* No star row on these cards. Each one used to open with five filled stars and
   `aria-label="Rated 5 out of 5"` — a rating claim that rendered as wordless
   decoration to a sighted visitor while asserting a perfect score to every screen
   reader and crawler. The owner has confirmed the site's review figures were not
   real, so a fabricated 5-out-of-5 attached to a named individual is the same
   claim in a quieter voice. scripts/audit.mjs now scans attribute values for
   exactly this, because stripping tags cannot see it. */

export function Testimonials() {
  return (
    <ul className="grid gap-5 lg:grid-cols-3">
      {testimonials.map((t) => (
        <li key={t.name} className="reveal">
          <Card as="figure" className="flex h-full flex-col">
            <blockquote className="flex-1">
              <p className="text-[0.9375rem]">&ldquo;{t.quote}&rdquo;</p>
            </blockquote>
            <figcaption className="border-border mt-6 flex items-center gap-3 border-t pt-5">
              <span
                aria-hidden="true"
                className="bg-surface text-fg-muted font-display flex size-10 items-center justify-center rounded-full font-bold"
              >
                {t.initial}
              </span>
              <span>
                <span className="block text-sm font-semibold">{t.name}</span>
                <span className="text-fg-subtle block text-sm">{t.city}</span>
              </span>
            </figcaption>
          </Card>
        </li>
      ))}
    </ul>
  );
}
