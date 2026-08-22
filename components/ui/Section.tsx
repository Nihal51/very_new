import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Container({
  children,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: ElementType;
}) {
  return <Tag className={cn('container-page', className)}>{children}</Tag>;
}

type SectionTone = 'default' | 'subtle' | 'ink';

/**
 * Enforces vertical rhythm and the eyebrow / H2 / lede heading pattern site-wide.
 * Pages compose this rather than hand-rolling padding, so spacing cannot drift.
 */
export function Section({
  children,
  eyebrow,
  title,
  lede,
  id,
  tone = 'default',
  align = 'left',
  headingLevel = 2,
  className,
  containerClassName,
  bleed = false,
}: {
  children?: ReactNode;
  eyebrow?: string;
  title?: ReactNode;
  lede?: ReactNode;
  id?: string;
  tone?: SectionTone;
  align?: 'left' | 'center';
  headingLevel?: 2 | 3;
  className?: string;
  containerClassName?: string;
  /** Skip the Container — for full-width children like snap rails. */
  bleed?: boolean;
}) {
  const Heading = (headingLevel === 2 ? 'h2' : 'h3') as ElementType;
  const headingId = id ? `${id}-heading` : undefined;

  const hasHeader = Boolean(title || eyebrow || lede);

  const header = hasHeader && (
    <div
      className={cn(
        'reveal',
        align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl',
      )}
    >
      {eyebrow && (
        <p
          className={cn(
            'text-eyebrow uppercase',
            tone === 'ink' ? 'text-accent' : 'text-accent-text',
          )}
        >
          {eyebrow}
        </p>
      )}
      {title && (
        <Heading
          id={headingId}
          className={cn('text-display-md', eyebrow && 'mt-3')}
        >
          {title}
        </Heading>
      )}
      {lede && (
        <p
          className={cn(
            'text-lede mt-4',
            tone === 'ink' ? 'text-white/70' : 'text-fg-muted',
          )}
        >
          {lede}
        </p>
      )}
    </div>
  );

  const inner = (
    <>
      {header}
      {children && <div className={cn(hasHeader && 'mt-12 sm:mt-14')}>{children}</div>}
    </>
  );

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn(
        'py-16 sm:py-20 lg:py-24',
        tone === 'subtle' && 'bg-bg-subtle border-border border-y',
        tone === 'ink' && 'bg-ink text-fg-inverse',
        className,
      )}
    >
      {bleed ? inner : <Container className={containerClassName}>{inner}</Container>}
    </section>
  );
}
