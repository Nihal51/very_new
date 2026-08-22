import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons';

/** Used by the 404 page and any list that can legitimately come back empty. */
export function EmptyState({
  icon = 'info',
  title,
  body,
  action,
}: {
  icon?: IconName;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-border bg-bg-subtle mx-auto flex max-w-md flex-col items-center rounded-2xl border px-6 py-12 text-center">
      <span className="bg-surface text-fg-subtle flex size-12 items-center justify-center rounded-full">
        <Icon name={icon} className="size-6" />
      </span>
      <h2 className="text-display-sm mt-5">{title}</h2>
      {body && <p className="text-fg-muted mt-2 text-[0.9375rem]">{body}</p>}
      {action && <div className="mt-6 flex flex-wrap justify-center gap-3">{action}</div>}
    </div>
  );
}
