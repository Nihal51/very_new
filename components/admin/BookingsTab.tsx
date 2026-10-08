'use client';

import type { User } from 'firebase/auth';
import { useEffect, useMemo, useState } from 'react';

import {
  BookingPill,
  Chips,
  compare,
  ContactButtons,
  Detail,
  DownloadIcon,
  Drawer,
  DrawerHeader,
  Grid,
  MiniSelect,
  PriorityTag,
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
import { Input, Select } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';
import { addBookingNote, changeBookingStatus } from '@/lib/admin';
import {
  BOOKING_STATUS,
  DATE_RANGES,
  formatDateTime,
  formatPreferred,
  inDateRange,
  packageName,
  prettyPhone,
  refLabel,
  timeAgo,
  toDate,
  tripInstant,
  type Booking,
  type BookingStatus,
  type DateRange,
  type Driver,
} from '@/lib/bookings';
import { cn } from '@/lib/cn';
import { downloadCsv, exportName, sheetPhone } from '@/lib/export';
import { getFirebaseApp } from '@/lib/firebase';

export type StatusFilter = 'open' | BookingStatus | 'all';
export type BookingView = { status: StatusFilter; range: DateRange };

const OPEN: BookingStatus[] = ['new', 'confirmed', 'assigned'];
const matchesStatus = (b: Booking, f: StatusFilter) =>
  f === 'all' ? true : f === 'open' ? OPEN.includes(b.status) : b.status === f;

type SortKey = 'ref' | 'status' | 'name' | 'city' | 'trip' | 'booked';
const STATUS_ORDER: Record<BookingStatus, number> = { new: 0, confirmed: 1, assigned: 2, completed: 3, cancelled: 4 };

const sortValue = (b: Booking, k: SortKey): string | number | undefined =>
  k === 'ref'
    ? (b.number ?? b.createdAt?.getTime())
    : k === 'status'
      ? STATUS_ORDER[b.status]
      : k === 'name'
        ? b.name?.toLowerCase()
        : k === 'city'
          ? b.city
          : k === 'trip'
            ? (tripInstant(b.preferredTime) ?? b.createdAt)?.getTime()
            : b.createdAt?.getTime();

export function BookingsTab({
  user,
  bookings,
  error,
  drivers,
  view,
  onView,
  openId,
  onOpen,
}: {
  user: User;
  bookings: Booking[] | null;
  error: boolean;
  drivers: Driver[];
  view: BookingView;
  onView: (v: BookingView) => void;
  openId: string | null;
  onOpen: (id: string | null) => void;
}) {
  const [search, setSearch] = useState('');
  const [city, setCity] = useState('all');
  const [sort, setSort] = useState<Sort<SortKey>>({ key: 'booked', dir: 'desc' });
  const [now, setNow] = useState(() => Date.now());
  const [openMode, setOpenMode] = useState<Mode>(null);

  // "5 min ago" keeps counting without a refresh.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const activeDrivers = useMemo(() => drivers.filter((d) => d.status === 'active'), [drivers]);
  const rows = useMemo(() => bookings ?? [], [bookings]);
  const cities = useMemo(() => [...new Set(rows.map((b) => b.city).filter(Boolean))].sort(), [rows]);

  // Everything except the status chip, so each chip can show its own count.
  const base = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    return rows.filter(
      (b) =>
        (city === 'all' || b.city === city) &&
        inDateRange(b.createdAt, view.range, now) &&
        (!q ||
          [b.name, b.ref, b.pickup, b.city, packageName(b.package), b.assignedDriver?.name, b.notes].some((v) =>
            String(v ?? '').toLowerCase().includes(q),
          ) ||
          (qDigits.length >= 3 && String(b.phone ?? '').includes(qDigits))),
    );
  }, [rows, search, city, view.range, now]);

  const visible = useMemo(
    () =>
      base
        .filter((b) => matchesStatus(b, view.status))
        .sort((a, b) => compare(sortValue(a, sort.key), sortValue(b, sort.key), sort.dir)),
    [base, view.status, sort],
  );

  const open = openId ? rows.find((b) => b.id === openId) : undefined;

  function openRow(id: string, mode: Mode = null) {
    setOpenMode(mode);
    onOpen(id);
  }

  function exportRows() {
    downloadCsv(exportName('bookings'), [
      ['Ref', 'Status', 'Booked at', 'Customer', 'Phone', 'City', 'Package', 'Pickup', 'Trip time', 'Driver', 'Driver phone', 'Customer notes', 'Customer type', 'Cancel reason'],
      ...visible.map((b) => [
        b.ref ?? '',
        BOOKING_STATUS[b.status]?.label ?? b.status,
        formatDateTime(b.createdAt),
        b.name,
        sheetPhone(b.phone),
        b.city,
        packageName(b.package),
        b.pickup,
        formatPreferred(b.preferredTime),
        b.assignedDriver?.name ?? '',
        b.assignedDriver ? sheetPhone(b.assignedDriver.phone) : '',
        b.notes ?? '',
        `${b.isReturning ? 'Returning' : 'New'}${b.customerUid ? ' · logged in' : ''}`,
        b.status === 'cancelled' ? (b.cancelReason ?? '') : '',
      ]),
    ]);
  }

  if (error) return <Alert tone="error">Could not load bookings. Check that you are still logged in, then refresh.</Alert>;
  if (!bookings)
    return (
      <div className="text-fg-muted flex items-center gap-3 py-10">
        <Spinner className="size-5" /> Loading bookings…
      </div>
    );

  const chip = (id: StatusFilter, label: string, hot = false) => ({
    id,
    label,
    hot,
    count: base.filter((b) => matchesStatus(b, id)).length,
  });

  const filtered = search || city !== 'all' || view.range !== 'any' || view.status !== 'all';

  return (
    <div className="flex flex-col gap-3">
      <Chips
        label="Filter by status"
        value={view.status}
        onChange={(status) => onView({ ...view, status })}
        options={[
          chip('open', 'Needs action'),
          chip('new', 'New', true),
          chip('confirmed', 'Confirmed'),
          chip('assigned', 'Driver assigned'),
          chip('completed', 'Completed'),
          chip('cancelled', 'Cancelled'),
          chip('all', 'All'),
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={search} onChange={setSearch} placeholder="Search name, phone, DB-number, area…" />
        <MiniSelect
          label="City"
          value={city}
          onChange={setCity}
          options={[{ id: 'all', label: 'All cities' }, ...cities.map((c) => ({ id: c, label: c }))]}
        />
        <MiniSelect label="Booked" value={view.range} onChange={(range) => onView({ ...view, range })} options={DATE_RANGES} />
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setCity('all');
              onView({ status: 'all', range: 'any' });
            }}
            className="text-fg-muted hover:text-fg px-1 text-sm font-semibold underline underline-offset-4"
          >
            Clear filters
          </button>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-fg-subtle text-sm tabular">
            {visible.length} of {rows.length}
          </span>
          <ToolButton onClick={exportRows} title="Download these rows as a file for Excel or Google Sheets">
            <DownloadIcon className="size-4" /> Excel
          </ToolButton>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="border-border text-fg-muted rounded-xl border border-dashed py-16 text-center">
          {rows.length === 0 ? 'No bookings yet. They appear here the moment a customer books.' : 'Nothing matches these filters.'}
        </div>
      ) : (
        <>
          {/* Phones: a compact list. */}
          <ul className="border-border divide-border bg-bg divide-y overflow-hidden rounded-xl border lg:hidden">
            {visible.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => openRow(b.id)}
                  className={cn('flex w-full flex-col gap-1 px-4 py-3 text-left', b.status === 'new' && 'bg-accent-subtle/60')}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold tabular">{refLabel(b, now)}</span>
                      <BookingPill status={b.status} />
                      {b.package === 'medical-emergency' && <PriorityTag />}
                    </span>
                    <span className="text-fg-subtle text-xs">{timeAgo(b.createdAt, now)}</span>
                  </span>
                  <span className="text-[0.9375rem] font-medium">
                    {b.name} <span className="text-fg-subtle font-normal">· {b.city}</span>
                  </span>
                  <span className="text-fg-muted text-sm">
                    {packageName(b.package)} · {formatPreferred(b.preferredTime)}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {/* Laptops: the sheet. */}
          <div className="hidden lg:block">
            <Grid minWidth="72rem">
              <thead className={theadCls}>
                <tr>
                  <SortTh k="ref" sort={sort} onSort={setSort}>Ref</SortTh>
                  <SortTh k="status" sort={sort} onSort={setSort}>Status</SortTh>
                  <SortTh k="name" sort={sort} onSort={setSort}>Customer</SortTh>
                  <SortTh k="city" sort={sort} onSort={setSort}>City</SortTh>
                  <Th>Package</Th>
                  <Th>Pickup</Th>
                  <SortTh k="trip" sort={sort} onSort={setSort}>Trip time</SortTh>
                  <Th>Driver</Th>
                  <SortTh k="booked" sort={sort} onSort={setSort}>Booked</SortTh>
                  <Th className="text-right">Next step</Th>
                </tr>
              </thead>
              <tbody className="[&_td]:border-border [&_td]:border-b [&_tr:last-child_td]:border-b-0">
                {visible.map((b) => (
                  <Row key={b.id} b={b} user={user} now={now} selected={b.id === openId} onOpen={openRow} />
                ))}
              </tbody>
            </Grid>
          </div>
        </>
      )}

      <Drawer open={Boolean(open)} onClose={() => onOpen(null)} label={open ? `Booking ${refLabel(open, now)}` : 'Booking'}>
        {open && (
          <BookingDetail
            key={open.id}
            b={open}
            user={user}
            drivers={activeDrivers}
            now={now}
            initialMode={openMode}
            onClose={() => onOpen(null)}
          />
        )}
      </Drawer>
    </div>
  );
}

