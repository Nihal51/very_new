import Image from 'next/image';
import Link from 'next/link';
import { asset, site } from '@/lib/site';
import { cn } from '@/lib/cn';

/**
 * Brand lockup. The logo file is 200x167; width/height are always declared so
 * the header never shifts while the image decodes.
 */
export function Logo({
  className,
  size = 34,
  showTagline = false,
  tone = 'light',
}: {
  className?: string;
  size?: number;
  showTagline?: boolean;
  tone?: 'light' | 'dark';
}) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <Image
        src={asset('/assets/logo.png')}
        alt=""
        width={Math.round(size * (200 / 167))}
        height={size}
        priority
        className="shrink-0"
      />
      <span className="flex flex-col leading-none">
        <span
          className={cn(
            'font-display text-[1.0625rem] font-bold tracking-[-0.03em]',
            tone === 'dark' ? 'text-fg-inverse' : 'text-fg',
          )}
        >
          Drive
          <span className={tone === 'dark' ? 'text-accent' : 'text-accent-text'}>
            Buddy
          </span>
        </span>
        {showTagline && (
          <span
            className={cn(
              'mt-1 text-[0.6875rem] tracking-[0.06em] uppercase',
              tone === 'dark' ? 'text-white/55' : 'text-fg-subtle',
            )}
          >
            {site.tagline}
          </span>
        )}
      </span>
    </span>
  );
}

/** The logo as a home link, with an accessible name. */
export function LogoLink({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  return (
    <Link
      href="/"
      aria-label={`${site.name} — home`}
      /* min-h-11 keeps the lockup a 44px touch target without moving it. */
      className="flex min-h-11 shrink-0 items-center rounded-lg"
    >
      <Logo tone={tone} />
    </Link>
  );
}
