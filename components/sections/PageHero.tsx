import Link from 'next/link';
import { Container } from '@/components/ui/Section';
import { cn } from '@/lib/cn';

export type Crumb = { name: string; path: string };

/** Visual breadcrumb. The matching BreadcrumbList JSON-LD is emitted by each page. */
export function Breadcrumbs({ trail, className }: { trail: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="text-fg-subtle flex flex-wrap items-center gap-1.5 text-sm">
        <li>
          <Link href="/" className="hover:text-fg-muted rounded-lg">
            Home
          </Link>
        </li>
        {trail.map((crumb, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={crumb.path} className="flex items-center gap-1.5">
              <span aria-hidden="true">/</span>
              {last ? (
                <span className="text-fg-muted font-medium" aria-current="page">
                  {crumb.name}
                </span>
              ) : (
                <Link href={crumb.path} className="hover:text-fg-muted rounded-lg">
                  {crumb.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The single H1 block every inner page opens with. Keeping it here means the
 * heading scale, spacing and breadcrumb placement are identical on all of them.
 */
export function PageHero({
  eyebrow,
  title,
  lede,
  trail,
  actions,
  children,
  className,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  trail?: Crumb[];
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('border-border bg-bg-subtle border-b', className)}>
      <Container className="py-10 sm:py-14 lg:py-16">
        {trail && <Breadcrumbs trail={trail} className="mb-6" />}
        {eyebrow && <p className="text-eyebrow text-accent-text uppercase">{eyebrow}</p>}
        <h1 className={cn('text-display-lg max-w-4xl', eyebrow && 'mt-3')}>{title}</h1>
        {lede && <p className="text-lede text-fg-muted measure mt-4">{lede}</p>}
        {actions && <div className="mt-7 flex flex-wrap gap-3">{actions}</div>}
        {children}
      </Container>
    </div>
  );
}
