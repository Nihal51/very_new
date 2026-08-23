import Link from 'next/link';
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'onDark';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Shared button styling. Exported so <a>, <Link> and <button> can all wear the
 * exact same skin without duplicating class strings.
 *
 * Contrast note: amber (#f59e0b) is ~2.1:1 on white, so it can never carry
 * white text. `primary` is amber fill with ink text — 11.4:1.
 */
export function buttonStyles({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
} = {}): string {
  return cn(
    // Base: inline-flex, no layout shift between states, consistent motion.
    'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap',
    'rounded-xl font-semibold tracking-[-0.01em]',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out-quart',
    'active:translate-y-px',
    'disabled:pointer-events-none disabled:opacity-55',
    'aria-disabled:pointer-events-none aria-disabled:opacity-55',

    // sm stays a dense 36px for mouse pointers (e.g. the desktop-only header
    // CTAs), but lifts to the 44px tap-target floor on touch via pointer-coarse.
    // The recovery CTAs in the form error alerts render at this size on phones,
    // so the coarse floor keeps those tappable without changing the desktop look.
    size === 'sm' && 'h-9 px-3.5 text-sm pointer-coarse:h-11',
    size === 'md' && 'h-11 px-5 text-[0.9375rem]', // 44px — minimum tap target
    size === 'lg' && 'h-13 px-6.5 text-base',

    variant === 'primary' &&
      'bg-accent text-ink shadow-sm hover:bg-accent-hover hover:shadow-md',
    variant === 'secondary' &&
      'bg-ink text-fg-inverse shadow-sm hover:bg-ink-soft hover:shadow-md',
    variant === 'outline' &&
      'border border-border-strong bg-bg text-fg hover:border-fg-subtle hover:bg-surface',
    variant === 'ghost' && 'text-fg-muted hover:bg-surface hover:text-fg',
    variant === 'onDark' &&
      'border border-white/25 bg-white/10 text-fg-inverse hover:border-white/40 hover:bg-white/18',

    fullWidth && 'w-full',
  );
}

type BaseProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
};

export type ButtonProps = BaseProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    /** Shows a spinner, blocks input and announces busy state. */
    loading?: boolean;
    /** Replaces the label while `loading` is true. */
    loadingText?: string;
  };

export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  loadingText,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      className={cn(buttonStyles({ variant, size, fullWidth }), className)}
      {...rest}
    >
      {loading && <Spinner className="size-4" />}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}

export type ButtonLinkProps = BaseProps &
  Omit<ComponentProps<typeof Link>, 'className'> & {
    className?: string;
    children?: ReactNode;
  };

/** Internal navigation that looks like a button. */
export function ButtonLink({
  variant,
  size,
  fullWidth,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link
      className={cn(buttonStyles({ variant, size, fullWidth }), className)}
      {...rest}
    >
      {children}
    </Link>
  );
}

export type ButtonAnchorProps = BaseProps &
  React.AnchorHTMLAttributes<HTMLAnchorElement>;

/** External / `tel:` / `mailto:` links that look like a button. */
export function ButtonAnchor({
  variant,
  size,
  fullWidth,
  className,
  children,
  ...rest
}: ButtonAnchorProps) {
  return (
    <a
      className={cn(buttonStyles({ variant, size, fullWidth }), className)}
      {...rest}
    >
      {children}
    </a>
  );
}
