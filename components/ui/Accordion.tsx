import { ChevronDownIcon } from '@/components/icons';
import { cn } from '@/lib/cn';

export type AccordionItem = { q: string; a: string };

/**
 * FAQ accordion built on native <details>/<summary>.
 * Keyboard support, focus handling and the expanded state are all free from the
 * platform — this component ships zero JavaScript.
 *
 * The shared `name` makes the group exclusive in modern browsers; where that is
 * unsupported the panels simply all open independently, which is fine.
 */
export function Accordion({
  items,
  name = 'faq',
  className,
  defaultOpenFirst = false,
}: {
  items: AccordionItem[];
  name?: string;
  className?: string;
  defaultOpenFirst?: boolean;
}) {
  return (
    <div className={cn('divide-border divide-y border-border border-y', className)}>
      {items.map((item, i) => (
        <details
          key={item.q}
          name={name}
          open={defaultOpenFirst && i === 0}
          className="group"
        >
          <summary
            className={cn(
              'flex w-full items-center justify-between gap-4 py-5 text-left',
              'font-display text-base font-semibold sm:text-lg',
              'transition-colors duration-150 hover:text-accent-text',
            )}
          >
            {item.q}
            <ChevronDownIcon
              className={cn(
                'text-accent-text size-5 shrink-0',
                'transition-transform duration-200 ease-out-quart group-open:rotate-180',
              )}
            />
          </summary>
          <p className="text-fg-muted measure pb-5 text-[0.9375rem]">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
