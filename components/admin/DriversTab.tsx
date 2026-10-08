'use client';

import type { User } from 'firebase/auth';
import { useMemo, useState } from 'react';

import { PhoneIcon, WhatsappIcon } from '@/components/icons';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';
import { changeDriverStatus } from '@/lib/admin';
import { DRIVER_STATUS, formatDateTime, prettyPhone, type Driver, type DriverStatus } from '@/lib/bookings';
import { cn } from '@/lib/cn';

const LICENCE: Record<string, string> = {
  commercial: 'Commercial',
  lmv: 'LMV (private car)',
  both: 'Commercial + LMV',
};

type Filter = DriverStatus | 'all';
const FILTERS: Filter[] = ['new', 'verified', 'active', 'inactive', 'rejected', 'all'];

/** What each status can move to next, as [target, button label]. */
const NEXT: Record<DriverStatus, [DriverStatus, string][]> = {
  new: [
    ['verified', 'Mark verified (ID + police check done)'],
    ['rejected', 'Reject'],
  ],
  verified: [
    ['active', 'Activate – can take bookings'],
    ['rejected', 'Reject'],
  ],
  active: [['inactive', 'Deactivate']],
  inactive: [['active', 'Activate again']],
  rejected: [['new', 'Reconsider']],
};

export function DriversTab({ user, drivers, error }: { user: User; drivers: Driver[] | null; error: boolean }) {
  const [filter, setFilter] = useState<Filter>('new');
  const [search, setSearch] = useState('');

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (drivers ?? []).filter(
      (d) =>
        (filter === 'all' || d.status === filter) &&
        (!q || [d.name, d.phone, d.city].some((v) => String(v ?? '').toLowerCase().includes(q))),
    );
  }, [drivers, filter, search]);

  if (error) return <Alert tone="error">Could not load drivers. Refresh the page to try again.</Alert>;
  if (!drivers)
    return (
      <div className="text-fg-muted flex items-center gap-3">
        <Spinner className="size-5" /> Loading drivers…
      </div>
    );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm font-semibold',
                filter === f ? 'border-ink bg-ink text-fg-inverse' : 'border-border-strong text-fg-muted hover:text-fg',
              )}
            >
              {f === 'all' ? 'All' : DRIVER_STATUS[f].label}{' '}
              <span className="tabular opacity-70">
                {f === 'all' ? drivers.length : drivers.filter((d) => d.status === f).length}
              </span>
            </button>
          ))}
        </div>
        <Input
          type="search"
          placeholder="Search name, phone, city…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="lg:max-w-xs"
          aria-label="Search drivers"
        />
      </div>

      {visible.length === 0 ? (
        <p className="text-fg-muted py-10 text-center">No drivers here.</p>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {visible.map((d) => (
            <li key={d.id}>
              <DriverCard d={d} user={user} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DriverCard({ d, user }: { d: Driver; user: User }) {
  const [busy, setBusy] = useState<DriverStatus | 'note' | null>(null);
  const [note, setNote] = useState(d.adminNote ?? '');
  const [err, setErr] = useState('');
  const status = DRIVER_STATUS[d.status] ?? DRIVER_STATUS.new;

  async function move(to: DriverStatus | 'note') {
    setBusy(to);
    setErr('');
    try {
      await changeDriverStatus(user, d.id, to === 'note' ? d.status : to, note);
    } catch {
      setErr('Could not save. Check your internet and try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold">{d.name}</p>
          <p className="text-fg-subtle text-sm">
            {d.city} · applied {formatDateTime(d.createdAt)}
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={`tel:+91${d.phone}`}
          className="border-border-strong inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold tabular"
        >
          <PhoneIcon className="size-4" /> {prettyPhone(d.phone)}
        </a>
        <a
          href={`https://wa.me/91${d.phone}`}
          target="_blank"
          rel="noopener noreferrer"
          className="border-border-strong inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold"
        >
          <WhatsappIcon className="size-4" /> WhatsApp
        </a>
      </div>

      <dl className="text-fg-muted mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[0.9375rem]">
        <div>
          <dt className="text-fg-subtle text-xs">Experience</dt>
          <dd className="text-fg">{d.experienceYears} years</dd>
        </div>
        <div>
          <dt className="text-fg-subtle text-xs">Licence</dt>
          <dd className="text-fg">{LICENCE[d.licence] ?? d.licence}</dd>
        </div>
        {d.about && (
          <div className="col-span-2">
            <dt className="text-fg-subtle text-xs">About</dt>
            <dd className="text-fg">{d.about}</dd>
          </div>
        )}
      </dl>

      {err && <Alert tone="error" className="mt-4">{err}</Alert>}

      <div className="border-border mt-auto flex flex-col gap-3 border-t pt-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="Internal note – documents seen, police check date…"
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
            aria-label={`Note about ${d.name}`}
          />
          <Button variant="outline" loading={busy === 'note'} onClick={() => move('note')} disabled={note === (d.adminNote ?? '')}>
            Save note
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {NEXT[d.status]?.map(([to, label]) => (
            <Button
              key={to}
              variant={to === 'rejected' || to === 'inactive' ? 'ghost' : 'primary'}
              loading={busy === to}
              onClick={() => move(to)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
    </Card>
  );
}
