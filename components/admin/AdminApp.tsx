'use client';

import type { User } from 'firebase/auth';
import { useEffect, useMemo, useRef, useState } from 'react';

import { LoginPanel } from '@/components/account/LoginPanel';
import { BookingsTab, type BookingView } from '@/components/admin/BookingsTab';
import { CustomersTab } from '@/components/admin/CustomersTab';
import { DriversTab } from '@/components/admin/DriversTab';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { ensureAdmin } from '@/lib/admin';
import { signOutUser, watchUser } from '@/lib/auth';
import { istMidnight, packageName, toDate, type Booking, type Driver } from '@/lib/bookings';
import { cn } from '@/lib/cn';
import { getFirebaseApp, isFirebaseConfigured } from '@/lib/firebase';

type Gate =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'checking'; user: User }
  | { kind: 'denied'; email: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; user: User };

/**
 * /admin — the dispatch desk. Google sign-in, then Firestore decides whether
 * this account is an admin (admins/{email}, see firestore.rules). Everything
 * below is live: a booking made anywhere appears here within a second.
 */
export function AdminApp() {
  const [gate, setGate] = useState<Gate>({ kind: 'loading' });

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setGate({ kind: 'error', message: 'Firebase is not configured on this build.' });
      return;
    }
    let off: (() => void) | undefined;
    let alive = true;
    watchUser(async (user) => {
      if (!alive) return;
      if (!user) return setGate({ kind: 'signedOut' });
      setGate({ kind: 'checking', user });
      try {
        const ok = await ensureAdmin(user);
        if (alive) setGate(ok ? { kind: 'ready', user } : { kind: 'denied', email: user.email ?? 'this account' });
      } catch {
        if (alive)
          setGate({
            kind: 'error',
            message:
              'Could not check admin access. Check your internet. If this is the first setup, publish the security rules (docs/bookings-system.md, step 4).',
          });
      }
    }).then((u) => (off = u));
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  if (gate.kind === 'loading' || gate.kind === 'checking')
    return (
      <div className="text-fg-muted flex items-center gap-3 py-16">
        <Spinner className="size-5" /> {gate.kind === 'checking' ? 'Checking access…' : 'Loading…'}
      </div>
    );

  if (gate.kind === 'signedOut')
    return (
      <Card className="mx-auto max-w-md">
        <h2 className="text-display-sm">Admin login</h2>
        <p className="text-fg-muted mt-2 mb-6 text-[0.9375rem]">Use the Google account that has admin access.</p>
        <LoginPanel googleOnly />
      </Card>
    );

  if (gate.kind === 'denied' || gate.kind === 'error')
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <Alert tone="error" title={gate.kind === 'denied' ? 'No admin access' : 'Something is not set up'}>
          {gate.kind === 'denied'
            ? `${gate.email} is not on the admin list. Log out and use the admin Google account.`
            : gate.message}
        </Alert>
        <Button variant="outline" onClick={() => signOutUser()}>
          Log out
        </Button>
      </div>
    );

  return <Dashboard user={gate.user} />;
}

/* ---------------------------------------------------------------- dashboard */

type Tab = 'bookings' | 'drivers' | 'customers';

function useLiveCollection<T>(name: 'bookings' | 'drivers', map: (id: string, d: Record<string, unknown>) => T) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState(false);
  const mapRef = useRef(map);
  useEffect(() => {
    let off: (() => void) | undefined;
    (async () => {
      const [app, fs] = await Promise.all([getFirebaseApp(), import('firebase/firestore')]);
      const q = fs.query(fs.collection(fs.getFirestore(app), name), fs.orderBy('createdAt', 'desc'), fs.limit(1000));
      off = fs.onSnapshot(
        q,
        (snap) => setRows(snap.docs.map((d) => mapRef.current(d.id, d.data()))),
        () => setError(true),
      );
    })();
    return () => off?.();
  }, [name]);
  return { rows, error };
}

const mapBooking = (id: string, d: Record<string, unknown>): Booking =>
  ({ ...(d as Omit<Booking, 'id'>), id, createdAt: toDate(d.createdAt), updatedAt: toDate(d.updatedAt) }) as Booking;
const mapDriver = (id: string, d: Record<string, unknown>): Driver =>
  ({ ...(d as Omit<Driver, 'id'>), id, createdAt: toDate(d.createdAt) }) as Driver;

/** A short two-tone chime, made in the browser — no sound file to load. */
function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1320].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.3);
    });
  } catch {
    /* audio blocked until the first click — the notification still shows */
  }
}

