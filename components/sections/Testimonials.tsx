import { Card } from '@/components/ui/Card';
import { StarFilledIcon } from '@/components/icons';
import { testimonials } from '@/lib/content';

function Stars() {
  return (
    <div className="text-accent flex gap-0.5" role="img" aria-label="Rated 5 out of 5">
      {[0, 1, 2, 3, 4].map((i) => (
        <StarFilledIcon key={i} className="size-4" />
      ))}
    </div>
  );
}

export function Testimonials() {
  return (
    <ul className="grid gap-5 lg:grid-cols-3">
      {testimonials.map((t) => (
        <li key={t.name} className="reveal">
          <Card as="figure" className="flex h-full flex-col">
            <Stars />
            <blockquote className="mt-4 flex-1">
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
