import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type BadgeTone = 'accent' | 'neutral' | 'success' | 'onDark' | 'outline';

/** Pill is reserved for badges and chips — nothing else in the system is round. */
export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap',
        // amber-700 text on the pale amber wash: 4.6:1, passes AA.
        tone === 'accent' && 'bg-accent-subtle text-accent-text',
        tone === 'neutral' && 'bg-surface text-fg-muted',
        tone === 'success' && 'bg-success-subtle text-success',
        tone === 'onDark' && 'bg-white/10 text-white/85',
        tone === 'outline' && 'border border-border-strong text-fg-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}
