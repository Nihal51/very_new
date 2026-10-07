import { Badge } from '@/components/ui/Badge';
import { ButtonAnchor } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CheckIcon, WhatsappIcon } from '@/components/icons';
import { monthlyComparison, monthlyPlans, monthlyTerms } from '@/lib/content';
import { cn } from '@/lib/cn';
import { waHref } from '@/lib/site';

/**
 * Basic vs Premium for the monthly driver: two plan cards, then the row-by-row
 * comparison. Each "Choose" button opens WhatsApp with the plan named and blanks
 * for what dispatch needs (city, timing, weekly off, start date), so the first
 * message is already a booking.
 */
export function MonthlyPlans() {
  return (
    <>
      <div className="grid gap-5 md:grid-cols-2">
        {monthlyPlans.map((plan) => (
          <Card
            key={plan.id}
            tone={plan.recommended ? 'accent' : 'default'}
            className="flex h-full flex-col"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display text-xl font-semibold">{plan.name}</h3>
              {plan.recommended && <Badge tone="accent">Recommended</Badge>}
            </div>

            <p className="mt-4 flex flex-wrap items-baseline gap-x-2">
              <span className="tabular font-display text-3xl font-bold">{plan.price}</span>
              <span className="text-fg-subtle text-sm">a month</span>
            </p>
            <p className={cn('mt-1 text-sm', plan.joiningFee ? 'text-fg-muted' : 'text-success font-semibold')}>
              {plan.joiningFee ?? 'No joining fee'}
            </p>

            <p className="text-fg-muted mt-4 text-[0.9375rem]">{plan.blurb}</p>

            <ul className="mt-5 flex flex-col gap-3">
              {plan.highlights.map((item) => (
                <li key={item} className="flex gap-3 text-[0.9375rem]">
                  <CheckIcon className="text-success mt-0.5 size-5 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <div className="mt-auto pt-7">
              <ButtonAnchor
                href={waHref(plan.whatsapp)}
                target="_blank"
                rel="noopener noreferrer"
                variant={plan.recommended ? 'primary' : 'outline'}
                size="lg"
                fullWidth
              >
                <WhatsappIcon className="size-5" />
                Choose {plan.name}
              </ButtonAnchor>
            </div>
          </Card>
        ))}
      </div>

      <div className="border-border bg-bg mt-10 overflow-hidden rounded-2xl border">
        <table className="w-full table-fixed border-collapse text-left text-sm sm:text-[0.9375rem]">
          <caption className="sr-only">Basic and Premium monthly plans compared</caption>
          <colgroup>
            <col className="w-[34%] sm:w-[40%]" />
            <col />
            <col />
          </colgroup>
          <thead className="bg-bg-subtle">
            <tr>
              <th scope="col" className="px-3 py-3.5 font-semibold sm:px-5">
                <span className="sr-only">What you get</span>
              </th>
              <th scope="col" className="px-3 py-3.5 font-semibold sm:px-5">
                Basic
              </th>
              <th scope="col" className="text-accent-text px-3 py-3.5 font-semibold sm:px-5">
                Premium
              </th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {monthlyComparison.map((row) => (
              <tr key={row.label} className="align-top">
                <th scope="row" className="text-fg-muted px-3 py-3.5 font-medium sm:px-5">
                  {row.label}
                </th>
                <td className="px-3 py-3.5 sm:px-5">{row.basic}</td>
                <td className="px-3 py-3.5 font-medium sm:px-5">{row.premium}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="text-fg-muted mt-6 flex max-w-3xl flex-col gap-2 text-sm">
        <li>
          Both plans: {monthlyTerms.hoursPerDay} hours a day, {monthlyTerms.daysOffPerMonth} days off
          a month, and ₹{monthlyTerms.overtimePerHour} for every extra hour.
        </li>
        <li>Plans cover driving within your city; outstation trips are charged separately.</li>
        <li>The driver&apos;s charge only — you provide the car and fuel, as with every booking.</li>
      </ul>
    </>
  );
}
