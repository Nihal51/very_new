'use client';

import type { User } from 'firebase/auth';
import { useEffect, useState } from 'react';

import { LoginPanel } from '@/components/account/LoginPanel';
import { PhoneIcon } from '@/components/icons';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';
import { loadProfile, saveProfile, signOutUser, watchUser, type Profile } from '@/lib/auth';
import {
  BOOKING_STATUS,
  formatDateTime,
  formatPreferred,
  packageName,
  prettyPhone,
  toDate,
  type Booking,
} from '@/lib/bookings';
import { getFirebaseApp, isFirebaseConfigured } from '@/lib/firebase';
import { normalisePhone, validateName, validatePhone } from '@/lib/validate';

type State =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'signedIn'; user: User; profile: Profile | null };

export function AccountApp() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setState({ kind: 'signedOut' });
      return;
    }
    let off: (() => void) | undefined;
    let alive = true;
    watchUser(async (user) => {
      if (!alive) return;
      if (!user) return setState({ kind: 'signedOut' });
      const profile = await loadProfile(user.uid).catch(() => null);
      if (alive) setState({ kind: 'signedIn', user, profile });
    }).then((unsub) => (off = unsub));
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  if (state.kind === 'loading')
    return (
      <div className="text-fg-muted flex items-center gap-3 py-10">
        <Spinner className="size-5" /> Loading your account…
      </div>
    );

  if (state.kind === 'signedOut')
    return (
      <div className="grid gap-10 lg:grid-cols-[minmax(0,26rem)_1fr] lg:gap-16">
        <Card>
          <h2 className="text-display-sm">Log in or sign up</h2>
          <p className="text-fg-muted mt-2 mb-6 text-[0.9375rem]">
            New here? Logging in creates your account. No password to remember.
          </p>
          <LoginPanel />
        </Card>
        <div className="text-fg-muted flex flex-col gap-4 text-[0.9375rem] lg:pt-4">
          <h2 className="text-fg font-display text-lg font-semibold">Why log in?</h2>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>See every booking and its status: received, confirmed, driver assigned.</li>
            <li>Your name and number fill in by themselves next time.</li>
            <li>See your driver&apos;s name and number once one is assigned.</li>
          </ul>
          <p>
            You can still book without an account. <a href="/book/" className="text-accent-text font-semibold underline underline-offset-4">Book a driver</a>.
          </p>
        </div>
      </div>
    );

  if (!state.profile)
    return (
      <ProfileForm
        user={state.user}
        initial={null}
        onSaved={(profile) => setState({ ...state, profile })}
      />
    );

  return <Dashboard user={state.user} profile={state.profile} onProfile={(profile) => setState({ ...state, profile })} />;
}

/* ------------------------------------------------------------------ profile */