function Dashboard({ user }: { user: User }) {
  const [tab, setTab] = useState<Tab>('bookings');
  const [view, setView] = useState<BookingView>({ status: 'open', range: 'any' });
  const [openId, setOpenId] = useState<string | null>(null);
  const bookings = useLiveCollection('bookings', mapBooking);
  const drivers = useLiveCollection('drivers', mapDriver);
  const [notifyState, setNotifyState] = useState<NotificationPermission | 'unsupported'>('default');

  // Deep links from Telegram/email: /admin/?b=<bookingId> or /admin/?tab=drivers
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const t = p.get('tab');
    if (t === 'drivers' || t === 'customers') setTab(t);
    if (p.get('b')) setOpenId(p.get('b'));
    setNotifyState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  }, []);

  function syncUrl(t: Tab, b: string | null) {
    const url = new URL(window.location.href);
    url.search = b ? `?b=${encodeURIComponent(b)}` : t === 'bookings' ? '' : `?tab=${t}`;
    window.history.replaceState(null, '', url);
  }
  function switchTab(t: Tab) {
    setTab(t);
    setOpenId(null);
    syncUrl(t, null);
  }
  function openBooking(id: string | null) {
    setOpenId(id);
    syncUrl('bookings', id);
  }
  function showBookings(v: BookingView) {
    switchTab('bookings');
    setView(v);
  }

  // Ring and notify when a booking arrives while the panel is open.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!bookings.rows) return;
    const ids = new Set(bookings.rows.map((b) => b.id));
    if (seen.current) {
      const fresh = bookings.rows.filter((b) => !seen.current!.has(b.id));
      if (fresh.length) {
        chime();
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          for (const b of fresh)
            new Notification(`New booking – ${b.name}`, { body: `${b.city} · ${packageName(b.package)}\n${b.pickup}`, tag: b.id });
        }
      }
    }
    seen.current = ids;
  }, [bookings.rows]);

  const counts = useMemo(() => {
    const rows = bookings.rows ?? [];
    const today = istMidnight(Date.now());
    return {
      new: rows.filter((b) => b.status === 'new').length,
      open: rows.filter((b) => ['new', 'confirmed', 'assigned'].includes(b.status)).length,
      today: rows.filter((b) => b.createdAt && b.createdAt.getTime() >= today).length,
      activeDrivers: (drivers.rows ?? []).filter((d) => d.status === 'active').length,
      newDrivers: (drivers.rows ?? []).filter((d) => d.status === 'new').length,
    };
  }, [bookings.rows, drivers.rows]);

  useEffect(() => {
    document.title = counts.new ? `(${counts.new}) New bookings · DriveBuddy Admin` : 'DriveBuddy Admin';
  }, [counts.new]);

  const tiles: { label: string; hint: string; value: number; hot?: boolean; go: () => void }[] = [
    {
      label: 'New – call now',
      hint: 'Waiting for your call',
      value: counts.new,
      hot: counts.new > 0,
      go: () => showBookings({ status: 'new', range: 'any' }),
    },
    {
      label: 'Needs action',
      hint: 'New, confirmed or driver on the way',
      value: counts.open,
      go: () => showBookings({ status: 'open', range: 'any' }),
    },
    {
      label: 'Booked today',
      hint: 'Since midnight',
      value: counts.today,
      go: () => showBookings({ status: 'all', range: 'today' }),
    },
    {
      label: 'Active drivers',
      hint: counts.newDrivers
        ? `${counts.newDrivers} new application${counts.newDrivers === 1 ? '' : 's'}`
        : 'Ready for bookings',
      value: counts.activeDrivers,
      go: () => switchTab('drivers'),
    },
  ];

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'bookings', label: 'Bookings', badge: counts.new },
    { id: 'drivers', label: 'Drivers', badge: counts.newDrivers },
    { id: 'customers', label: 'Customers' },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="relative flex size-2.5">
            <span className="bg-success absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:hidden" />
            <span className="bg-success relative inline-flex size-2.5 rounded-full" />
          </span>
          <span className="text-fg-muted">
            Live · <strong className="text-fg font-semibold">{user.email}</strong>
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {notifyState === 'default' && (
            <Button size="sm" variant="outline" onClick={async () => setNotifyState(await Notification.requestPermission())}>
              Turn on pop-up alerts
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => signOutUser()}>
            Log out
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={t.go}
            className={cn(
              'group rounded-xl border p-4 text-left transition-colors',
              t.hot
                ? 'border-accent bg-accent-subtle hover:bg-accent-subtle/70'
                : 'border-border bg-bg hover:border-border-strong hover:bg-bg-subtle',
            )}
          >
            <span
              className={cn('block text-xs font-semibold tracking-wide uppercase', t.hot ? 'text-accent-text' : 'text-fg-subtle')}
            >
              {t.label}
            </span>
            <span className="font-display mt-1 block text-3xl font-bold tabular">{bookings.rows ? t.value : '–'}</span>
            <span className="text-fg-subtle mt-0.5 block text-xs group-hover:underline">{t.hint}</span>
          </button>
        ))}
      </div>

      <div role="tablist" aria-label="Admin sections" className="border-border flex gap-1 overflow-x-auto border-b">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => switchTab(t.id)}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-[0.9375rem] font-semibold whitespace-nowrap',
              tab === t.id ? 'border-accent text-fg' : 'text-fg-muted hover:text-fg border-transparent',
            )}
          >
            {t.label}
            {Boolean(t.badge) && (
              <span className="bg-accent text-ink rounded-full px-2 py-0.5 text-xs font-bold tabular">{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'bookings' && (
        <BookingsTab
          user={user}
          bookings={bookings.rows}
          error={bookings.error}
          drivers={drivers.rows ?? []}
          view={view}
          onView={setView}
          openId={openId}
          onOpen={openBooking}
        />
      )}
      {tab === 'drivers' && <DriversTab user={user} drivers={drivers.rows} error={drivers.error} />}
      {tab === 'customers' && <CustomersTab />}
    </div>
  );
}
