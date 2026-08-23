'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { LogoLink } from '@/components/Logo';
import { ButtonAnchor, ButtonLink, buttonStyles } from '@/components/ui/Button';
import { CloseIcon, MenuIcon, PhoneIcon } from '@/components/icons';
import { cn } from '@/lib/cn';
import { formatPhone, nav, site, telHref } from '@/lib/site';

/**
 * Sticky site header with a mobile drawer.
 *
 * The drawer is a native <dialog> opened with showModal(), which gives us the
 * focus trap, Escape-to-close, an inert background and focus restoration from
 * the platform — all of it more reliable than a hand-written trap.
 */
export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Drive the native modal from React state.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  // showModal() makes the background inert but does not stop it scrolling.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previous;
    };
  }, [open]);

  // Navigating from inside the drawer should close it.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href);

  return (
    <header className="border-border bg-bg/90 sticky top-0 z-40 border-b backdrop-blur-md">
      <div className="container-page flex h-16 items-center justify-between gap-4 lg:h-18">
        <LogoLink />

        {/* Desktop navigation */}
        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                  className={cn(
                    'block rounded-lg px-3 py-2 text-[0.9375rem] font-medium transition-colors duration-150',
                    isActive(item.href)
                      ? 'text-accent-text'
                      : 'text-fg-muted hover:text-fg hover:bg-surface',
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          {/* Phone + Book stay out of the top bar until the 1024px desktop
              layout, where the nav appears and there is room. Below that they
              would crowd the menu button and overflow on large phones sitting
              just above the 640px mark. CTAs still live in the hero, the drawer
              and the mobile bottom bar, so nothing is lost.

              The gate lives on this wrapper, not the buttons: the buttons carry
              `inline-flex` from buttonStyles, and `.inline-flex` is emitted
              after `.hidden` in the compiled sheet, so a bare `hidden` on the
              same element loses the source-order tie and never actually hides.
              A plain wrapper has no competing base display, so `hidden lg:flex`
              hides cleanly below 1024px. */}
          <div className="hidden items-center gap-2 lg:flex">
            <ButtonAnchor href={telHref} variant="outline" size="sm">
              <PhoneIcon className="size-4" />
              <span className="tabular">{formatPhone(site.phone)}</span>
            </ButtonAnchor>

            <ButtonLink href="/book/" size="sm">
              Book a driver
            </ButtonLink>
          </div>

          {/* Mobile menu trigger */}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={open}
            aria-controls="mobile-drawer"
            aria-label="Open menu"
            className={cn(
              'text-fg hover:bg-surface flex size-11 shrink-0 items-center justify-center rounded-xl',
              'border-border-strong border transition-colors duration-150 lg:hidden',
            )}
          >
            <MenuIcon className="size-5" />
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------------- drawer -- */}
      <dialog
        ref={dialogRef}
        id="mobile-drawer"
        aria-label="Site menu"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          // A click that lands on the dialog itself is a click on the backdrop.
          if (event.target === dialogRef.current) setOpen(false);
        }}
        className={cn(
          'bg-bg fixed inset-y-0 right-0 left-auto m-0 h-full max-h-none w-[min(21rem,88vw)] max-w-none',
          'border-border flex-col border-l p-0 shadow-lg open:flex',
          'motion-safe:animate-drawer-in',
          'backdrop:bg-ink/50 backdrop:motion-safe:animate-backdrop-in',
        )}
      >
        <div className="border-border flex h-16 shrink-0 items-center justify-between border-b px-5">
          <span className="text-eyebrow text-fg-subtle uppercase">Menu</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="text-fg hover:bg-surface flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors duration-150"
          >
            <CloseIcon className="size-5" />
          </button>
        </div>

        <nav aria-label="Site" className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <ul className="flex flex-col gap-0.5">
            <li>
              <Link
                href="/"
                aria-current={pathname === '/' ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center rounded-xl px-3 font-medium',
                  pathname === '/' ? 'bg-accent-subtle text-accent-text' : 'hover:bg-surface',
                )}
              >
                Home
              </Link>
            </li>
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                  className={cn(
                    'flex min-h-11 items-center rounded-xl px-3 font-medium',
                    isActive(item.href)
                      ? 'bg-accent-subtle text-accent-text'
                      : 'hover:bg-surface',
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-border flex shrink-0 flex-col gap-2 border-t p-4">
          <Link href="/book/" className={buttonStyles({ fullWidth: true })}>
            Book a driver
          </Link>
          <a href={telHref} className={buttonStyles({ variant: 'outline', fullWidth: true })}>
            <PhoneIcon className="size-4" />
            <span className="tabular">{formatPhone(site.phone)}</span>
          </a>
        </div>
      </dialog>
    </header>
  );
}
