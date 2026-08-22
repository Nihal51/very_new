import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/Button';
import { CheckIcon } from '@/components/icons';
import { cn } from '@/lib/cn';
import { extraRates, plans } from '@/lib/content';

/**
 * Pricing cards.
 *
 * On phones this is a horizontal snap rail rather than a four-up grid squashed
 * into one column of stubs — the cards keep a readable width and swipe.
 */
export function PricingCards({ compact = false }: { compact?: boolean }) {
  return (
    <div>
      <div
        className={cn(
          // Mobile: full-bleed snap rail. sm and up: a real grid.
          'snap-rail -mx-5 gap-4 px-5 pb-3',
          'sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0',
          'lg:grid-cols-4',
        )}
        role="list"
      >
        {plans.map((plan) => (
          <div key={plan.id} role="listitem" className="w-[16.5rem] sm:w-auto">
            <Card
              tone={plan.featured ? 'accent' : 'default'}
              className={cn(
                'flex h-full flex-col',
                plan.featured && 'border-accent shadow-md',
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <p
                  className={cn(
                    'text-eyebrow uppercase',
                    plan.featured ? 'text-accent-text' : 'text-fg-subtle',
                  )}
                >
                  {plan.eyebrow}
                </p>
                {plan.featured && <Badge tone="accent">Best value</Badge>}
              </div>

              <h3 className="font-display mt-3 text-lg font-semibold">{plan.name}</h3>

              <p className="mt-4 flex items-baseline gap-1.5">
                <span className="tabular font-display text-display-sm">{plan.price}</span>
                <span className="text-fg-subtle text-sm">{plan.unit}</span>
              </p>

              <p className="text-fg-muted mt-3 text-sm">{plan.blurb}</p>

              <ul className="mt-5 flex flex-col gap-2.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2.5 text-sm">
                    <CheckIcon className="text-success mt-0.5 size-4 shrink-0" />
                    <span className="text-fg-muted">{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6 pt-1">
                <ButtonLink
                  href="/book/"
                  variant={plan.featured ? 'primary' : 'outline'}
                  fullWidth
                >
                  Book this
                </ButtonLink>
              </div>
            </Card>
          </div>
        ))}
      </div>

      {!compact && (
        <div className="border-border bg-bg-subtle mt-6 grid gap-4 rounded-2xl border p-5 sm:grid-cols-2 sm:p-6">
          {extraRates.map((rate) => (
            <div key={rate.label} className="flex items-baseline justify-between gap-4">
              <div>
                <p className="font-semibold">{rate.label}</p>
                <p className="text-fg-subtle mt-0.5 text-sm">{rate.detail}</p>
              </div>
              <p className="tabular font-display text-lg font-bold whitespace-nowrap">
                {rate.price}
              </p>
            </div>
          ))}
        </div>
      )}

      <p className="text-fg-subtle mt-5 text-sm">
        Rates are for the driver only — you provide the vehicle and fuel. Prices are fixed at
        booking: no surge pricing, no hidden charges. Cash, UPI and bank transfer accepted.
      </p>
    </div>
  );
}
