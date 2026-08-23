'use client';

import { useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Props Field hands to its control so labelling and error wiring cannot be forgotten. */
export type FieldControlProps = {
  id: string;
  name: string;
  required?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
};

/**
 * Label + control + hint + error, wired together with a generated id.
 * The control is supplied as a render prop and receives the accessibility
 * attributes already computed, so `aria-describedby` / `aria-invalid` are
 * structurally correct rather than remembered by hand at each call site.
 */
export function Field({
  label,
  name,
  error,
  hint,
  required = false,
  optionalLabel = false,
  className,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  required?: boolean;
  /** Marks the field "Optional" in the label instead of starring the required ones. */
  optionalLabel?: boolean;
  className?: string;
  children: (props: FieldControlProps) => ReactNode;
}) {
  const uid = useId();
  const id = `${name}-${uid}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="text-accent-text ml-0.5">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
        {optionalLabel && (
          <span className="text-fg-subtle ml-1.5 text-xs font-normal">Optional</span>
        )}
      </label>

      {children({
        id,
        name,
        required: required || undefined,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}

      {/* Error takes the slot when present, so the row height stays predictable. */}
      {error ? (
        <p id={errorId} role="alert" className="text-error flex gap-1.5 text-sm">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="text-fg-subtle text-sm">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/* -------------------------------------------------------------- controls -- */

/**
 * One control skin shared by input, select and textarea.
 *
 * The control text is 16px (text-base) on purpose: iOS Safari auto-zooms the
 * page the moment you focus a control whose font-size is under 16px, which on
 * a phone lurches the whole layout sideways mid-typing. 16px is the documented
 * threshold that suppresses it. The height is fixed at h-11, so the size never
 * reflows anything — don't drop this back below 16px to shave a pixel.
 */
const controlStyles = cn(
  'w-full rounded-xl border bg-bg px-3.5 text-base',
  'border-border-strong placeholder:text-fg-subtle',
  'transition-[border-color,box-shadow] duration-150',
  'hover:border-fg-subtle',
  'focus:border-accent-hover focus:outline-none',
  'disabled:bg-surface disabled:text-fg-subtle disabled:cursor-not-allowed',
  'aria-invalid:border-error aria-invalid:bg-error-subtle',
);

/** 44px minimum height — the tap-target floor for the whole site. */
const controlHeight = 'h-11';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlStyles, controlHeight, className)} {...rest} />;
}

export function Textarea({
  className,
  rows = 3,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} className={cn(controlStyles, 'py-2.5', className)} {...rest} />;
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cn(
          controlStyles,
          controlHeight,
          // Room for the chevron; hide the platform arrow so it matches the icon set.
          'cursor-pointer appearance-none pr-10',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className="text-fg-subtle pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2"
      >
        <path d="m6.25 9.5 5.75 5.5 5.75-5.5" />
      </svg>
    </div>
  );
}
