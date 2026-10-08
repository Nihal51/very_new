'use client';

import type { User } from 'firebase/auth';
import { useMemo, useState } from 'react';

import {
  Chips,
  compare,
  ContactButtons,
  Detail,
  DownloadIcon,
  Drawer,
  DrawerHeader,
  DriverPill,
  Grid,
  SearchBox,
  SectionTitle,
  SortTh,
  Th,
  theadCls,
  ToolButton,
  type Sort,
} from '@/components/admin/kit';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';
import { changeDriverStatus } from '@/lib/admin';
import { DRIVER_STATUS, formatDateTime, prettyPhone, type Driver, type DriverStatus } from '@/lib/bookings';
import { cn } from '@/lib/cn';
import { downloadCsv, exportName, sheetPhone } from '@/lib/export';

const LICENCE: Record<string, string> = {
  commercial: 'Commercial',
  lmv: 'LMV (private car)',
  both: 'Commercial + LMV',
};

type Filter = DriverStatus | 'all';

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

type SortKey = 'name' | 'city' | 'exp' | 'status' | 'applied';
const ORDER: Record<DriverStatus, number> = { new: 0, verified: 1, active: 2, inactive: 3, rejected: 4 };
const sortValue = (d: Driver, k: SortKey) =>
  k === 'name'
    ? d.name?.toLowerCase()
    : k === 'city'
      ? d.city
      : k === 'exp'
        ? Number(d.experienceYears) || 0
        : k === 'status'
          ? ORDER[d.status]
          : d.createdAt?.getTime();

export function DriversTab({ user, drivers, error }: { user: User; drivers: Driver[] | null; error: boolean }) {
  const all = useMemo(() => drivers ?? [], [drivers]);
  const [filter, setFilter] = useState<Filter>(() => (all.some((d) => d.status === 'new') ? 'new' : 'all'));
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort<SortKey>>({ key: 'applied', dir: 'desc' });
  const [openId, setOpenId] = useState<string | null>(null);

  const base = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((d) => !q || [d.name, d.phone, d.city, d.adminNote].some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [all, search]);

  const visible = useMemo(
    () =>
      base
        .filter((d) => filter === 'all' || d.status === filter)
        .sort((a, b) => compare(sortValue(a, sort.key), sortValue(b, sort.key), sort.dir)),
    [base, filter, sort],
  );

  const open = openId ? all.find((d) => d.id === openId) : undefined;

  if (error) return <Alert tone="error">Could not load drivers. Refresh the page to try again.</Alert>;
  if (!drivers)
    return (
      <div className="text-fg-muted flex items-center gap-3 py-10">
        <Spinner className="size-5" /> Loading drivers…
      </div>
    );

  const count = (f: Filter) => base.filter((d) => f === 'all' || d.status === f).length;

  function exportRows() {
    downloadCsv(exportName('drivers'), [
      ['Name', 'Phone', 'City', 'Experience (years)', 'Licence', 'Status', 'Applied at', 'About', 'Admin note'],
      ...visible.map((d) => [
        d.name,
        sheetPhone(d.phone),
        d.city,
        d.experienceYears,
        LICENCE[d.licence] ?? d.licence,
        DRIVER_STATUS[d.status]?.label ?? d.status,
        formatDateTime(d.createdAt),
        d.about ?? '',
        d.adminNote ?? '',
      ]),
    ]);
  }

  return (
    <div className="flex flex-col gap-3">
      <Chips
        label="Filter by status"
        value={filter}
        onChange={setFilter}
        options={[
          { id: 'new', label: 'Applied', count: count('new'), hot: true },
          { id: 'verified', label: 'Verified', count: count('verified') },
          { id: 'active', label: 'Active', count: count('active') },
          { id: 'inactive', label: 'Inactive', count: count('inactive') },
          { id: 'rejected', label: 'Rejected', count: count('rejected') },
          { id: 'all', label: 'All', count: count('all') },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={search} onChange={setSearch} placeholder="Search name, phone, city, note…" />
        <div className="ml-auto flex items-center gap-3">
          <span className="text-fg-subtle text-sm tabular">
            {visible.length} of {all.length}
          </span>
          <ToolButton onClick={exportRows} title="Download these rows as a file for Excel or Google Sheets">
            <DownloadIcon className="size-4" /> Excel
          </ToolButton>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="border-border text-fg-muted rounded-xl border border-dashed py-16 text-center">
          {all.length === 0 ? 'No driver applications yet.' : 'Nothing matches these filters.'}
        </div>
      ) : (
        <>
          <ul className="border-border divide-border bg-bg divide-y overflow-hidden rounded-xl border lg:hidden">
            {visible.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(d.id)}
                  className={cn('flex w-full flex-col gap-1 px-4 py-3 text-left', d.status === 'new' && 'bg-accent-subtle/60')}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{d.name}</span>
                    <DriverPill status={d.status} />
                  </span>
                  <span className="text-fg-muted text-sm">
                    {d.city} · {d.experienceYears} yrs · {LICENCE[d.licence] ?? d.licence}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="hidden lg:block">
            <Grid minWidth="60rem">
              <thead className={theadCls}>
                <tr>
                  <SortTh k="name" sort={sort} onSort={setSort}>Name</SortTh>
                  <Th>Phone</Th>
                  <SortTh k="city" sort={sort} onSort={setSort}>City</SortTh>
                  <SortTh k="exp" sort={sort} onSort={setSort}>Experience</SortTh>
                  <Th>Licence</Th>
                  <SortTh k="status" sort={sort} onSort={setSort}>Status</SortTh>
                  <SortTh k="applied" sort={sort} onSort={setSort}>Applied</SortTh>
                  <Th>Note</Th>
                </tr>
              </thead>
              <tbody className="[&_td]:border-border [&_td]:border-b [&_tr:last-child_td]:border-b-0">
                {visible.map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => setOpenId(d.id)}
                    className={cn('hover:bg-surface cursor-pointer', d.status === 'new' && 'bg-accent-subtle/50', d.id === openId && 'bg-surface')}
                  >
                    <td className="px-3 py-2.5 font-medium">{d.name}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular">
                      <a href={`tel:+91${d.phone}`} onClick={(e) => e.stopPropagation()} className="hover:text-accent-text">
                        {prettyPhone(d.phone)}
                      </a>
                    </td>
                    <td className="px-3 py-2.5">{d.city}</td>
                    <td className="px-3 py-2.5 tabular">{d.experienceYears} yrs</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{LICENCE[d.licence] ?? d.licence}</td>
                    <td className="px-3 py-2.5">
                      <DriverPill status={d.status} />
                    </td>
                    <td className="text-fg-muted px-3 py-2.5 whitespace-nowrap">{formatDateTime(d.createdAt)}</td>
                    <td className="text-fg-muted max-w-[18rem] px-3 py-2.5">
                      <div className="truncate" title={d.adminNote}>
                        {d.adminNote || '—'}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Grid>
          </div>
        </>
      )}

      <Drawer open={Boolean(open)} onClose={() => setOpenId(null)} label={open ? `Driver ${open.name}` : 'Driver'}>
        {open && <DriverDetail key={open.id} d={open} user={user} onClose={() => setOpenId(null)} />}
      </Drawer>
    </div>
  );
}