/* ----------------------------------------------------------------- the row */

function Row({
  b,
  user,
  now,
  selected,
  onOpen,
}: {
  b: Booking;
  user: User;
  now: number;
  selected: boolean;
  onOpen: (id: string, mode?: Mode) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function quick(to: BookingStatus) {
    setBusy(true);
    setFailed(false);
    try {
      await changeBookingStatus(user, b.id, b.status, to);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const next =
    b.status === 'new'
      ? { label: 'Confirm', title: 'You called the customer and the booking is on', run: () => quick('confirmed') }
      : b.status === 'confirmed'
        ? { label: 'Assign driver', title: 'Choose a driver', run: () => onOpen(b.id, 'assign') }
        : b.status === 'assigned'
          ? { label: 'Complete', title: 'The trip is done', run: () => quick('completed') }
          : null;

  return (
    <tr
      onClick={() => onOpen(b.id)}
      className={cn(
        'hover:bg-surface cursor-pointer align-top',
        b.status === 'new' && 'bg-accent-subtle/50',
        b.status === 'cancelled' && 'text-fg-subtle',
        selected && 'bg-surface',
      )}
    >
      <td className="px-3 py-2.5 font-semibold whitespace-nowrap tabular">
        <span className={cn('border-l-[3px] pl-2', b.package === 'medical-emergency' ? 'border-error' : 'border-transparent')}>
          {refLabel(b, now)}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <BookingPill status={b.status} />
      </td>
      <td className="px-3 py-2.5">
        <div className="font-medium">{b.name}</div>
        <a
          href={`tel:+91${b.phone}`}
          onClick={(e) => e.stopPropagation()}
          className="text-fg-subtle hover:text-accent-text text-xs whitespace-nowrap tabular"
        >
          {prettyPhone(b.phone)}
        </a>
        {b.isReturning && <span className="text-fg-subtle ml-1.5 text-xs">· returning</span>}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">{b.city}</td>
      <td className="px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {packageName(b.package)}
          {b.package === 'medical-emergency' && <PriorityTag />}
        </div>
      </td>
      <td className="max-w-[16rem] px-3 py-2.5">
        <div className="line-clamp-2" title={b.pickup}>
          {b.pickup}
        </div>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">{formatPreferred(b.preferredTime)}</td>
      <td className="px-3 py-2.5 whitespace-nowrap">{b.assignedDriver?.name ?? <span className="text-fg-subtle">—</span>}</td>
      <td className="text-fg-muted px-3 py-2.5 whitespace-nowrap" title={formatDateTime(b.createdAt)}>
        {timeAgo(b.createdAt, now)}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        {next && (
          <button
            type="button"
            title={failed ? 'Could not save – check your internet' : next.title}
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              next.run();
            }}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold disabled:opacity-60',
              failed
                ? 'bg-error-subtle text-error'
                : b.status === 'new'
                  ? 'bg-accent text-ink hover:bg-accent-hover'
                  : 'border-border-strong bg-bg hover:bg-surface border',
            )}
          >
            {busy && <Spinner className="size-3" />}
            {failed ? 'Retry' : next.label}
          </button>
        )}
      </td>
    </tr>
  );
}

