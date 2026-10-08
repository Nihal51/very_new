'use client';

/**
 * Small building blocks shared by the admin tabs: status pills, filter chips,
 * the toolbar, sortable table headers and the side drawer that holds a
 * booking's or driver's details. Dense on purpose: this is a work screen.
 */

import { useEffect, useRef, type ReactNode } from 'react';

import { CloseIcon, PhoneIcon, WhatsappIcon } from '@/components/icons';
import { BOOKING_STATUS, DRIVER_STATUS, prettyPhone, type BookingStatus, type DriverStatus } from '@/lib/bookings';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------- status pills */

const BOOKING_TONE: Record<BookingStatus, { pill: string; dot: string }> = {
  new: { pill: 'bg-accent-subtle text-accent-text ring-accent-border', dot: 'bg-accent' },
  confirmed: { pill: 'bg-info-subtle text-info ring-info-border', dot: 'bg-info' },
  assigned: { pill: 'bg-violet-50 text-violet-700 ring-violet-200', dot: 'bg-violet-500' },
  completed: { pill: 'bg-success-subtle text-success ring-success-border', dot: 'bg-success' },
  cancelled: { pill: 'bg-surface text-fg-subtle ring-border', dot: 'bg-fg-subtle' },
};

const DRIVER_TONE: Record<DriverStatus, { pill: string; dot: string }> = {
  new: BOOKING_TONE.new,
  verified: BOOKING_TONE.confirmed,
  active: BOOKING_TONE.completed,
  inactive: BOOKING_TONE.cancelled,
  rejected: { pill: 'bg-error-subtle text-error ring-error-border', dot: 'bg-error' },
};

function Pill({ tone, children }: { tone: { pill: string; dot: string }; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset',
        tone.pill,
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', tone.dot)} />
      {children}
    </span>
  );
}

export const BookingPill = ({ status }: { status: BookingStatus }) => (
  <Pill tone={BOOKING_TONE[status] ?? BOOKING_TONE.new}>{BOOKING_STATUS[status]?.label ?? status}</Pill>
);

export const DriverPill = ({ status }: { status: DriverStatus }) => (
  <Pill tone={DRIVER_TONE[status] ?? DRIVER_TONE.new}>{DRIVER_STATUS[status]?.label ?? status}</Pill>
);

export const PriorityTag = () => (
  <span className="bg-error-subtle text-error ring-error-border inline-flex rounded-full px-2 py-0.5 text-[0.6875rem] font-bold tracking-wide whitespace-nowrap uppercase ring-1 ring-inset">
    Priority
  </span>
);

/* ------------------------------------------------------------- filter chips */

export function Chips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string; count?: number; hot?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.id)}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap transition-colors',
              on ? 'border-ink bg-ink text-fg-inverse' : 'border-border-strong bg-bg text-fg-muted hover:text-fg hover:border-fg-subtle',
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs tabular',
                  on ? 'bg-white/15' : o.hot && o.count > 0 ? 'bg-accent text-ink' : 'bg-surface',
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ toolbar */

const controlCls =
  'border-border-strong bg-bg text-fg h-9 rounded-lg border px-3 text-sm focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30';

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className={cn(controlCls, 'w-full min-w-0 sm:w-72')}
    />
  );
}

export function MiniSelect<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { id: T; label: string }[];
  label: string;
}) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)} className={cn(controlCls, 'pr-8')}>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function ToolButton({ onClick, children, title }: { onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(controlCls, 'hover:bg-surface inline-flex items-center gap-2 font-semibold whitespace-nowrap')}
    >
      {children}
    </button>
  );
}

export const DownloadIcon = (p: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
);

/* ---------------------------------------------------------- table pieces */

export type Sort<K extends string> = { key: K; dir: 'asc' | 'desc' };