function DriverDetail({ d, user, onClose }: { d: Driver; user: User; onClose: () => void }) {
  const [busy, setBusy] = useState<DriverStatus | 'note' | null>(null);
  const [note, setNote] = useState(d.adminNote ?? '');
  const [err, setErr] = useState('');

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
    <>
      <DrawerHeader onClose={onClose}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-xl font-bold">{d.name}</h2>
          <DriverPill status={d.status} />
        </div>
        <p className="text-fg-subtle mt-1 text-sm">Applied {formatDateTime(d.createdAt)}</p>
      </DrawerHeader>
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <p className="text-fg-muted tabular">{prettyPhone(d.phone)}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <ContactButtons phone={d.phone} />
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3">
          <Detail label="City">{d.city}</Detail>
          <Detail label="Experience">{d.experienceYears} years</Detail>
          <Detail label="Licence" wide>
            {LICENCE[d.licence] ?? d.licence}
          </Detail>
          {d.about && (
            <Detail label="About" wide>
              {d.about}
            </Detail>
          )}
        </dl>

        {err && (
          <Alert tone="error" className="mt-5">
            {err}
          </Alert>
        )}

        <div className="border-border mt-5 border-t pt-5">
          <SectionTitle>Status</SectionTitle>
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

        <div className="border-border mt-5 border-t pt-5">
          <SectionTitle>Internal note</SectionTitle>
          <Textarea
            rows={3}
            placeholder="Documents seen, police check date, references…"
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
            aria-label={`Note about ${d.name}`}
          />
          <Button
            className="mt-2"
            variant="outline"
            loading={busy === 'note'}
            onClick={() => move('note')}
            disabled={note === (d.adminNote ?? '')}
          >
            Save note
          </Button>
        </div>
      </div>
    </>
  );
}
