import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type CardTone = 'default' | 'subtle' | 'accent' | 'ink';

/**
 * The one card surface used site-wide. `interactive` adds hover lift for cards
 * that wrap a link; it is deliberately not the default, so static cards stay still.
 */
export function Card({
  children,
  className,
  tone = 'default',
  interactive = false,
  padded = true,
  as: Tag = 'div',
  id,
}: {
  children: ReactNode;
  className?: string;
  tone?: CardTone;
  interactive?: boolean;
  padded?: boolean;
  as?: ElementType;
  id?: string;
}) {
  return (
    <Tag
      id={id}
      className={cn(
        'relative rounded-2xl border',
        padded && 'p-6 sm:p-7',
        tone === 'default' && 'border-border bg-bg shadow-sm',
        tone === 'subtle' && 'border-border bg-surface',
        tone === 'accent' && 'border-accent-border bg-accent-subtle',
        tone === 'ink' && 'border-ink-border bg-ink-soft text-fg-inverse',
        interactive &&
          'transition-[border-color,box-shadow,transform] duration-150 ease-out-quart hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md',
        className,
      )}
    >
      {children}
    </Tag>
  );
}
