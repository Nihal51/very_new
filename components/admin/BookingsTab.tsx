'use client';

import type { User } from 'firebase/auth';
import { useEffect, useMemo, useState } from 'react';

import { PhoneIcon, WhatsappIcon } from '@/components/icons';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';
import { addBookingNote, changeBookingStatus } from '@/lib/admin';
import {
  BOOKING_STATUS,
  formatDateTime,
  formatPreferred,
  packageName,
  prettyPhone,
  timeAgo,
  toDate,
  type Booking,
  type BookingStatus,
  type Driver,
} from '@/lib/bookings';
import { cn } from '@/lib/cn';
import { getFirebaseApp } from '@/lib/firebase';

type Filter = 'open' | BookingStatus | 'all';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'new', label: 'New' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'assigned', label: 'Driver assigned' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'all', label: 'All' },
];

const matches = (b: Booking, f: Filter) =>
  f === 'all' ? true : f === 'open' ? ['new', 'confirmed', 'assigned'].includes(b.status) : b.status === f;

export function BookingsTab({
  user,
  bookings,
  error,
  drivers,
  focusId,
}: {
  user: User;
  bookings: Booking[] | null;
  error: boolean;
  drivers: Driver[];
  focusId: string | null;
}) {
  const [filter, setFilter] = useState<Filter>('open');
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(() => Date.now());

  // "5 min ago" keeps counting without a refresh.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // A deep-linked booking is shown whatever its status.
  useEffect(() => {
    if (focusId) setFilter('all');
  }, [focusId]);

  const activeDrivers = useMemo(() => drivers.filter((d) => d.status === 'active'), [drivers]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (bookings ?? []).filter(
      (b) =>
        matches(b, filter) &&
        (!q ||
          [b.name, b.phone, b.ref, b.pickup, b.city, packageName(b.package)].some((v) =>
            String(v ?? '').toLowerCase().includes(q),
          )),
    );
  }, [bookings, filter, search]);

  if (error) return <Alert tone="error">Could not load bookings. Check that you are still logged in, then refresh.</Alert>;
  if (!bookings)
    return (
      <div className="text-fg-muted flex items-center gap-3">
        <Spinner className="size-5" /> Loading bookings…
      </div>
    );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const n = bookings.filter((b) => matches(b, f.id)).length;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm font-semibold',
                  filter === f.id ? 'border-ink bg-ink text-fg-inverse' : 'border-border-strong text-fg-muted hover:text-fg',
                )}
              >
                {f.label} <span className="tabular opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
        <Input
          type="search"
          placeholder="Search name, phone, DB-number, area…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="lg:max-w-xs"
          aria-label="Search bookings"
        />
      </div>

      {visible.length === 0 ? (
        <p className="text-fg-muted py-10 text-center">No bookings here.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {visible.map((b) => (
            <li key={b.id}>
              <BookingCard b={b} user={user} drivers={activeDrivers} now={now} focused={b.id === focusId} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------- card */

type Mode = null | 'assign' | 'cancel';

function BookingCard({
  b,
  user,
  drivers,
  now,
  focused,
}: {
  b: Booking;
  user: User;
  drivers: Driver[];
  now: number;
  focused: boolean;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [driverId, setDriverId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showHistory, setShowHistory] = useState(focused);
  const status = BOOKING_STATUS[b.status] ?? BOOKING_STATUS.new;
  const urgent = b.package === 'medical-emergency';

  useEffect(() => {
    if (focused) document.getElementById(`booking-${b.id}`)?.scrollIntoView({ block: 'center' });
  }, [focused, b.id]);

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
    <Card
      id={`booking-${b.id}`}
      className={cn(focused && 'ring-accent ring-2', b.status === 'new' && 'border-accent/60')}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-lg font-bold tabular">{b.ref ?? 'Numbering…'}</span>
          <Badge tone={status.tone}>{status.label}</Badge>
          {urgent && <Badge tone="accent">PRIORITY · hospital</Badge>}
          {b.isReturning && <Badge tone="outline">Returning customer</Badge>}
          {b.customerUid && <Badge tone="outline">Logged in</Badge>}
        </div>
        <p className="text-fg-subtle text-sm" title={formatDateTime(b.createdAt)}>
          {timeAgo(b.createdAt, now)}
        </p>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <p className="text-lg font-semibold">{b.name}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <a
              href={`tel:+91${b.phone}`}
              className="border-border-strong inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold tabular"
            >
              <PhoneIcon className="size-4" /> {prettyPhone(b.phone)}
            </a>
            <a
              href={`https://wa.me/91${b.phone}?text=${encodeURIComponent(greeting)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="border-border-strong inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold"
            >
              <WhatsappIcon className="size-4" /> WhatsApp
            </a>
          </div>
        </div>
        <dl className="text-fg-muted grid gap-x-6 gap-y-2 text-[0.9375rem] sm:grid-cols-2">
          <Item label="Package" value={packageName(b.package)} />
          <Item label="City" value={b.city} />
          <Item label="Pickup" value={b.pickup} wide />
          <Item label="When" value={formatPreferred(b.preferredTime)} />
          <Item label="Booked" value={formatDateTime(b.createdAt)} />
          {b.notes && <Item label="Customer's notes" value={b.notes} wide />}
          {b.assignedDriver && (
            <Item label="Driver" value={`${b.assignedDriver.name} · ${prettyPhone(b.assignedDriver.phone)}`} wide />
          )}
          {b.status === 'cancelled' && b.cancelReason && <Item label="Cancelled because" value={b.cancelReason} wide />}
        </dl>
      </div>

      {err && <Alert tone="error" className="mt-4">{err}</Alert>}

      {/* ------------------------------------------------------------ actions */}
      <div className="border-border mt-5 flex flex-col gap-3 border-t pt-4">
        {mode === 'assign' ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={driverId} onChange={(e) => setDriverId(e.target.value)} aria-label="Choose a driver">
              <option value="">
                {drivers.length ? 'Choose an active driver…' : 'No active drivers – activate one in the Drivers tab'}
              </option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {d.city} · {prettyPhone(d.phone)}
                </option>
              ))}
            </Select>
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
        ) : mode === 'cancel' ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Reason (customer sees this) – e.g. Customer changed plans"
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
              aria-label="Cancellation reason"
            />
            <Button variant="secondary" loading={busy} onClick={() => run('cancelled', { cancelReason: reason.trim() })}>
              Cancel booking
            </Button>
            <Button variant="ghost" onClick={() => setMode(null)}>
              Back
            </Button>
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
            {['new', 'confirmed', 'assigned'].includes(b.status) && (
              <Button variant="ghost" onClick={() => setMode('cancel')}>
                Cancel…
              </Button>
            )}
            {(b.status === 'completed' || b.status === 'cancelled') && (
              <Button variant="outline" loading={busy} onClick={() => run('confirmed', { note: 'Reopened' })}>
                Reopen
              </Button>
            )}
            <Button variant="ghost" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
              {showHistory ? 'Hide history & notes' : 'History & notes'}
            </Button>
          </div>
        )}
        {showHistory && <History bookingId={b.id} user={user} />}
      </div>
    </Card>
  );
}

function Item({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={cn(wide && 'sm:col-span-2')}>
      <dt className="text-fg-subtle text-xs">{label}</dt>
      <dd className="text-fg">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ history */

type Event = { id: string; type: string; from: string | null; to: string | null; note: string; by: string; at?: Date };

function History({ bookingId, user }: { bookingId: string; user: User }) {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let off: (() => void) | undefined;
    (async () => {
      const [app, fs] = await Promise.all([getFirebaseApp(), import('firebase/firestore')]);
      const q = fs.query(
        fs.collection(fs.getFirestore(app), 'bookings', bookingId, 'events'),
        fs.orderBy('at', 'asc'),
      );
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

  const describe = (ev: Event) =>
    ev.type === 'created'
      ? 'Booking received'
      : ev.type === 'note'
        ? 'Note'
        : `${ev.from ? BOOKING_STATUS[ev.from as BookingStatus]?.label ?? ev.from : ''} → ${
            ev.to ? BOOKING_STATUS[ev.to as BookingStatus]?.label ?? ev.to : ''
          }`;

  return (
    <div className="bg-bg-subtle rounded-xl p-4">
      {!events ? (
        <Spinner className="size-4" />
      ) : (
        <ol className="flex flex-col gap-2 text-sm">
          {events.map((ev) => (
            <li key={ev.id} className="flex flex-wrap gap-x-2">
              <span className="text-fg-subtle tabular">{formatDateTime(ev.at)}</span>
              <span className="font-semibold">{describe(ev)}</span>
              {ev.note && <span className="text-fg-muted">– {ev.note}</span>}
              <span className="text-fg-subtle">({ev.by === 'system' ? 'website' : ev.by})</span>
            </li>
          ))}
        </ol>
      )}
      <form onSubmit={save} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Add an internal note (only admins see this)"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          aria-label="Internal note"
        />
        <Button type="submit" variant="outline" loading={busy} disabled={!note.trim()}>
          Add note
        </Button>
      </form>
    </div>
  );
}