/* --------------------------------------------------------------- the drawer */

export type Mode = null | 'assign' | 'cancel';

function BookingDetail({
  b,
  user,
  drivers,
  now,
  initialMode,
  onClose,
}: {
  b: Booking;
  user: User;
  drivers: Driver[];
  now: number;
  initialMode: Mode;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [driverId, setDriverId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function run(to: BookingStatus, opts: Parameters<typeof changeBookingStatus>[4] = {}) {
    setBusy(true);
    setErr('');
    try {
      await changeBookingStatus(user, b.id, b.status, to, opts);
      setMode(null);
      setReason('');
    } catch {
      setErr('Could not save. Check your internet and try again.');
    } finally {
      setBusy(false);
    }
  }

  const greeting = `Hi ${b.name}, this is DriveBuddy about your booking${b.ref ? ` ${b.ref}` : ''}. `;

  return (
    <>
      <DrawerHeader onClose={onClose}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-xl font-bold tabular">{refLabel(b, now)}</h2>
          <BookingPill status={b.status} />
          {b.package === 'medical-emergency' && <PriorityTag />}
        </div>
        <p className="text-fg-subtle mt-1 text-sm">
          Booked {formatDateTime(b.createdAt)} · {timeAgo(b.createdAt, now)}
        </p>
      </DrawerHeader>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <p className="text-lg font-semibold">{b.name}</p>
        <p className="text-fg-muted tabular">{prettyPhone(b.phone)}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <ContactButtons phone={b.phone} text={greeting} />
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3">
          <Detail label="Package">{packageName(b.package)}</Detail>
          <Detail label="City">{b.city}</Detail>
          <Detail label="Pickup" wide>
            {b.pickup}
          </Detail>
          <Detail label="Trip time">{formatPreferred(b.preferredTime)}</Detail>
          <Detail label="Customer">
            {b.isReturning ? 'Returning' : 'New'}
            {b.customerUid ? ' · logged in' : ''}
          </Detail>
          {b.notes && (
            <Detail label="Customer's notes" wide>
              {b.notes}
            </Detail>
          )}
          {b.assignedDriver && (
            <Detail label="Driver" wide>
              {b.assignedDriver.name} ·{' '}
              <a href={`tel:+91${b.assignedDriver.phone}`} className="text-accent-text font-semibold tabular">
                {prettyPhone(b.assignedDriver.phone)}
              </a>
            </Detail>
          )}
          {b.status === 'cancelled' && b.cancelReason && (
            <Detail label="Cancelled because" wide>
              {b.cancelReason}
            </Detail>
          )}
        </dl>

        {err && (
          <Alert tone="error" className="mt-5">
            {err}
          </Alert>
        )}

        <div className="border-border mt-5 border-t pt-5">
          <SectionTitle>Update</SectionTitle>
          {mode === 'assign' ? (
            <div className="flex flex-col gap-2">
              <Select value={driverId} onChange={(e) => setDriverId(e.target.value)} aria-label="Choose a driver">
                <option value="">{drivers.length ? 'Choose an active driver…' : 'No active drivers – activate one in the Drivers tab'}</option>
                {[...drivers]
                  .sort((x, y) => Number(y.city === b.city) - Number(x.city === b.city))
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} · {d.city} · {prettyPhone(d.phone)}
                    </option>
                  ))}
              </Select>
              <div className="flex gap-2">
                <Button
                  disabled={!driverId}
                  loading={busy}
                  onClick={() => {
                    const d = drivers.find((x) => x.id === driverId);
                    if (d) run('assigned', { driver: { id: d.id, name: d.name, phone: d.phone } });
                  }}
                >
                  Assign
                </Button>
                <Button variant="ghost" onClick={() => setMode(null)}>
                  Back
                </Button>
              </div>
            </div>
          ) : mode === 'cancel' ? (
            <div className="flex flex-col gap-2">
              <Input
                placeholder="Reason (the customer sees this)"
                value={reason}
                maxLength={200}
                onChange={(e) => setReason(e.target.value)}
                aria-label="Cancellation reason"
              />
              <div className="flex gap-2">
                <Button variant="secondary" loading={busy} onClick={() => run('cancelled', { cancelReason: reason.trim() })}>
                  Cancel booking
                </Button>
                <Button variant="ghost" onClick={() => setMode(null)}>
                  Back
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {b.status === 'new' && (
                <Button loading={busy} onClick={() => run('confirmed')}>
                  Confirm – I called them
                </Button>
              )}
              {(b.status === 'confirmed' || b.status === 'new') && (
                <Button variant={b.status === 'confirmed' ? 'primary' : 'outline'} onClick={() => setMode('assign')}>
                  Assign driver
                </Button>
              )}
              {b.status === 'assigned' && (
                <>
                  <Button loading={busy} onClick={() => run('completed')}>
                    Mark completed
                  </Button>
                  <Button variant="outline" onClick={() => setMode('assign')}>
                    Change driver
                  </Button>
                </>
              )}
              {OPEN.includes(b.status) && (
                <Button variant="ghost" onClick={() => setMode('cancel')}>
                  Cancel…
                </Button>
              )}
              {(b.status === 'completed' || b.status === 'cancelled') && (
                <Button variant="outline" loading={busy} onClick={() => run('confirmed', { note: 'Reopened' })}>
                  Reopen
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="border-border mt-5 border-t pt-5">
          <SectionTitle>History &amp; internal notes</SectionTitle>
          <History bookingId={b.id} user={user} />
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ history */

type Event = { id: string; type: string; from: string | null; to: string | null; note: string; by: string; at?: Date };

const statusLabel = (s: string | null) => (s ? (BOOKING_STATUS[s as BookingStatus]?.label ?? s) : '');

function History({ bookingId, user }: { bookingId: string; user: User }) {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let off: (() => void) | undefined;
    (async () => {
      const [app, fs] = await Promise.all([getFirebaseApp(), import('firebase/firestore')]);
      const q = fs.query(fs.collection(fs.getFirestore(app), 'bookings', bookingId, 'events'), fs.orderBy('at', 'asc'));
      off = fs.onSnapshot(q, (snap) =>
        setEvents(snap.docs.map((d) => ({ ...(d.data() as Omit<Event, 'id'>), id: d.id, at: toDate(d.data().at) }))),
      );
    })();
    return () => off?.();
  }, [bookingId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    try {
      await addBookingNote(user, bookingId, note);
      setNote('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {!events ? (
        <Spinner className="size-4" />
      ) : events.length === 0 ? (
        <p className="text-fg-subtle text-sm">No history yet.</p>
      ) : (
        <ol className="border-border flex flex-col gap-3 border-l-2 pl-4">
          {events.map((ev) => (
            <li key={ev.id} className="text-sm">
              <p className="font-semibold">
                {ev.type === 'created'
                  ? 'Booking received'
                  : ev.type === 'note'
                    ? 'Note'
                    : `${statusLabel(ev.from)} → ${statusLabel(ev.to)}`}
              </p>
              {ev.note && <p className="text-fg-muted">{ev.note}</p>}
              <p className="text-fg-subtle text-xs">
                {formatDateTime(ev.at)} · {ev.by === 'system' ? 'website' : ev.by}
              </p>
            </li>
          ))}
        </ol>
      )}
      <form onSubmit={save} className="mt-4 flex gap-2">
        <Input
          placeholder="Internal note (only admins see it)"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          aria-label="Internal note"
        />
        <Button type="submit" variant="outline" loading={busy} disabled={!note.trim()}>
          Add
        </Button>
      </form>
    </div>
  );
}