function ProfileForm({
  user,
  initial,
  onSaved,
  onCancel,
}: {
  user: User;
  initial: Profile | null;
  onSaved: (p: Profile) => void;
  onCancel?: () => void;
}) {
  const authPhone = user.phoneNumber ? normalisePhone(user.phoneNumber) : '';
  const [name, setName] = useState(initial?.name ?? user.displayName ?? '');
  const [phone, setPhone] = useState(initial?.phone || authPhone);
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = { name: validateName(name), phone: phone ? validatePhone(phone) : undefined };
    setErrors(next);
    if (next.name || next.phone) return;
    setBusy(true);
    setError('');
    try {
      const profile = { name: name.trim(), phone: phone ? normalisePhone(phone) : '', email: user.email ?? '' };
      await saveProfile(user.uid, profile, initial === null);
      onSaved(profile);
    } catch {
      setError('Could not save just now. Check your internet and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-lg">
      <h2 className="text-display-sm">{initial ? 'Edit your details' : 'Welcome! Just your name'}</h2>
      <p className="text-fg-muted mt-2 mb-6 text-[0.9375rem]">We use these to fill in your bookings for you.</p>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Your name" name="name" error={errors.name} required>
          {(p) => <Input {...p} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field
          label="Mobile number"
          name="phone"
          error={errors.phone}
          hint={authPhone ? 'Verified by SMS when you logged in.' : 'So our driver can call you.'}
        >
          {(p) => (
            <Input
              {...p}
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              value={phone}
              readOnly={Boolean(authPhone)}
              onChange={(e) => setPhone(e.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={busy} loadingText="Saving…">
            Save
          </Button>
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

/* ---------------------------------------------------------------- dashboard */

function Dashboard({ user, profile, onProfile }: { user: User; profile: Profile; onProfile: (p: Profile) => void }) {
  const [editing, setEditing] = useState(false);
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let off: (() => void) | undefined;
    (async () => {
      const [app, fs] = await Promise.all([getFirebaseApp(), import('firebase/firestore')]);
      const q = fs.query(
        fs.collection(fs.getFirestore(app), 'bookings'),
        fs.where('customerUid', '==', user.uid),
        fs.orderBy('createdAt', 'desc'),
        fs.limit(50),
      );
      off = fs.onSnapshot(
        q,
        (snap) =>
          setBookings(
            snap.docs.map((d) => {
              const data = d.data();
              return {
                ...(data as Omit<Booking, 'id'>),
                id: d.id,
                createdAt: toDate(data.createdAt),
              };
            }),
          ),
        () => setLoadError(true),
      );
    })();
    return () => off?.();
  }, [user.uid]);

  if (editing)
    return (
      <ProfileForm
        user={user}
        initial={profile}
        onCancel={() => setEditing(false)}
        onSaved={(p) => {
          onProfile(p);
          setEditing(false);
        }}
      />
    );

  return (
    <div className="grid gap-8 lg:grid-cols-[20rem_1fr] lg:gap-12">
      <Card className="h-fit">
        <p className="text-fg-subtle text-sm">Logged in as</p>
        <p className="font-display mt-1 text-xl font-semibold">{profile.name}</p>
        {profile.phone && <p className="text-fg-muted mt-1 tabular">{prettyPhone(profile.phone)}</p>}
        {profile.email && <p className="text-fg-muted mt-1 text-sm break-all">{profile.email}</p>}
        <div className="mt-6 flex flex-col gap-3">
          <ButtonLink href="/book/" fullWidth>
            Book a driver
          </ButtonLink>
          <Button variant="outline" fullWidth onClick={() => setEditing(true)}>
            Edit my details
          </Button>
          <Button variant="ghost" fullWidth onClick={() => signOutUser()}>
            Log out
          </Button>
        </div>
      </Card>

      <section aria-labelledby="my-bookings">
        <h2 id="my-bookings" className="text-display-sm">
          My bookings
        </h2>
        <div className="mt-6">
          {loadError ? (
            <Alert tone="error">We could not load your bookings. Refresh the page to try again.</Alert>
          ) : bookings === null ? (
            <div className="text-fg-muted flex items-center gap-3">
              <Spinner className="size-5" /> Loading…
            </div>
          ) : bookings.length === 0 ? (
            <EmptyState
              icon="calendar"
              title="No bookings yet"
              body="Bookings you make while logged in will show here, with their status and your driver's details."
              action={<ButtonLink href="/book/">Book a driver</ButtonLink>}
            />
          ) : (
            <ul className="flex flex-col gap-4">
              {bookings.map((b) => (
                <li key={b.id}>
                  <BookingRow b={b} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function BookingRow({ b }: { b: Booking }) {
  const status = BOOKING_STATUS[b.status] ?? BOOKING_STATUS.new;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold">{packageName(b.package)}</p>
          <p className="text-fg-subtle text-sm">
            {b.ref ?? 'Booking'} · booked {formatDateTime(b.createdAt)}
          </p>
        </div>
        <Badge tone={status.tone}>{status.customerLabel}</Badge>
      </div>
      <dl className="text-fg-muted mt-4 grid gap-x-6 gap-y-2 text-[0.9375rem] sm:grid-cols-2">
        <div>
          <dt className="text-fg-subtle text-xs">Pickup</dt>
          <dd>
            {b.pickup}, {b.city}
          </dd>
        </div>
        <div>
          <dt className="text-fg-subtle text-xs">When</dt>
          <dd>{formatPreferred(b.preferredTime)}</dd>
        </div>
      </dl>
      {b.assignedDriver && b.status === 'assigned' && (
        <div className="border-border mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-[0.9375rem]">
            Your driver: <strong>{b.assignedDriver.name}</strong>
          </p>
          <a
            href={`tel:+91${b.assignedDriver.phone}`}
            className="text-accent-text inline-flex items-center gap-2 font-semibold tabular"
          >
            <PhoneIcon className="size-4" />
            {prettyPhone(b.assignedDriver.phone)}
          </a>
        </div>
      )}
    </Card>
  );
}