export function SortTh<K extends string>({
  k,
  sort,
  onSort,
  children,
  className,
}: {
  k: K;
  sort: Sort<K>;
  onSort: (s: Sort<K>) => void;
  children: ReactNode;
  className?: string;
}) {
  const on = sort.key === k;
  return (
    <th scope="col" aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={cn('px-3 py-2.5 font-semibold', className)}>
      <button
        type="button"
        onClick={() => onSort({ key: k, dir: on && sort.dir === 'desc' ? 'asc' : 'desc' })}
        className={cn('inline-flex items-center gap-1 uppercase hover:text-fg', on && 'text-fg')}
      >
        {children}
        <span aria-hidden="true" className={cn('text-[0.625rem]', !on && 'opacity-0')}>
          {sort.dir === 'asc' ? '▲' : '▼'}
        </span>
      </button>
    </th>
  );
}

export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th scope="col" className={cn('px-3 py-2.5 font-semibold uppercase', className)}>
    {children}
  </th>
);

/** The scrolling grid: header row stays put while the rows scroll, like a frozen row in Excel. */
export function Grid({ children, minWidth = '64rem' }: { children: ReactNode; minWidth?: string }) {
  return (
    <div className="border-border bg-bg max-h-[calc(100dvh-15rem)] overflow-auto rounded-xl border">
      <table className="w-full border-separate border-spacing-0 text-left text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export const theadCls =
  'bg-bg-subtle text-fg-subtle sticky top-0 z-10 text-[0.6875rem] tracking-wide [&_th]:border-b [&_th]:border-border';

export function compare(a: string | number | undefined, b: string | number | undefined, dir: 'asc' | 'desc') {
  const x = a ?? (dir === 'asc' ? Infinity : -Infinity);
  const y = b ?? (dir === 'asc' ? Infinity : -Infinity);
  const r = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : x < y ? -1 : x > y ? 1 : 0;
  return dir === 'asc' ? r : -r;
}

/* ---------------------------------------------------------------- contact */

export function ContactButtons({ phone, text, size = 'md' }: { phone: string; text?: string; size?: 'sm' | 'md' }) {
  const d = String(phone ?? '').replace(/\D/g, '').slice(-10);
  const cls = cn(
    'border-border-strong bg-bg hover:bg-surface inline-flex items-center justify-center gap-2 rounded-lg border font-semibold',
    size === 'sm' ? 'size-8' : 'h-11 px-4 text-sm',
  );
  return (
    <>
      <a href={`tel:+91${d}`} className={cls} title={`Call ${prettyPhone(d)}`} onClick={(e) => e.stopPropagation()}>
        <PhoneIcon className="size-4" />
        {size === 'md' && 'Call'}
      </a>
      <a
        href={`https://wa.me/91${d}${text ? `?text=${encodeURIComponent(text)}` : ''}`}
        target="_blank"
        rel="noopener noreferrer"
        className={cls}
        title="WhatsApp"
        onClick={(e) => e.stopPropagation()}
      >
        <WhatsappIcon className="size-4" />
        {size === 'md' && 'WhatsApp'}
      </a>
    </>
  );
}

/* ----------------------------------------------------------------- drawer */

/** A panel that slides in from the right (full screen on phones). Esc or the backdrop closes it. */
export function Drawer({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/40 backdrop-blur-[1px]" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="bg-bg relative flex h-full w-full flex-col shadow-2xl outline-none sm:w-[34rem] sm:max-w-[92vw]"
      >
        {children}
      </div>
    </div>
  );
}

export function DrawerHeader({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="border-border flex items-start justify-between gap-3 border-b px-5 py-4">
      <div className="min-w-0">{children}</div>
      <button type="button" onClick={onClose} aria-label="Close" className="hover:bg-surface -mr-2 rounded-lg p-2">
        <CloseIcon className="size-5" />
      </button>
    </div>
  );
}

export function Detail({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn(wide && 'col-span-2')}>
      <dt className="text-fg-subtle text-xs font-medium">{label}</dt>
      <dd className="text-fg mt-0.5 text-[0.9375rem] break-words">{children}</dd>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-fg-subtle mb-2 text-xs font-semibold tracking-wide uppercase">{children}</h3>;
}
