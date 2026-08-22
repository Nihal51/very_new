import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { ArrowRightIcon, CheckIcon, Icon } from '@/components/icons';
import { services } from '@/lib/content';

/**
 * Service cards. `detailed` adds the full body copy and the includes list, used
 * on /services; the home page shows the short version.
 */
export function ServicesGrid({ detailed = false }: { detailed?: boolean }) {
  return (
    <div className={detailed ? 'grid gap-5 lg:grid-cols-2' : 'grid gap-5 sm:grid-cols-2'}>
      {services.map((service) => (
        <Card
          key={service.slug}
          id={detailed ? service.slug : undefined}
          className={detailed ? 'scroll-mt-28' : 'flex h-full flex-col'}
        >
          <div className="reveal">
            <div className="flex items-start justify-between gap-4">
              <span className="bg-accent-subtle text-accent-text flex size-12 shrink-0 items-center justify-center rounded-xl">
                <Icon name={service.icon} className="size-6" />
              </span>
              {service.badge && <Badge tone="accent">{service.badge}</Badge>}
            </div>

            <h3 className="font-display mt-5 text-xl font-semibold">{service.title}</h3>
            <p className="text-fg-muted mt-2 text-[0.9375rem]">
              {detailed ? service.body : service.short}
            </p>

            {detailed && (
              <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
                {service.includes.map((item) => (
                  <li key={item} className="flex gap-2.5 text-sm">
                    <CheckIcon className="text-success mt-0.5 size-4 shrink-0" />
                    <span className="text-fg-muted">{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!detailed && (
            <Link
              href={`/services/#${service.slug}`}
              className="text-accent-text ease-out-quart mt-auto inline-flex min-h-11 items-end gap-1.5 rounded-lg pt-5 text-sm font-semibold transition-[gap] duration-150 hover:gap-2.5"
            >
              What&apos;s included
              <ArrowRightIcon className="size-4" />
            </Link>
          )}
        </Card>
      ))}
    </div>
  );
}
