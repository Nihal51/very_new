import { cn } from '@/lib/cn';

export type Stat = { value: string; label: string };

/** Numeric proof points. Tabular figures so the row reads as a set, not four odd widths. */
export function StatBlock({
  stats,
  tone = 'default',
  className,
}: {
  stats: readonly Stat[];
  tone?: 'default' | 'ink';
  className?: string;
}) {
  return (
    <dl className={cn('grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-4', className)}>
      {stats.map((s) => (
        <div key={s.label} className="reveal">
          <dt className="sr-only">{s.label}</dt>
          <dd>
            <span
              className={cn(
                'tabular font-display block text-display-sm sm:text-display-md',
                tone === 'ink' ? 'text-accent' : 'text-fg',
              )}
            >
              {s.value}
            </span>
            <span
              className={cn(
                'mt-1 block text-sm',
                tone === 'ink' ? 'text-white/65' : 'text-fg-muted',
              )}
            >
              {s.label}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
