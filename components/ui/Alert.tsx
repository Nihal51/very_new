import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { AlertIcon, CheckCircleIcon, InfoIcon } from '@/components/icons';

type AlertTone = 'success' | 'error' | 'info';

const config = {
  success: { Icon: CheckCircleIcon, box: 'border-success-border bg-success-subtle', fg: 'text-success' },
  error: { Icon: AlertIcon, box: 'border-error-border bg-error-subtle', fg: 'text-error' },
  info: { Icon: InfoIcon, box: 'border-info-border bg-info-subtle', fg: 'text-info' },
} as const;

/**
 * Inline status message. Errors get role="alert" so screen readers announce them
 * the moment they appear; success/info are polite to avoid interrupting.
 */
export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const { Icon, box, fg } = config[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={cn('flex gap-3 rounded-xl border p-4', box, className)}
    >
      <Icon className={cn('mt-0.5 size-5 shrink-0', fg)} />
      <div className="min-w-0 text-sm">
        {title && <p className={cn('font-semibold', fg)}>{title}</p>}
        {children && <div className={cn('text-fg-muted', title && 'mt-1')}>{children}</div>}
      </div>
    </div>
  );
}
