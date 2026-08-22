import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { ArrowRightIcon, MapPinIcon } from '@/components/icons';
import { cities } from '@/lib/content';

/** City cards linking to the per-city landing pages. */
export function CitiesGrid() {
  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {cities.map((city) => (
        <li key={city.slug} className="reveal">
          <Card interactive className="h-full">
            <div className="flex items-start justify-between gap-3">
              <span className="bg-accent-subtle text-accent-text flex size-11 items-center justify-center rounded-xl">
                <MapPinIcon className="size-5" />
              </span>
              <Badge tone={city.isHq ? 'accent' : 'neutral'}>{city.badge}</Badge>
            </div>

            <h3 className="font-display mt-5 text-lg font-semibold">
              {/* Stretched link: the whole card is the target, one tab stop. */}
              <Link href={`/cities/${city.slug}/`} className="rounded-lg">
                <span className="absolute inset-0" aria-hidden="true" />
                Drivers in {city.name}
              </Link>
            </h3>

            <p className="text-fg-muted mt-2 text-sm">{city.short}</p>

            <span className="text-accent-text mt-4 inline-flex items-center gap-1.5 text-sm font-semibold">
              View coverage
              <ArrowRightIcon className="size-4" />
            </span>
          </Card>
        </li>
      ))}
    </ul>
  );
}
